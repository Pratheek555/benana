// Bot host: runs under system Node (>=22, Mineflayer's requirement; Electron's Node is older).
// Owns the Mineflayer bot and the prismarine-viewer server. Electron talks to it over the IPC channel:
//   parent -> { id, tool, args }            child -> { id, ok, result | error }
//   child  -> { event: 'status' | 'chat', ... }
const Module = require('node:module');

// prismarine-viewer's shared entity code requires the native `canvas` package at load time for name tags.
// Only the browser bundle draws them, so the server side gets a stub instead of a native build.
const load = Module._load;
Module._load = function loadWithoutCanvas(request, ...rest) {
  if (request === 'canvas') return { createCanvas: () => { throw new Error('canvas is not available in the bot host'); } };
  return load.call(this, request, ...rest);
};

// Serve the viewer page with a closer camera. The stock page orbits from 28 blocks away, which makes the bot
// and mobs too small to read on a recording. OrbitControls zooms on wheel events, including synthetic ones.
const viewerRoutes = require('prismarine-viewer/lib/common');
const setupRoutes = viewerRoutes.setupRoutes;
const ZOOM_PAGE = require('node:fs')
  .readFileSync(require.resolve('prismarine-viewer/public/index.html'), 'utf8')
  .replace('</body>', `<script>
  setTimeout(function zoom() {
    var c = document.querySelector('canvas');
    if (!c) return setTimeout(zoom, 300);
    var n = 0, t = setInterval(function () {
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
      if (++n >= 12) clearInterval(t);
    }, 20);
  }, 2500);
</script></body>`);
viewerRoutes.setupRoutes = (app, prefix = '') => {
  app.get(`${prefix}/`, (_req, res) => res.type('html').send(ZOOM_PAGE));
  setupRoutes(app, prefix);
};

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { mineflayer: viewer } = require('prismarine-viewer');
const { Vec3 } = require('vec3');

const { MC_PORT, MC_VERSION, BOT_NAME, VIEWER_PORT, VIEWER_FIRST_PERSON } = process.env;

const send = (msg) => process.send && process.send(msg);
const round = (n) => Math.round(n * 1000) / 1000;
const vec = (v) => (v ? [round(v.x), round(v.y), round(v.z)] : null);
const chat = [];
const dead = new Set(); // killed mobs linger ~20 ticks for the death animation

const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(MC_PORT), username: BOT_NAME, version: MC_VERSION, auth: 'offline' });
bot.loadPlugin(pathfinder);

bot.once('spawn', () => {
  const moves = new Movements(bot);
  moves.canDig = false;
  bot.pathfinder.setMovements(moves);
  viewer(bot, { port: Number(VIEWER_PORT), firstPerson: VIEWER_FIRST_PERSON === '1', viewDistance: 4 });
  // The viewer places its camera on the bot's first `move` event; a bot standing still never sends one.
  setInterval(() => bot.entity && bot.emit('move', bot.entity.position.clone()), 1000);
  send({ event: 'status', bot: 'online' });
});
bot.on('entityDead', (e) => dead.add(e.id));
bot.on('entityGone', (e) => dead.delete(e.id));
bot.on('messagestr', (text, position) => {
  if (position === 'game_info') return;
  chat.push({ text, at: Date.now() });
  if (chat.length > 500) chat.shift();
  send({ event: 'chat', text });
});
bot.on('kicked', (reason) => send({ event: 'status', bot: 'offline', error: `Kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}` }));
bot.on('error', (e) => send({ event: 'status', bot: 'offline', error: e.message }));
bot.on('end', () => {
  send({ event: 'status', bot: 'offline' });
  try { bot.viewer?.close(); } catch {}
  setTimeout(() => process.exit(0), 100);
});

function entity(id) {
  const e = bot.entities[Number(id)];
  if (!e) throw new Error(`No entity with id ${id} is loaded near the bot. Call nearby_entities first.`);
  return e;
}

function describe(e) {
  return {
    id: e.id,
    type: e.type,
    name: e.name || e.username || e.displayName,
    position: vec(e.position),
    velocity: vec(e.velocity),
    distance: round(bot.entity.position.distanceTo(e.position)),
    onGround: e.onGround,
  };
}

function target(args) {
  if (args.entityId != null) return entity(args.entityId).position;
  const p = args.position;
  if (Array.isArray(p) && p.length === 3) return new Vec3(p[0], p[1], p[2]);
  throw new Error('Pass entityId or position [x, y, z].');
}

async function track(e, ticks = 20) {
  const samples = [];
  const start = e.position.clone();
  let prev = e.position.clone();
  for (let tick = 0; tick < Math.min(Number(ticks) || 20, 200); tick++) {
    await bot.waitForTicks(1);
    if (!bot.entities[e.id]) { samples.push({ tick, gone: true }); break; }
    const dp = e.position.minus(prev);
    prev = e.position.clone();
    samples.push({ tick, pos: vec(e.position), vel: vec(e.velocity), dpos: vec(dp) });
  }
  const live = samples.filter((s) => s.pos);
  return {
    entityId: e.id,
    name: e.name,
    // Server velocity packets are exact; position updates arrive batched every few ticks.
    maxUpwardVelocity: round(Math.max(0, ...live.map((s) => s.vel[1]))),
    maxHeightGain: round(Math.max(0, ...live.map((s) => s.pos[1] - start.y))),
    start: vec(start),
    end: live.length ? live[live.length - 1].pos : null,
    samples,
  };
}

const tools = {
  async bot_state() {
    return {
      username: bot.username,
      position: vec(bot.entity.position),
      health: bot.health,
      food: bot.food,
      gameMode: bot.game.gameMode,
      heldItem: bot.heldItem ? { name: bot.heldItem.name, count: bot.heldItem.count } : null,
      inventory: bot.inventory.items().map((i) => ({ name: i.name, count: i.count, slot: i.slot })),
    };
  },
  async nearby_entities({ radius = 16 } = {}) {
    return Object.values(bot.entities)
      .filter((e) => e !== bot.entity && !dead.has(e.id) && e.position.distanceTo(bot.entity.position) <= radius)
      .map(describe)
      .sort((a, b) => a.distance - b.distance);
  },
  async equip({ item }) {
    const found = bot.inventory.items().find((i) => i.name === item || i.name === String(item).replace(/^minecraft:/, ''));
    if (!found) throw new Error(`${item} is not in the inventory.`);
    await bot.equip(found, 'hand');
    return { holding: found.name };
  },
  async look_at(args) {
    const pos = target(args);
    const height = args.entityId != null ? entity(args.entityId).height || 1.6 : 0;
    await bot.lookAt(pos.offset(0, height * 0.8, 0), true);
    return { lookingAt: vec(pos) };
  },
  async move_to(args) {
    const pos = target(args);
    const range = Number(args.range ?? 2);
    const goal = new goals.GoalNear(pos.x, pos.y, pos.z, range);
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise((_, rej) => setTimeout(() => { bot.pathfinder.stop(); rej(new Error('move_to timed out after 15s')); }, 15000)),
    ]);
    return { position: vec(bot.entity.position) };
  },
  async attack({ entityId, trackTicks = 0 }) {
    const e = entity(entityId);
    if (e.position.distanceTo(bot.entity.position) > 3.5) await tools.move_to({ entityId, range: 2 });
    await bot.lookAt(e.position.offset(0, (e.height || 1.6) * 0.8, 0), true);
    bot.attack(e);
    return trackTicks ? { attacked: e.id, after: await track(e, trackTicks) } : { attacked: e.id };
  },
  // Hits several entities a few ticks apart in one call. Separate tool calls are 1-8s apart,
  // which is too slow for testing cooldowns and combos.
  async attack_sequence({ entityIds = [], intervalTicks = 4, trackTicks = 20 }) {
    const started = Date.now();
    const tracks = [];
    for (const [i, id] of entityIds.entries()) {
      const e = entity(id);
      if (e.position.distanceTo(bot.entity.position) > 3.5) await tools.move_to({ entityId: id, range: 2 });
      await bot.lookAt(e.position.offset(0, (e.height || 1.6) * 0.8, 0), true);
      bot.attack(e);
      const hitAtMs = Date.now() - started;
      tracks.push(track(e, trackTicks).then((after) => ({ entityId: e.id, hitAtMs, after: { ...after, samples: after.samples.slice(0, 8) } })));
      if (i < entityIds.length - 1) await bot.waitForTicks(Math.max(1, Number(intervalTicks) || 4));
    }
    return { hits: await Promise.all(tracks) };
  },
  async use_item({ entityId, trackTicks = 0 } = {}) {
    if (entityId != null) {
      const e = entity(entityId);
      await bot.lookAt(e.position.offset(0, (e.height || 1.6) * 0.8, 0), true);
      await bot.activateEntity(e);
      return trackTicks ? { used: bot.heldItem?.name, on: e.id, after: await track(e, trackTicks) } : { used: bot.heldItem?.name, on: e.id };
    }
    bot.activateItem();
    await bot.waitForTicks(5);
    bot.deactivateItem();
    return { used: bot.heldItem?.name };
  },
  async track_entity({ entityId, ticks = 20 }) {
    return track(entity(entityId), ticks);
  },
  async wait_ticks({ ticks = 20 } = {}) {
    await bot.waitForTicks(Math.min(Number(ticks) || 20, 400));
    return { waited: ticks };
  },
  async chat({ message }) {
    bot.chat(String(message));
    await bot.waitForTicks(4);
    return { sent: message };
  },
  async read_chat({ sinceMs = 0 } = {}) {
    return chat.filter((c) => c.at >= sinceMs);
  },
};

process.on('message', async ({ id, tool, args }) => {
  try {
    if (!tools[tool]) throw new Error(`Unknown bot tool ${tool}`);
    if (!bot.entity) throw new Error('The bot has not spawned yet.');
    send({ id, ok: true, result: await tools[tool](args || {}) });
  } catch (e) {
    send({ id, ok: false, error: e.message });
  }
});
process.on('disconnect', () => { try { bot.quit(); } catch {} process.exit(0); });

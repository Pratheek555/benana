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
// Explosions, hurts and deaths the bot has seen, so tools can report what happened during an action.
const events = [];
const record = (ev) => { events.push({ at: Date.now(), ...ev }); if (events.length > 500) events.shift(); };
const eventsSince = (at) => events.filter((e) => e.at >= at);

const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(MC_PORT), username: BOT_NAME, version: MC_VERSION, auth: 'offline' });
bot.loadPlugin(pathfinder);

bot.once('spawn', () => {
  const moves = new Movements(bot);
  moves.canDig = false;
  bot.pathfinder.setMovements(moves);
  viewer(bot, { port: Number(VIEWER_PORT), firstPerson: VIEWER_FIRST_PERSON === '1', viewDistance: 4 });
  // The viewer places its camera on the bot's first `move` event; a bot standing still never sends one.
  setInterval(() => bot.entity && bot.emit('move', bot.entity.position.clone()), 1000);
  bot._client.on('explosion', (p) => record({ kind: 'explosion', position: [round(p.x), round(p.y), round(p.z)] }));
  send({ event: 'status', bot: 'online' });
});
bot.on('entityDead', (e) => { dead.add(e.id); record({ kind: 'death', entityId: e.id, name: e.name, position: vec(e.position) }); });
bot.on('entityHurt', (e) => e && record({ kind: 'hurt', entityId: e.id, name: e.name || e.username, position: vec(e.position) }));
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

// Living entities sync their health as metadata entry 9 (1.21.4).
const health = (e) => (e === bot.entity ? bot.health : typeof e.metadata?.[9] === 'number' ? round(e.metadata[9]) : undefined);

function describe(e) {
  return {
    id: e.id,
    type: e.type,
    name: e.name || e.username || e.displayName,
    position: vec(e.position),
    velocity: vec(e.velocity),
    distance: round(bot.entity.position.distanceTo(e.position)),
    onGround: e.onGround,
    health: health(e),
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

// Ranged items: launch speed at full power (blocks/tick), gravity (blocks/tick²), and how the bot fires them.
const RANGED = {
  bow: { speed: 3, gravity: 0.05, mode: 'charge', charge: 22, ammo: /arrow$/ },
  crossbow: { speed: 3.15, gravity: 0.05, mode: 'crossbow', charge: 28, ammo: /arrow$|firework_rocket/ },
  trident: { speed: 2.5, gravity: 0.05, mode: 'charge', charge: 12 },
  snowball: { speed: 1.5, gravity: 0.03, mode: 'throw' },
  egg: { speed: 1.5, gravity: 0.03, mode: 'throw' },
  ender_pearl: { speed: 1.5, gravity: 0.03, mode: 'throw' },
  wind_charge: { speed: 1.5, gravity: 0, mode: 'throw' },
  experience_bottle: { speed: 0.7, gravity: 0.07, mode: 'throw' },
  splash_potion: { speed: 0.5, gravity: 0.05, mode: 'throw' },
  lingering_potion: { speed: 0.5, gravity: 0.05, mode: 'throw' },
};
const rangedSpec = (name) => RANGED[String(name || '').replace(/^minecraft:/, '')];

// Simulates the projectile for each pitch and keeps the flattest one that lands on the target.
function aim(from, to, speed, gravity) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dz);
  let best = null;
  for (let deg = -40; deg <= 45; deg += 0.25) {
    const t = (deg * Math.PI) / 180;
    let vx = Math.cos(t) * speed;
    let vy = Math.sin(t) * speed;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 200 && x < dist; i++) {
      if (x + vx >= dist) { y += (vy * (dist - x)) / vx; x = dist; break; }
      x += vx;
      y += vy;
      vx *= 0.99;
      vy = vy * 0.99 - gravity;
    }
    if (x < dist) continue;
    const err = Math.abs(y - dy);
    if (!best || err < best.err - 1e-6) best = { pitch: t, err };
  }
  return { yaw: Math.atan2(-dx, -dz), pitch: best ? best.pitch : Math.atan2(dy, dist), aimError: best ? round(best.err) : null };
}

const ammoCount = () => bot.inventory.items().filter((i) => /arrow$|firework_rocket/.test(i.name)).reduce((n, i) => n + i.count, 0);
const crossbowLoaded = (item) => Boolean(item?.componentMap?.get('charged_projectiles')?.data?.length);

async function release(spec, chargeTicks) {
  if (spec.mode === 'throw') {
    bot.activateItem();
    await bot.waitForTicks(1);
    bot.deactivateItem();
    return;
  }
  if (spec.mode === 'crossbow' && !crossbowLoaded(bot.heldItem)) {
    bot.activateItem();
    await bot.waitForTicks(chargeTicks);
    bot.deactivateItem();
    await bot.waitForTicks(2);
  }
  if (spec.mode === 'crossbow') {
    bot.activateItem();
    await bot.waitForTicks(1);
    bot.deactivateItem();
    return;
  }
  bot.activateItem();
  await bot.waitForTicks(chargeTicks);
  bot.deactivateItem();
}

// Fires the held ranged item at each target and reports what happened: the projectile, explosions,
// and the health and knockback of every living entity nearby.
async function shoot({ entityId, entityIds, position, item, chargeTicks, intervalTicks = 0, trackTicks = 60, radius = 24 } = {}) {
  if (item) await tools.equip({ item });
  const held = bot.heldItem;
  const spec = rangedSpec(held?.name);
  if (!spec) throw new Error(`shoot needs a bow, crossbow, trident or throwable in hand (holding ${held?.name || 'nothing'}). Pass item or call equip first.`);
  if (spec.ammo && bot.game.gameMode !== 'creative' && !bot.inventory.items().some((i) => spec.ammo.test(i.name)) && !crossbowLoaded(held)) {
    throw new Error(`${held.name} needs ammo; the inventory has no arrows. Give some with game_setup ("give @bot arrow 64").`);
  }
  const ids = entityIds?.length ? entityIds : entityId != null ? [entityId] : [];
  const targets = ids.length ? ids.map((id) => ({ entityId: Number(id) })) : position ? [{ position }] : [];
  if (!targets.length) throw new Error('Pass entityId, entityIds or position [x, y, z].');
  const charge = Math.max(3, Number(chargeTicks) || spec.charge || 1);
  const power = spec.mode === 'charge' && held.name === 'bow' ? Math.min(1, ((charge / 20) ** 2 + (charge / 20) * 2) / 3) : 1;

  // Snapshot living entities before firing so health and knockback can be compared afterwards.
  const watched = new Map();
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || dead.has(e.id) || health(e) === undefined || e.position.distanceTo(bot.entity.position) > radius) continue;
    watched.set(e.id, { entity: e, healthBefore: health(e), start: e.position.clone(), maxUpwardVelocity: 0, maxHorizontalVelocity: 0 });
  }
  // Projectiles fired by the bot. The server syncs arrow positions only about once a second, so between
  // syncs each flight is dead-reckoned like the vanilla client does.
  const spawned = [];
  const sample = () => {
    for (const w of watched.values()) {
      const v = w.entity.velocity;
      w.maxUpwardVelocity = Math.max(w.maxUpwardVelocity, v.y);
      w.maxHorizontalVelocity = Math.max(w.maxHorizontalVelocity, Math.hypot(v.x, v.z));
    }
    for (const f of spawned) {
      const p = f.entity;
      if (f.removedAt) continue;
      if (!bot.entities[p.id]) { f.removedAt = Date.now(); continue; }
      f.stuck = p.metadata?.[10] === true || p.velocity.norm() < 0.01;
      if (!p.position.equals(f.server)) Object.assign(f, { pos: p.position.clone(), vel: p.velocity.clone(), server: p.position.clone() });
      else if (!f.stuck) {
        f.pos = f.pos.plus(f.vel);
        f.vel = new Vec3(f.vel.x * 0.99, f.vel.y * 0.99 - spec.gravity, f.vel.z * 0.99);
      }
    }
  };

  const started = Date.now();
  const botHealthBefore = bot.health;
  const ammoBefore = ammoCount();
  const shots = [];
  const onSpawn = (e) => {
    if (e.type === 'projectile' || /arrow|trident|snowball|egg|pearl|potion|wind_charge|experience_bottle|firework/.test(e.name || '')) {
      if (e.position.distanceTo(bot.entity.position) < 4) spawned.push({ entity: e, pos: e.position.clone(), vel: e.velocity.clone(), server: e.position.clone() });
    }
  };
  bot.on('entitySpawn', onSpawn);
  bot.on('physicsTick', sample);
  try {
    for (const [i, t] of targets.entries()) {
      const targetEntity = t.entityId != null ? entity(t.entityId) : null;
      const point = () => (targetEntity ? targetEntity.position.offset(0, (targetEntity.height || 1.6) * 0.5, 0) : new Vec3(...t.position));
      const eye = () => bot.entity.position.offset(0, (bot.entity.eyeHeight || 1.62) - 0.1, 0);
      let a = aim(eye(), point(), spec.speed * power, spec.gravity);
      await bot.look(a.yaw, a.pitch, true);
      const before = spawned.length;
      const firing = release(spec, charge);
      // Re-aim during the draw in case the target moved.
      if (spec.mode !== 'throw') {
        await bot.waitForTicks(Math.max(1, charge - 2));
        a = aim(eye(), point(), spec.speed * power, spec.gravity);
        await bot.look(a.yaw, a.pitch, true);
      }
      await firing;
      const firedAtMs = Date.now() - started;
      for (let k = 0; k < 6 && spawned.length === before; k++) await bot.waitForTicks(1);
      const flight = spawned[before] || null;
      const proj = flight?.entity || null;
      shots.push({
        target: targetEntity ? { entityId: targetEntity.id, name: targetEntity.name, position: vec(targetEntity.position) } : { position: t.position },
        aim: { pitchDeg: round((a.pitch * 180) / Math.PI), aimError: a.aimError },
        firedAtMs,
        projectile: proj ? { id: proj.id, name: proj.name, spawnVelocity: vec(proj.velocity) } : null,
        _flight: flight,
        _releasedAt: started + firedAtMs,
      });
      if (i < targets.length - 1 && intervalTicks > 0) await bot.waitForTicks(Number(intervalTicks));
    }

    // Wait until every projectile has landed or been removed (or trackTicks runs out).
    const limit = Math.min(Math.max(Number(trackTicks) || 60, 10), 200);
    let settled = 0;
    for (let tick = 0; tick < limit && settled < 15; tick++) {
      await bot.waitForTicks(1);
      settled = spawned.some((f) => !f.removedAt && !f.stuck) ? 0 : settled + 1;
    }
    for (const s of shots) {
      const f = s._flight;
      if (f) {
        s.projectile.lastPosition = vec(f.pos);
        s.projectile.state = f.removedAt ? `removed ${f.removedAt - s._releasedAt}ms after release` : f.stuck ? 'stuck in a block' : 'still flying';
      } else s.note = 'No projectile appeared after release. Check the held item, ammo, and server_log.';
      delete s._flight;
      delete s._releasedAt;
    }
  } finally {
    bot.off('entitySpawn', onSpawn);
    bot.off('physicsTick', sample);
  }

  const seen = eventsSince(started);
  const explosions = seen.filter((e) => e.kind === 'explosion').map((e) => ({ atMs: e.at - started, position: e.position }));
  const entities = [...watched.values()].map((w) => {
    const died = dead.has(w.entity.id) || seen.some((e) => e.kind === 'death' && e.entityId === w.entity.id);
    const gone = !bot.entities[w.entity.id];
    return {
      id: w.entity.id,
      name: w.entity.name,
      healthBefore: w.healthBefore,
      healthAfter: died ? 0 : gone ? null : health(w.entity),
      died,
      ...(gone && !died ? { gone: 'left render range or was removed' } : {}),
      timesHurt: seen.filter((e) => e.kind === 'hurt' && e.entityId === w.entity.id).length,
      maxUpwardVelocity: round(w.maxUpwardVelocity),
      maxHorizontalVelocity: round(w.maxHorizontalVelocity),
      moved: round(w.entity.position.distanceTo(w.start)),
      distanceToNearestExplosion: explosions.length ? round(Math.min(...explosions.map((x) => w.start.distanceTo(new Vec3(...x.position))))) : null,
    };
  });
  return {
    item: held.name,
    power: round(power),
    ammo: spec.ammo ? { before: ammoBefore, after: ammoCount() } : undefined,
    shots,
    explosions,
    entities,
    bot: { healthBefore: botHealthBefore, healthAfter: bot.health },
    chat: chat.filter((c) => c.at >= started).map((c) => c.text),
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
  shoot,
  async use_item({ entityId, trackTicks = 0, holdTicks = 5 } = {}) {
    // Right-clicking a mob with a bow only interacts with it; aim and fire instead.
    if (rangedSpec(bot.heldItem?.name)) {
      const out = await shoot({ entityId, trackTicks: trackTicks || 60 });
      return { note: `${bot.heldItem?.name} is a ranged item, so use_item fired it with shoot.`, ...out };
    }
    if (entityId != null) {
      const e = entity(entityId);
      await bot.lookAt(e.position.offset(0, (e.height || 1.6) * 0.8, 0), true);
      await bot.activateEntity(e);
      return trackTicks ? { used: bot.heldItem?.name, on: e.id, after: await track(e, trackTicks) } : { used: bot.heldItem?.name, on: e.id };
    }
    bot.activateItem();
    await bot.waitForTicks(Math.max(1, Number(holdTicks) || 5));
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

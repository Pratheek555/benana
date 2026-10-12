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
const nbt = require('prismarine-nbt');

const { MC_PORT, MC_VERSION, BOT_NAME, VIEWER_PORT, VIEWER_FIRST_PERSON, CAMERA_NAME } = process.env;

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
  bot._client.on('explosion', (p) => {
    record({ kind: 'explosion', position: [round(p.x), round(p.y), round(p.z)] });
    sense('explosion', 'explosion', [p.x, p.y, p.z]);
  });
  bot.on('particle', (p) => !NOISY_PARTICLES.has(p.name) && sense('particle', p.name || String(p.id), [p.position.x, p.position.y, p.position.z], p.count || 1));
  // Mineflayer names sounds one off (minecraft-data's sound ids start at 1), so decode the packets here.
  const heardSound = (holder, at) => {
    const name = String(holder?.data?.soundName ?? bot.registry.sounds[(holder?.soundId ?? -2) + 1]?.name ?? '').replace(/^minecraft:/, '');
    if (name && !NOISY_SOUNDS.test(name)) sense('sound', name, at);
  };
  bot._client.on('sound_effect', (p) => heardSound(p.sound, [p.x / 8, p.y / 8, p.z / 8]));
  bot._client.on('entity_sound_effect', (p) => {
    const e = bot.entities[p.entityId];
    if (e) heardSound(p.sound, [e.position.x, e.position.y, e.position.z]);
  });
  // The server setting the bot's velocity (a plugin's setVelocity, knockback) arrives as entity_velocity.
  bot._client.on('entity_velocity', (p) => {
    if (p.entityId !== bot.entity?.id) return;
    const vy = (p.velocity?.y ?? p.velocityY ?? 0) / 8000;
    if (vy > 0.6) followLaunch(vy);
  });
  bot.on('entityHurt', (e) => e === bot.entity && setTimeout(() => fx({ kind: 'hurt', health: bot.health }), 150));
  send({ event: 'status', bot: 'online' });
});

// Particles, sounds, launches and hurts near the bot: what a player would see and hear but the 3D viewer
// does not draw. Kept for the `particles_and_sounds` tool and streamed to the live view in short batches.
const NOISY_PARTICLES = new Set(['block', 'damage_indicator', 'entity_effect', 'ambient_entity_effect']);
const NOISY_SOUNDS = /\.step$|\.ambient$|\.swim$|\.splash$|_fall$|entity\.item\.pickup|entity\.player\.attack\.(nodamage|weak)/;
const sensed = [];
const fxBatch = new Map();
function sense(kind, name, at, count = 1) {
  if (!bot.entity) return;
  const distance = bot.entity.position.distanceTo(new Vec3(at[0], at[1], at[2]));
  if (distance > 32) return;
  sensed.push({ at: Date.now(), kind, name, count, position: at.map(round), distance: round(distance) });
  if (sensed.length > 1000) sensed.shift();
  const key = `${kind}:${name}`;
  const prev = fxBatch.get(key);
  fxBatch.set(key, { kind, name, count: (prev?.count || 0) + count, distance: Math.min(prev?.distance ?? Infinity, round(distance)) });
}
function fx(item) { fxBatch.set(`${item.kind}:${Date.now()}:${Math.random()}`, item); }
setInterval(() => {
  if (!fxBatch.size) return;
  send({ event: 'fx', fx: [...fxBatch.values()] });
  fxBatch.clear();
}, 250);

// After the server throws the bot, follow it until it lands to report how high it went.
let launchWatch = null;
function followLaunch(vy) {
  if (launchWatch) return;
  const startY = bot.entity.position.y;
  let peak = startY;
  let ticks = 0;
  launchWatch = () => {
    peak = Math.max(peak, bot.entity.position.y);
    if (++ticks > 3 && (bot.entity.onGround || ticks > 120)) {
      bot.off('physicsTick', launchWatch);
      launchWatch = null;
      fx({ kind: 'launch', velocity: round(vy), height: round(peak - startY) });
    }
  };
  bot.on('physicsTick', launchWatch);
}
bot.on('entityDead', (e) => { dead.add(e.id); record({ kind: 'death', entityId: e.id, name: e.name, position: vec(e.position) }); });
bot.on('entityHurt', (e) => e && record({ kind: 'hurt', entityId: e.id, name: e.name || e.username, position: vec(e.position) }));
bot.on('entityGone', (e) => dead.delete(e.id));
// Action bar and title text count as chat too: plugins often show cooldowns and status there.
function heard(text, kind) {
  if (!String(text).trim()) return;
  chat.push({ text, at: Date.now(), ...(kind ? { kind } : {}) });
  if (chat.length > 500) chat.shift();
  send({ event: 'chat', text: kind ? `[${kind}] ${text}` : text });
}
bot.on('messagestr', (text, position) => heard(text, position === 'game_info' ? 'actionbar' : null));
bot.on('title', (text, type) => heard(plain(text), type === 'subtitle' ? 'subtitle' : 'title'));
// Paper's sendActionBar and /title actionbar use their own packet, which Mineflayer does not surface.
bot._client.on('action_bar', (p) => heard(plain(p.text), 'actionbar'));
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

// Text components arrive as strings, JSON chat, or NBT (item names in 1.21); flatten any of them to plain text.
function plain(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(plain).join('');
  if (typeof v !== 'object') return String(v);
  if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) return v.toString();
  if (v.type && 'value' in v) { try { return plain(nbt.simplify(v)); } catch { return plain(v.value); } }
  return `${v.text ?? v[''] ?? v.translate ?? ''}${plain(v.extra)}`;
}

// An item with the details a mod changes: custom name, lore, and the resource-pack model it renders with.
function describeItem(i) {
  if (!i) return null;
  const c = (k) => i.componentMap?.get(k)?.data;
  const out = { name: i.name, count: i.count };
  if (i.slot != null) out.slot = i.slot;
  const custom = c('custom_name') ?? c('item_name');
  if (custom != null) out.customName = plain(custom);
  if (c('item_model') != null) out.itemModel = String(c('item_model'));
  if (c('lore') != null) out.lore = [].concat(c('lore')).map(plain);
  if (c('custom_model_data') != null) out.customModelData = c('custom_model_data');
  if (c('enchantments') != null || i.enchants?.length) out.enchantments = (i.enchants || []).map((e) => `${e.name} ${e.lvl}`);
  return out;
}

function effects(e) {
  return Object.values(e.effects || {}).map((x) => ({
    name: bot.registry.effects[x.id]?.name || String(x.id),
    level: x.amplifier + 1,
    seconds: x.duration < 0 ? 'infinite' : round(x.duration / 20),
  }));
}

function describe(e) {
  const out = {
    id: e.id,
    type: e.type,
    name: e.name || e.username || e.displayName,
    position: vec(e.position),
    velocity: vec(e.velocity),
    distance: round(bot.entity.position.distanceTo(e.position)),
    onGround: e.onGround,
    health: health(e),
  };
  const label = plain(e.metadata?.[2]);
  if (label) out.customName = label;
  if (e.name === 'item') { try { out.item = describeItem(e.getDroppedItem()); } catch {} }
  return out;
}

// Samples the bot itself every tick while `during` runs (or for `ticks`): the bot is the test subject for
// mods that launch, pull, push or boost the player. A launch is a tick where upward velocity jumps above 0.6.
async function trackSelf(ticks = 40, during = null) {
  const me = bot.entity;
  const start = me.position.clone();
  const healthBefore = bot.health;
  const samples = [];
  let minHealth = bot.health;
  let launches = 0;
  let prevVy = me.velocity.y;
  const startedAt = Date.now();
  const onTick = () => {
    const vy = me.velocity.y;
    if (vy > 0.6 && prevVy <= 0.6) launches++;
    prevVy = vy;
    minHealth = Math.min(minHealth, bot.health);
    samples.push({ tick: samples.length, ms: Date.now() - startedAt, pos: vec(me.position), vel: vec(me.velocity), onGround: me.onGround });
  };
  bot.on('physicsTick', onTick);
  try {
    if (during) await during();
    const limit = Math.min(Math.max(Number(ticks) || 40, 1), 400);
    while (samples.length < limit) await bot.waitForTicks(1);
  } finally {
    bot.off('physicsTick', onTick);
  }
  const end = me.position;
  const ys = samples.map((s) => s.pos[1]);
  const launchTicks = [];
  for (let i = 1; i < samples.length; i++) if (samples[i].vel[1] > 0.6 && samples[i - 1].vel[1] <= 0.6) launchTicks.push(i);
  return {
    subject: 'bot',
    start: vec(start),
    end: vec(end),
    maxUpwardVelocity: round(Math.max(0, ...samples.map((s) => s.vel[1]))),
    maxHorizontalSpeed: round(Math.max(0, ...samples.map((s) => Math.hypot(s.vel[0], s.vel[2])))),
    maxHeightGain: round(Math.max(0, ...ys.map((y) => y - start.y))),
    horizontalDistance: round(Math.hypot(end.x - start.x, end.z - start.z)),
    launches,
    launchTicks,
    landed: me.onGround,
    health: { before: healthBefore, min: minHealth, after: bot.health },
    effects: effects(me),
    // Every other tick keeps the shape of a launch without flooding the context.
    samples: samples.filter((_, i) => i % 2 === 0).slice(0, 80),
  };
}

function blockAt(p) {
  const pos = new Vec3(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));
  return { pos, block: bot.blockAt(pos) };
}

async function within(pos, reach = 4.2) {
  if (bot.entity.position.offset(0, 1.6, 0).distanceTo(pos.offset(0.5, 0.5, 0.5)) > reach) {
    await tools.move_to({ position: [pos.x + 0.5, pos.y, pos.z + 0.5], range: 3 });
  }
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
      entityId: bot.entity.id,
      position: vec(bot.entity.position),
      velocity: vec(bot.entity.velocity),
      onGround: bot.entity.onGround,
      health: bot.health,
      food: bot.food,
      gameMode: bot.game.gameMode,
      effects: effects(bot.entity),
      heldItem: describeItem(bot.heldItem),
      inventory: bot.inventory.items().map(describeItem),
    };
  },
  async track_self({ ticks = 40 } = {}) {
    return trackSelf(ticks);
  },
  // Holds movement keys for a number of ticks and records how the bot moved, e.g. jumping with a boost,
  // sprinting onto a pad, or sneaking. yaw is in degrees (0 = south/+z, 90 = west/-x).
  async move({ forward, back, left, right, jump, sprint, sneak, ticks = 20, yaw, lookAt } = {}) {
    if (Array.isArray(lookAt)) await bot.lookAt(new Vec3(...lookAt), true);
    else if (yaw != null) await bot.look((-Number(yaw) * Math.PI) / 180 + Math.PI, 0, true);
    const keys = { forward, back, left, right, jump, sprint, sneak };
    const held = Object.entries(keys).filter(([, on]) => on).map(([k]) => k);
    const hold = Math.min(Math.max(Number(ticks) || 20, 1), 200);
    const out = await trackSelf(hold + 20, async () => {
      for (const k of held) bot.setControlState(k, true);
      await bot.waitForTicks(hold);
      bot.clearControlStates();
    });
    return { held, ticks: hold, ...out };
  },
  async place_block({ item, position }) {
    if (item) await tools.equip({ item });
    if (!bot.heldItem) throw new Error('Hold a block to place (pass item).');
    const { pos, block } = blockAt(position);
    if (block && block.name !== 'air' && block.name !== 'cave_air') throw new Error(`${vec(pos)} already holds ${block.name}.`);
    const faces = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    const ref = faces.map((f) => ({ face: new Vec3(-f[0], -f[1], -f[2]), block: bot.blockAt(pos.offset(...f)) }))
      .find((r) => r.block && r.block.boundingBox === 'block');
    if (!ref) throw new Error(`Nothing solid next to ${vec(pos)} to place against.`);
    await within(pos);
    const started = Date.now();
    await bot.placeBlock(ref.block, ref.face);
    await bot.waitForTicks(4);
    return { placed: bot.blockAt(pos)?.name, at: vec(pos), chat: chat.filter((c) => c.at >= started).map((c) => c.text) };
  },
  async dig_block({ position }) {
    const { pos, block } = blockAt(position);
    if (!block || block.name === 'air') throw new Error(`No block at ${vec(pos)}.`);
    await within(pos);
    const before = new Map(bot.inventory.items().map((i) => [i.name, 0]));
    for (const i of bot.inventory.items()) before.set(i.name, before.get(i.name) + i.count);
    const started = Date.now();
    await bot.dig(block, true);
    // Drops can't be picked up for 10 ticks.
    await bot.waitForTicks(20);
    const gained = {};
    for (const i of bot.inventory.items()) gained[i.name] = (gained[i.name] || 0) + i.count;
    for (const [k, n] of before) gained[k] = (gained[k] || 0) - n;
    return {
      dug: block.name,
      at: vec(pos),
      nowThere: bot.blockAt(pos)?.name,
      inventoryGained: Object.fromEntries(Object.entries(gained).filter(([, n]) => n)),
      drops: Object.values(bot.entities).filter((e) => e.name === 'item' && e.position.distanceTo(pos) < 3).map(describe),
      chat: chat.filter((c) => c.at >= started).map((c) => c.text),
    };
  },
  async boss_bars() {
    return Object.values(bot.bossBars || {}).map((b) => ({ title: plain(b.title), health: round(b.health), color: b.color, dividers: b.dividers }));
  },
  async nearby_entities({ radius = 16 } = {}) {
    return Object.values(bot.entities)
      // The spectator camera is not part of the test.
      .filter((e) => e !== bot.entity && !dead.has(e.id) && !(CAMERA_NAME && e.username === CAMERA_NAME) && e.position.distanceTo(bot.entity.position) <= radius)
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
  async use_item({ entityId, position, trackTicks = 0, trackSelf: selfTicks = 0, holdTicks = 5 } = {}) {
    // Right-clicking a mob with a bow only interacts with it; aim and fire instead.
    if (rangedSpec(bot.heldItem?.name) && !selfTicks) {
      const out = await shoot({ entityId, position, trackTicks: trackTicks || 60 });
      return { note: `${bot.heldItem?.name} is a ranged item, so use_item fired it with shoot.`, ...out };
    }
    const started = Date.now();
    const used = describeItem(bot.heldItem);
    const heard = () => chat.filter((c) => c.at >= started).map((c) => (c.kind ? `[${c.kind}] ${c.text}` : c.text));
    let action;
    let on = null;
    let e = null;
    if (entityId != null) {
      e = entity(entityId);
      on = e.id;
      await bot.lookAt(e.position.offset(0, (e.height || 1.6) * 0.8, 0), true);
      action = () => bot.activateEntity(e);
    } else if (Array.isArray(position)) {
      // Right-click a block in reach; past reach the client sends a plain right-click while looking at it,
      // which is what a player aiming a grapple or wand at a far block does.
      const { pos, block } = blockAt(position);
      on = { position: vec(pos), block: block?.name || 'unloaded' };
      await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
      const reach = bot.entity.position.offset(0, 1.62, 0).distanceTo(pos.offset(0.5, 0.5, 0.5));
      action = block && block.boundingBox === 'block' && reach <= 4.5
        ? () => bot.activateBlock(block)
        : async () => { bot.activateItem(); await bot.waitForTicks(Math.max(1, Number(holdTicks) || 5)); bot.deactivateItem(); };
    } else {
      action = async () => { bot.activateItem(); await bot.waitForTicks(Math.max(1, Number(holdTicks) || 5)); bot.deactivateItem(); };
    }
    if (selfTicks) {
      const self = await trackSelf(selfTicks, action);
      return { used, on, self, chat: heard() };
    }
    await action();
    const after = e && trackTicks ? await track(e, trackTicks) : await bot.waitForTicks(2);
    return { used, on, ...(after ? { after } : {}), effects: effects(bot.entity), chat: heard() };
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
  // Grouped by kind and name: how many, when first and last, and the nearest position.
  async particles_and_sounds({ sinceMs = 0, radius = 32 } = {}) {
    const groups = new Map();
    for (const e of sensed) {
      if (e.at < sinceMs || e.distance > radius) continue;
      const key = `${e.kind}:${e.name}`;
      const g = groups.get(key) || { kind: e.kind, name: e.name, count: 0, events: 0, firstAt: e.at, lastAt: e.at, nearest: e.position, distance: e.distance };
      g.count += e.count;
      g.events += 1;
      g.lastAt = e.at;
      if (e.distance < g.distance) { g.distance = e.distance; g.nearest = e.position; }
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.firstAt - b.firstAt);
  },
};

// What a player's screen would show that the 3D viewer cannot: the hotbar (with each item's resource-pack
// model), boss bars, health, effects, the action bar, and mod items lying nearby. Sent only when it changes.
let lastHud = '';
setInterval(() => {
  if (!bot.entity || !bot.inventory) return;
  const recent = chat.filter((c) => c.kind === 'actionbar' && Date.now() - c.at < 3000).pop();
  const hud = {
    selected: bot.quickBarSlot,
    hotbar: Array.from({ length: 9 }, (_, i) => describeItem(bot.inventory.slots[36 + i])),
    bossBars: Object.values(bot.bossBars || {}).map((b) => ({ title: plain(b.title), health: round(b.health), color: b.color })),
    health: bot.health,
    effects: effects(bot.entity),
    actionbar: recent?.text || null,
    ground: Object.values(bot.entities)
      .filter((e) => e.name === 'item' && !dead.has(e.id) && e.position.distanceTo(bot.entity.position) <= 16)
      .map((e) => { try { return { id: e.id, distance: round(e.position.distanceTo(bot.entity.position)), item: describeItem(e.getDroppedItem()) }; } catch { return null; } })
      .filter((g) => g?.item && (g.item.itemModel || g.item.customName))
      .slice(0, 4),
  };
  const key = JSON.stringify({ ...hud, ground: hud.ground.map((g) => [g.id, Math.round(g.distance)]) });
  if (key === lastHud) return;
  lastHud = key;
  send({ event: 'hud', hud });
}, 300);

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

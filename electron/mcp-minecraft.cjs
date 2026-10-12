#!/usr/bin/env node
// Benana minecraft MCP server (stdio, newline-delimited JSON-RPC). Owner: Track A.
// Gives a Claude Code playtester control of the in-game bot through Benana's local control API,
// and records the verdict file the studio pipeline reads (docs/hackathon/CONTRACTS.md).
// Env: BENANA_GAME_URL, BENANA_VERDICT_FILE, BENANA_TEST_PLAN, BENANA_RUN_ID.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const gameUrl = process.env.BENANA_GAME_URL;
const verdictFile = process.env.BENANA_VERDICT_FILE;
const testPlanFile = process.env.BENANA_TEST_PLAN;
const runId = process.env.BENANA_RUN_ID || 'manual';
const startedAt = Date.now();

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const entityId = { type: 'number', description: 'Entity id from nearby_entities' };
const position = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z]' };
const trackTicks = { type: 'number', description: 'Record the target for this many ticks right after the action (20 ticks = 1s). Use it whenever the expected effect is movement.' };

const tools = [
  { name: 'game_setup', description: 'Run server console commands as the bot (no leading slash). `@bot` is the bot; ^ and ~ coordinates are relative to it. Use for the test plan setup: give items, summon mobs, set time.', inputSchema: obj({ commands: { type: 'array', items: { type: 'string' } } }, ['commands']) },
  { name: 'reset_arena', description: 'Rebuild the flat arena, remove all mobs, items and projectiles, and put the bot back at the center with an empty inventory. Use it between checks when an earlier check left mobs, craters or a cooldown state behind; then rerun your setup.', inputSchema: obj({}) },
  { name: 'bot_state', description: 'Bot entity id, position, velocity, health, active effects, held item and inventory. Each item lists customName, lore and itemModel (the resource-pack model a mod gave it, e.g. "benana:storm_core").', inputSchema: obj({}) },
  { name: 'nearby_entities', description: 'Entities near the bot (not the bot itself) with id, type, position, velocity, distance, health (living entities) and customName, nearest first. Dropped items include the item stack (name, customName, itemModel).', inputSchema: obj({ radius: { type: 'number' } }) },
  { name: 'equip', description: 'Hold an inventory item, e.g. golden_sword.', inputSchema: obj({ item: { type: 'string' } }, ['item']) },
  { name: 'look_at', description: 'Aim at an entity or position.', inputSchema: obj({ entityId, position }) },
  { name: 'move_to', description: 'Walk to an entity or position (pathfinding). Walk onto a dropped item to pick it up.', inputSchema: obj({ entityId, position, range: { type: 'number' } }) },
  {
    name: 'move',
    description: 'Hold movement keys for `ticks` and record the BOT itself every tick (position, velocity, height gain, launches, health, effects). Use it for jump boosts, speed, jump pads, double jumps, sneaking and sprinting. yaw in degrees (0 = +z, 90 = -x) or lookAt [x,y,z] sets the facing first.',
    inputSchema: obj({
      forward: { type: 'boolean' }, back: { type: 'boolean' }, left: { type: 'boolean' }, right: { type: 'boolean' },
      jump: { type: 'boolean' }, sprint: { type: 'boolean' }, sneak: { type: 'boolean' },
      ticks: { type: 'number', description: 'How long to hold the keys (default 20); the bot is recorded 20 ticks longer' },
      yaw: { type: 'number' }, lookAt: position,
    }),
  },
  { name: 'track_self', description: 'Record the BOT itself for `ticks` without acting: max upward velocity, max height gain, launches (with the tick of each), horizontal distance, health before/min/after, effects. Use it when the mod acts on the player by itself (a boss slam, an aura, a timed launch).', inputSchema: obj({ ticks: { type: 'number', description: 'Default 40, max 400' } }) },
  { name: 'attack', description: 'Left-click (hit) an entity with the held item. Walks into reach first if needed.', inputSchema: obj({ entityId, trackTicks }, ['entityId']) },
  { name: 'attack_sequence', description: 'Hit several entities back to back, intervalTicks apart (default 4), in ONE call, and track each. Use for cooldowns and combos; separate attack calls are seconds apart.', inputSchema: obj({ entityIds: { type: 'array', items: { type: 'number' } }, intervalTicks: { type: 'number' }, trackTicks }, ['entityIds']) },
  {
    name: 'use_item',
    description: 'Right-click with the held item: on an entity (entityId), at a block or far point (position: aims at it first, right-clicks the block when in reach), or in the air. trackTicks records the target entity afterwards; trackSelf records the BOT (use it for grapples, dashes, self-launches, consumables). Returns the item used, chat/action-bar lines, and the bot effects. For bows, crossbows, tridents and throwables use `shoot`.',
    inputSchema: obj({ entityId, position, trackTicks, trackSelf: { type: 'number', description: 'Record the bot itself for this many ticks, starting with the click' }, holdTicks: { type: 'number' } }),
  },
  { name: 'place_block', description: 'Place a block as a player (fires BlockPlaceEvent, unlike setblock). Needs a solid block next to the position.', inputSchema: obj({ item: { type: 'string', description: 'Block item to equip first' }, position }, ['position']) },
  { name: 'dig_block', description: 'Break a block as a player (fires BlockBreakEvent). Returns what dropped and what the inventory gained.', inputSchema: obj({ position }, ['position']) },
  { name: 'boss_bars', description: 'Boss bars the bot sees: title, health (0-1), color.', inputSchema: obj({}) },
  { name: 'particles_and_sounds', description: 'Particles and sounds the server sent within `radius` blocks of the bot (default 32) since a unix ms timestamp, grouped by name with count, first/last time and nearest position, e.g. particle "explosion" or sound "entity.iron_golem.attack". Evidence for visual and audio effects.', inputSchema: obj({ sinceMs: { type: 'number' }, radius: { type: 'number' } }) },
  {
    name: 'showcase',
    description: 'Demo captions over the live view. Call once with `steps` (3-7 short titles, the outline), then with `step` (1-based) and a `note` (what to watch for) as each one starts.',
    inputSchema: obj({ steps: { type: 'array', items: { type: 'string' } }, step: { type: 'number' }, note: { type: 'string' } }),
  },
  {
    name: 'shoot',
    description: 'Fire the held bow, crossbow, trident or throwable (snowball, egg, ender_pearl, wind_charge, splash_potion) at a target, aiming for the arc. Draws the bow fully (chargeTicks, default 22) and releases. Pass entityIds to fire several shots back to back in ONE call (for cooldowns). Returns each projectile (spawned or not, where it was last seen, whether it was removed), every explosion the bot saw with its position, the bot ammo before/after, chat during the shots, and for EVERY living entity within radius: health before/after, died, times hurt, max upward/horizontal velocity, maxHeightGain, distance to the nearest explosion, and impactDistance (horizontal distance to where the projectile landed: start, closest, closestAtMs, end). For effects that last after the impact (a black hole, a delayed blast, a cloud), pass watchTicks to keep recording that long in the SAME call. Keep targets 5-15 blocks away.',
    inputSchema: obj({
      entityId,
      entityIds: { type: 'array', items: { type: 'number' }, description: 'Shoot each in order, in one call' },
      position,
      item: { type: 'string', description: 'Equip this item first, e.g. bow' },
      chargeTicks: { type: 'number', description: 'Bow/trident draw time in ticks (bow: 22 = full power)' },
      intervalTicks: { type: 'number', description: 'Extra ticks between shots in a sequence (default 0)' },
      trackTicks: { type: 'number', description: 'Max ticks to watch after the last shot (default 60)' },
      watchTicks: { type: 'number', description: 'Keep recording this many ticks after every projectile has landed, for lingering effects (max 300)' },
      radius: { type: 'number', description: 'Report living entities within this many blocks (default 24)' },
    }),
  },
  { name: 'track_entity', description: 'Sample an entity every tick: position, velocity, and position delta, plus maxUpwardVelocity and maxHeightGain.', inputSchema: obj({ entityId, ticks: { type: 'number' } }, ['entityId']) },
  { name: 'wait_ticks', description: 'Let the game run (20 ticks = 1 second).', inputSchema: obj({ ticks: { type: 'number' } }, ['ticks']) },
  { name: 'chat', description: 'Say something or run a player command like /launch.', inputSchema: obj({ message: { type: 'string' } }, ['message']) },
  { name: 'read_chat', description: 'Chat, action bar and title messages the bot has seen (action bar and titles carry a kind), optionally since a unix ms timestamp.', inputSchema: obj({ sinceMs: { type: 'number' } }) },
  { name: 'server_log', description: 'Server console lines since a unix ms timestamp (default: since this playtest started). level "error" shows plugin exceptions.', inputSchema: obj({ sinceMs: { type: 'number' }, level: { type: 'string', enum: ['error', 'warn'] } }) },
  {
    name: 'report_check',
    description: 'Record the result of one test plan check. Call once per check id.',
    inputSchema: obj({
      id: { type: 'string' },
      status: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
      expected: { type: 'string' },
      observed: { type: 'string', description: 'What actually happened, with numbers' },
      evidence: { type: 'object', description: 'Measurements, samples, or log lines supporting the result' },
      suspectedCause: { type: 'string', description: 'For failures: your best guess at the plugin bug' },
    }, ['id', 'status', 'expected', 'observed']),
  },
  { name: 'finish', description: 'Finalize the playtest after every check in the test plan is reported (use status blocked for checks you could not run).', inputSchema: obj({ summary: { type: 'string' } }, ['summary']) },
];

async function game(tool, args) {
  if (!gameUrl) throw new Error('BENANA_GAME_URL is not set; start the game in Benana first.');
  const res = await fetch(`${gameUrl}/tool/${tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error);
  return out.result;
}

function readVerdict() {
  try { return JSON.parse(fs.readFileSync(verdictFile, 'utf8')); }
  catch { return { version: 1, runId, finished: false, passed: false, summary: '', checks: [], serverErrors: [] }; }
}

function writeVerdict(v) {
  if (!verdictFile) throw new Error('BENANA_VERDICT_FILE is not set.');
  fs.mkdirSync(path.dirname(verdictFile), { recursive: true });
  fs.writeFileSync(verdictFile, JSON.stringify(v, null, 2));
}

// Group console error lines and their stack frames into one entry per exception.
function groupErrors(lines) {
  const out = [];
  for (const l of lines) {
    const frame = /^\s*(at |Caused by|\.\.\. \d+ more)/.test(l.line);
    if (frame && out.length) out[out.length - 1].stack += `${l.line}\n`;
    else out.push({ at: l.at, message: l.line, stack: '' });
  }
  return out;
}

function planCheckIds() {
  try { return (JSON.parse(fs.readFileSync(testPlanFile, 'utf8')).checks || []).map((c) => c.id); } catch { return []; }
}

let finishWarned = false;

async function call(name, a) {
  if (name === 'server_log') return game('server_log', { sinceMs: a.sinceMs ?? startedAt, level: a.level });
  if (name === 'report_check') {
    const v = readVerdict();
    const check = { id: a.id, status: a.status, expected: a.expected, observed: a.observed, evidence: a.evidence || {}, ...(a.suspectedCause ? { suspectedCause: a.suspectedCause } : {}) };
    v.checks = [...v.checks.filter((c) => c.id !== a.id), check];
    writeVerdict(v);
    return { recorded: a.id, checks: v.checks.length };
  }
  if (name === 'finish') {
    const v = readVerdict();
    const missing = planCheckIds().filter((id) => !v.checks.some((c) => c.id === id));
    if (missing.length && !finishWarned) {
      finishWarned = true;
      throw new Error(`These test plan checks were never reported: ${missing.join(', ')}. Run them now (reset_arena first if the world is in a bad state) and report_check each one. If a check truly cannot be run, report it with status "blocked" and say why. Unreported checks count as blocked.`);
    }
    for (const id of missing) v.checks.push({ id, status: 'blocked', expected: '', observed: 'The playtester finished without reporting this check.', evidence: {} });
    v.serverErrors = groupErrors(await game('server_log', { sinceMs: startedAt, level: 'error' }));
    v.finished = true;
    v.summary = a.summary;
    v.passed = v.checks.length > 0 && v.checks.every((c) => c.status === 'pass') && v.serverErrors.length === 0;
    writeVerdict(v);
    return { passed: v.passed, checks: v.checks.map((c) => `${c.id}: ${c.status}`), serverErrors: v.serverErrors.length };
  }
  return game(name, a);
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = req;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'benana-minecraft', version: '0.1.0' } } });
    } else if (method === 'tools/list') {
      send({ id, result: { tools } });
    } else if (method === 'tools/call') {
      const out = await call(params.name, params.arguments || {});
      send({ id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
    } else if (method === 'ping') {
      send({ id, result: {} });
    } else {
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
  }
});

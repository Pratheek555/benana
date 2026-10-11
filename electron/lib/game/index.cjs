// Game runtime: local Paper server, the Mineflayer test bot, and the in-app viewer.
// Owner: Track A. Interface: docs/hackathon/CONTRACTS.md.
// BENANA_GAME_MOCK=1 returns canned results so the studio pipeline can be built before the real runtime lands.
//
// Process layout: Electron main runs the Paper server (server.cjs) and a local HTTP control API that the
// `minecraft` MCP server calls. The bot and viewer run in host.cjs under system Node, because Mineflayer
// needs Node 22+ and Electron 33 ships Node 20.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { appRoot } = require('../env.cjs');
const { resolveExecutable, spawnExecutable, terminateProcessTree } = require('../processes.cjs');
const { Server, VERSION, PORT } = require('./server.cjs');

const BOT = 'BenanaBot';
// The bot is kept near this spot so it stays inside the viewer's fixed camera orbit.
const ARENA = [0.5, 65, 0.5];
const VIEWER_PORT = Number(process.env.BENANA_VIEWER_PORT) || 3007;
const HOST = path.join(__dirname, 'host.cjs');
const MCP = path.join(appRoot, 'electron', 'mcp-minecraft.cjs');
const mock = () => process.env.BENANA_GAME_MOCK === '1';

const BOT_TOOLS = new Set(['bot_state', 'nearby_entities', 'equip', 'look_at', 'move_to', 'attack', 'attack_sequence', 'use_item', 'shoot', 'track_entity', 'wait_ticks', 'chat', 'read_chat']);
const TOOLS = ['game_setup', 'reset_arena', ...BOT_TOOLS, 'server_log', 'report_check', 'finish'];
const playtesterTools = TOOLS.map((t) => `mcp__minecraft__${t}`);

// deployed: the studio mod whose jar is in the server's plugins folder; deploying: the one being swapped in.
let state = { server: 'stopped', bot: 'offline', viewerUrl: null, controlUrl: null, version: VERSION, mock: mock(), error: null, deployed: null, deploying: null, resetting: false };
let emitter = () => {};

function setState(patch) {
  state = { ...state, ...patch, mock: mock() };
  emitter('game:status', state);
  return state;
}

const status = () => ({ ...state, mock: mock() });

const server = new Server();

// Studio jars are copied in as studio-<ModName>.jar.
function deployedOnDisk() {
  try {
    const jar = fs.readdirSync(server.pluginsDir()).find((f) => /^studio-.*\.jar$/.test(f));
    return jar ? { plugin: jar.replace(/^studio-|\.jar$/g, '') } : null;
  } catch { return null; }
}
state.deployed = deployedOnDisk();
let host = null;
let control = null;
const pending = new Map();
let seq = 0;

function systemNode() {
  const out = spawnSync(resolveExecutable('node'), ['-p', 'process.versions.node'], { encoding: 'utf8', windowsHide: true });
  const major = Number(String(out.stdout || '').trim().split('.')[0]);
  if (!major) throw new Error('System Node was not found on PATH. The game bot needs Node 22 or newer.');
  if (major < 22) throw new Error(`The game bot needs Node 22 or newer on PATH (found ${out.stdout.trim()}).`);
}

function startHost() {
  return new Promise((resolve, reject) => {
    const child = spawnExecutable('node', [HOST], {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env, MC_PORT: String(PORT), MC_VERSION: VERSION, BOT_NAME: BOT,
        VIEWER_PORT: String(VIEWER_PORT), VIEWER_FIRST_PERSON: process.env.BENANA_VIEW === 'first' ? '1' : '0',
      },
    });
    host = child;
    setState({ bot: 'connecting' });
    const timer = setTimeout(() => reject(new Error('The bot did not join within 60 seconds.')), 60000);
    const forward = (d) => String(d).split(/\r?\n/).filter(Boolean)
      .forEach((line) => emitter('game:log', { line: `[bot] ${line}`, level: 'info', at: Date.now() }));
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('message', (msg) => {
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        return msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
      }
      if (msg.event === 'status') {
        setState({ bot: msg.bot, ...(msg.error ? { error: msg.error } : {}) });
        if (msg.bot === 'online') { clearTimeout(timer); resolve(); }
      }
      if (msg.event === 'chat') emitter('game:log', { line: `[chat] ${msg.text}`, level: 'info', at: Date.now() });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (host === child) { host = null; setState({ bot: 'offline', viewerUrl: null }); }
      for (const p of pending.values()) p.reject(new Error('The bot disconnected.'));
      pending.clear();
      reject(new Error(`The bot process exited (code ${code}).`));
    });
  });
}

async function stopHost() {
  const child = host;
  if (!child) return;
  host = null;
  const exited = new Promise((res) => child.once('exit', res));
  try { child.disconnect(); } catch {}
  const timer = setTimeout(() => terminateProcessTree(child), 3000);
  await exited;
  clearTimeout(timer);
}

function botCall(tool, args) {
  if (!host) return Promise.reject(new Error('The bot is not connected.'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${tool} timed out`)); }, 60000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    host.send({ id, tool, args });
  });
}

// Rebuilds the flat arena around the bot (grass at y=64) and removes every non-player entity.
// Explosions and bosses from earlier mods leave craters; mobs summoned into them spawn inside blocks and suffocate.
const R = 20;
const ARENA_RESET = [
  'kill @e[type=!player]',
  `fill -${R} 50 -${R} ${R} 60 ${R} stone`,
  `fill -${R} 61 -${R} ${R} 63 ${R} dirt`,
  `fill -${R} 64 -${R} ${R} 64 ${R} grass_block`,
  `fill -${R} 65 -${R} ${R} 79 ${R} air`,
  `fill -${R} 80 -${R} ${R} 95 ${R} air`,
  'kill @e[type=item]',
];

async function resetArena() {
  for (const cmd of ARENA_RESET) await server.command(cmd);
}

async function prepareWorld() {
  for (const cmd of ['gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doMobSpawning false', 'gamerule sendCommandFeedback false', 'time set day', 'weather clear'])
    await server.command(cmd);
  await resetArena();
}

async function prepareBot() {
  for (const cmd of [`tp ${BOT} ${ARENA.join(' ')} 0 0`, `gamemode survival ${BOT}`, `effect give ${BOT} resistance infinite 4 true`, `effect give ${BOT} saturation infinite 0 true`, `clear ${BOT}`])
    await server.command(cmd);
}

// Tools shared by the MCP server (over HTTP) and the in-app demo controls.
async function runTool(tool, args = {}) {
  if (BOT_TOOLS.has(tool)) return botCall(tool, args);
  if (tool === 'game_setup') {
    const out = [];
    const { position } = await botCall('bot_state');
    if (Math.hypot(position[0] - ARENA[0], position[2] - ARENA[2]) > 8) {
      await server.command(`tp ${BOT} ${ARENA.join(' ')} 0 0`);
      await botCall('wait_ticks', { ticks: 5 });
      out.push({ command: 'tp back to the arena center', output: 'Benana keeps the bot in camera view' });
    }
    for (const raw of args.commands || []) {
      const cmd = String(raw).replace(/^\//, '').replaceAll('@bot', BOT);
      out.push({ command: cmd, output: await server.command(`execute as ${BOT} at ${BOT} run ${cmd}`) });
    }
    return out;
  }
  if (tool === 'reset_arena') {
    await resetArena();
    await prepareBot();
    await botCall('wait_ticks', { ticks: 10 });
    return { reset: true, note: 'Arena rebuilt flat (grass at y=64), all mobs/items/projectiles removed, bot back at the center with an empty inventory. Run your setup commands again. Plugin state such as cooldowns is NOT reset; wait it out.' };
  }
  if (tool === 'server_log') return server.logSince(Number(args.sinceMs) || 0, args.level).slice(-200);
  throw new Error(`Unknown game tool ${tool}`);
}

function startControl() {
  if (control) return Promise.resolve();
  return new Promise((resolve) => {
    control = http.createServer((req, res) => {
      const match = req.method === 'POST' && req.url.match(/^\/tool\/(\w+)$/);
      if (!match) { res.writeHead(404).end(); return; }
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', async () => {
        let args = {};
        try { args = body ? JSON.parse(body) : {}; } catch {}
        const reply = (payload) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
        const action = { tool: match[1], args, at: Date.now() };
        emitter('game:action', action);
        try {
          const result = await runTool(match[1], args);
          emitter('game:action', { ...action, result, done: Date.now() });
          reply({ ok: true, result });
        } catch (e) {
          emitter('game:action', { ...action, error: e.message, done: Date.now() });
          reply({ ok: false, error: e.message });
        }
      });
    });
    control.listen(0, '127.0.0.1', () => {
      setState({ controlUrl: `http://127.0.0.1:${control.address().port}` });
      resolve();
    });
  });
}

async function bootGame() {
  setState({ server: 'starting', error: null });
  await server.start({
    onLine: (l) => emitter('game:log', l),
    log: (text) => emitter('game:log', { line: `[benana] ${text}`, level: 'info', at: Date.now() }),
  });
  setState({ server: 'running' });
  await prepareWorld();
  await startHost();
  await prepareBot();
  setState({ viewerUrl: `http://127.0.0.1:${VIEWER_PORT}` });
}

let booting = null;
async function start(emit = () => {}) {
  emitter = emit;
  if (mock()) return setState({ server: 'running', bot: 'online' });
  if (state.server === 'running' && state.bot === 'online') return status();
  if (!booting) {
    booting = (async () => {
      systemNode();
      await startControl();
      await bootGame();
    })()
      .catch((e) => {
        setState({ server: server.running() ? 'running' : 'error', error: e.message });
        throw e;
      })
      .finally(() => { booting = null; });
  }
  await booting;
  return status();
}

async function stop() {
  demo(false);
  if (mock()) return setState({ server: 'stopped', bot: 'offline' });
  await stopHost();
  await server.stop();
  return setState({ server: 'stopped', bot: 'offline', viewerUrl: null });
}

// Deploys are serialized: a manual mod switch and a pipeline deploy must never restart the server together.
let deployQueue = Promise.resolve();
function deployPlugin(args) {
  const run = deployQueue.then(() => deployNow(args));
  deployQueue = run.catch(() => {});
  return run;
}

async function deployNow({ jarPath, emit }) {
  if (emit) emitter = emit;
  setState({ deploying: path.basename(jarPath, '.jar') });
  try {
    const out = await swapPlugin(jarPath);
    setState({ deployed: out.loaded ? { plugin: out.plugin, jar: jarPath, at: Date.now() } : deployedOnDisk() });
    return out;
  } finally {
    setState({ deploying: null });
  }
}

// Resets the world to its beginning (fresh flat terrain, plugin state cleared) with the loaded mod still installed.
// Queued with deploys so it never restarts the server under one.
function resetWorld(args = {}) {
  const run = deployQueue.then(() => resetNow(args));
  deployQueue = run.catch(() => {});
  return run;
}

async function resetNow({ emit } = {}) {
  if (emit) emitter = emit;
  setState({ resetting: true });
  try {
    demo(false);
    if (mock()) return { loaded: true, plugin: state.deployed?.plugin || null, errors: [], logTail: ['[mock] world reset'] };
    return await rebootFresh();
  } finally {
    setState({ resetting: false });
  }
}

async function swapPlugin(jarPath) {
  if (!fs.existsSync(jarPath)) return { loaded: false, plugin: null, errors: [`Jar not found: ${jarPath}`], logTail: [] };
  if (mock()) return { loaded: true, plugin: path.basename(jarPath, '.jar'), errors: [], logTail: ['[mock] plugin enabled'] };
  return rebootFresh(jarPath);
}

// Stops the game, wipes the saved world so each mod starts on untouched terrain (earlier mods leave craters
// that arena resets never reach), optionally installs a studio jar, and boots a fresh server.
async function rebootFresh(jarPath) {
  systemNode();
  await startControl();
  await stopHost();
  await server.stop();
  setState({ server: 'stopped', bot: 'offline', viewerUrl: null });
  server.wipeWorld();
  if (jarPath) {
    const dir = server.pluginsDir();
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^studio-.*\.jar$/.test(f)) fs.rmSync(path.join(dir, f));
    fs.copyFileSync(jarPath, path.join(dir, `studio-${path.basename(jarPath)}`));
  }
  const since = Date.now();
  await bootGame();
  const lines = server.logSince(since);
  const enabled = lines.map((l) => l.line.match(/\[([^\]]+)\] Enabling (\S+) v/)).find(Boolean);
  const errors = lines.filter((l) => l.level === 'error').map((l) => l.line);
  return { loaded: Boolean(enabled), plugin: enabled ? enabled[2] : null, errors, logTail: lines.slice(-40).map((l) => l.line) };
}

async function runCommand(command) {
  if (mock()) return `[mock] ${command}`;
  return server.command(String(command).replace(/^\//, ''));
}

function mcpConfig({ runId, verdictFile, testPlanFile }) {
  return {
    mcpServers: {
      minecraft: {
        command: 'node',
        args: [MCP],
        env: {
          BENANA_GAME_URL: state.controlUrl || '',
          BENANA_VERDICT_FILE: verdictFile,
          BENANA_TEST_PLAN: testPlanFile,
          BENANA_RUN_ID: String(runId),
        },
      },
    },
  };
}

function playtestPrompt(testPlan) {
  return [
    'You are a Minecraft playtester. You control a real player bot on a local Paper server through the `minecraft` tools.',
    `Mod under test: ${testPlan.modName}: ${testPlan.summary}`,
    'Run `game_setup` with the setup commands, then perform every check like a player would and measure the outcome with tools.',
    '`attack` and `use_item` accept `trackTicks` to record the target right after the action; use it whenever the expected effect is movement.',
    'For bows, crossbows, tridents and throwables, use `shoot` (never `use_item` on a mob: that only right-clicks it). It aims, fires, and reports the projectile, explosions, ammo used, and the health/deaths/knockback of every living entity nearby.',
    'Each tool call takes 1-8 real seconds. For anything timing-sensitive (cooldowns, combos), summon all targets first and do it in ONE call: `attack_sequence` for melee, `shoot` with `entityIds` for ranged.',
    'Start each check from a known state. If an earlier check left mobs, craters, or a cooldown behind, call `reset_arena` and rerun the setup.',
    'Judge each check on direct evidence: shot/explosion/health numbers from the tools, chat lines, and the plugin log lines from `server_log`. A mob disappearing is not proof of anything by itself; find out why (died in an explosion? suffocated? left range?) before you pass a check on it.',
    'If an action did not happen (no projectile, no ammo used, no plugin log line), the check cannot pass. Fix your setup and retry, or report it as blocked with the reason.',
    'Call `report_check` exactly once for EVERY check id in the plan (pass, fail, or blocked), with what you expected, what you observed, and evidence. Check `server_log` for plugin errors.',
    'Finish with `finish` only after every check is reported. Do not edit files.',
    '',
    'Test plan:',
    JSON.stringify(testPlan, null, 2),
  ].join('\n');
}

// A showcase for the user watching the live view: no verdicts, no pass/fail, just the mod doing its thing.
const DEMO_TOOLS = TOOLS.filter((t) => t !== 'report_check' && t !== 'finish').map((t) => `mcp__minecraft__${t}`);

function demoPrompt({ testPlan, spec }) {
  return [
    'You are showing a user what a Minecraft mod can do. A person is watching the bot through a live camera while you drive it with the `minecraft` tools. This is a demo, not a test: do not judge anything.',
    `Mod: ${testPlan.modName}: ${testPlan.summary}`,
    ...(spec?.behavior?.length ? ['Behavior:', ...spec.behavior.map((b) => `- ${b}`)] : []),
    '',
    'Do this:',
    '1. `reset_arena`, then `game_setup` with the commands that give the bot what it needs and put targets in view (see the setup commands and checks below; reuse the ones from the most illustrative check).',
    '2. `equip` the mod item, then show the main behavior working 2 or 3 times: `attack` for melee, `shoot` for bows and throwables, `use_item` or `chat` for right-click items and commands. Include a limit the mod has (like a cooldown) only if it is quick to show.',
    '3. Between actions call `wait_ticks` with 30 to 40 so the viewer can follow what happened. Summon targets 3 blocks in front of the bot for melee and 8-10 blocks away for ranged.',
    'Never use NoAI mobs, and summon mobs with {PersistenceRequired:1b}. Stay under 20 tool calls. Do not call report_check or finish and do not edit files.',
    'Finish with ONE plain sentence for the user describing what they just saw.',
    '',
    'Setup commands from the test plan:',
    JSON.stringify(testPlan.setup || [], null, 2),
    'Checks (for ideas on how to exercise the mod):',
    JSON.stringify(testPlan.checks || [], null, 2),
  ].join('\n');
}

// With a test plan, any check the playtester never reported counts as blocked, so a partial run can't pass.
function readVerdict(verdictFile, testPlan) {
  let v;
  try { v = JSON.parse(fs.readFileSync(verdictFile, 'utf8')); }
  catch (e) { return { version: 1, finished: false, passed: false, checks: [], serverErrors: [], error: `No verdict: ${e.message}` }; }
  const reported = Array.isArray(v.checks) ? v.checks : [];
  const finished = v.finished === true;
  const missing = (testPlan?.checks || []).filter((c) => !reported.some((r) => r.id === c.id))
    .map((c) => ({ id: c.id, status: 'blocked', expected: c.expect, observed: finished ? 'The playtester finished without reporting this check.' : 'Not reported yet.', evidence: {} }));
  const checks = [...reported, ...missing];
  const serverErrors = Array.isArray(v.serverErrors) ? v.serverErrors : [];
  return { ...v, checks, serverErrors, finished, passed: finished && checks.length > 0 && checks.every((c) => c.status === 'pass') && serverErrors.length === 0 };
}

function mockVerdict(testPlan, attempt) {
  const checks = (testPlan.checks || []).map((c, i) => {
    const failing = attempt <= 1 && i === 0;
    return {
      id: c.id,
      status: failing ? 'fail' : 'pass',
      expected: c.expect,
      observed: failing ? '[mock] max upward velocity 0.0; mob took damage but stayed grounded' : '[mock] matched expectation',
      evidence: { samples: [], serverLog: [] },
      ...(failing ? { suspectedCause: '[mock] velocity is overwritten by knockback after the damage event' } : {}),
    };
  });
  return { version: 1, runId: `mock_${attempt}`, finished: true, passed: checks.every((c) => c.status === 'pass'), summary: '[mock verdict]', checks, serverErrors: [] };
}

// Attract mode for recordings: summon a husk in front of the bot and hit it, on repeat.
let demoTimer = null;
async function demoHit() {
  await runTool('game_setup', { commands: ['kill @e[type=husk]', 'give @bot golden_sword', 'summon husk ^ ^ ^3 {PersistenceRequired:1b}'] });
  await runTool('wait_ticks', { ticks: 25 });
  await runTool('equip', { item: 'golden_sword' });
  const husk = (await runTool('nearby_entities', { radius: 8 })).find((e) => e.name === 'husk');
  return husk ? runTool('attack', { entityId: husk.id, trackTicks: 30 }) : null;
}

function demo(on) {
  clearInterval(demoTimer);
  demoTimer = null;
  if (!on) return { demo: false };
  let busy = false;
  const tick = () => {
    if (busy || state.bot !== 'online') return;
    busy = true;
    demoHit().catch(() => {}).finally(() => { busy = false; });
  };
  demoTimer = setInterval(tick, 7000);
  tick();
  return { demo: true };
}

function handlers(emit) {
  emitter = emit;
  if (process.env.BENANA_GAME_AUTOSTART === '1' && !mock()) {
    setTimeout(() => start(emit).then(() => process.env.BENANA_GAME_DEMO === '1' && demo(true)).catch(() => {}), 2000);
  }
  return {
    'game:demo': ({ on }) => demo(on),
    'game:status': () => status(),
    'game:logs': ({ limit } = {}) => server.logSince(0).slice(-Math.min(Number(limit) || 300, 1000)),
    'game:start': () => start(emit),
    'game:stop': () => stop(),
    'game:command': ({ command }) => runCommand(command),
    'game:tool': ({ tool, args }) => runTool(tool, args),
  };
}

module.exports = {
  VERSION, status, start, stop, deployPlugin, resetWorld, runCommand, runTool,
  mcpConfig, playtesterTools, playtestPrompt, demoTools: DEMO_TOOLS, demoPrompt, readVerdict, mockVerdict, handlers,
};

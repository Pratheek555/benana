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
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { appRoot } = require('../env.cjs');
const { resolveExecutable, spawnExecutable, terminateProcessTree } = require('../processes.cjs');
const { Server, VERSION, PORT, dir: serverDir } = require('./server.cjs');
const { Client, NAME: CAMERA, PLAYER } = require('./client.cjs');
const { packTextures } = require('../studio/pack.cjs');

const BOT = 'BenanaBot';
// The bot is kept near this spot so it stays inside the viewer's fixed camera orbit.
const ARENA = [0.5, 65, 0.5];
const VIEWER_PORT = Number(process.env.BENANA_VIEWER_PORT) || 3007;
const HOST = path.join(__dirname, 'host.cjs');
const MCP = path.join(appRoot, 'electron', 'mcp-minecraft.cjs');
const mock = () => process.env.BENANA_GAME_MOCK === '1';

const BOT_TOOLS = new Set([
  'bot_state', 'nearby_entities', 'equip', 'look_at', 'move_to', 'move', 'attack', 'attack_sequence', 'use_item', 'shoot',
  'place_block', 'dig_block', 'track_entity', 'track_self', 'boss_bars', 'wait_ticks', 'chat', 'read_chat',
  'particles_and_sounds',
]);
const TOOLS = ['game_setup', 'reset_arena', ...BOT_TOOLS, 'server_log', 'report_check', 'finish'];
const playtesterTools = TOOLS.map((t) => `mcp__minecraft__${t}`);

// deployed: the studio mod whose jar is in the server's plugins folder; deploying: the one being swapped in.
// camera: the real Minecraft client watching as a spectator (off, launching, joining, live, error).
// play: the real Minecraft client the user plays in themselves ("Play in Minecraft"), same states.
let state = {
  server: 'stopped', bot: 'offline', viewerUrl: null, controlUrl: null, version: VERSION, mock: mock(), error: null,
  deployed: null, deploying: null, resetting: false, camera: 'off', cameraEnabled: process.env.BENANA_CAMERA !== '0', cameraError: null,
  play: 'off', playError: null, player: PLAYER,
};
let emitter = () => {};

function setState(patch) {
  state = { ...state, ...patch, mock: mock() };
  emitter('game:status', state);
  return state;
}

const status = () => ({ ...state, mock: mock(), cameraWindow: client.hwnd });

const server = new Server();

// The real-client camera. It is a spectator, so it never touches the test: mobs ignore it, `@p` skips it, and the
// bot's tools leave it out. The capture into the live view is wired in main.cjs.
const client = new Client();
// The user's own client: a normal window with its own game directory and options.
const player = new Client({ name: PLAYER, game: 'play', hidden: false });
let playRun = 0;
let playSetup = { commands: [], tries: [] };
let cameraRun = 0;
let follow = null;
let focus = null;
let shot = null;

const entityPos = async (name) => {
  const out = await server.command(`data get entity ${name} Pos`);
  const m = out.match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
  return m ? m.slice(1, 4).map(Number) : null;
};

const botYaw = async () => {
  const m = (await server.command(`data get entity ${BOT} Rotation`)).match(/\[(-?[\d.]+)f/);
  return m ? Number(m[1]) : 0;
};

// Frames the bot from its right-hand side, looking at a spot a few blocks ahead of it, so the bot and whatever it
// hits, throws or summons up to about 12 blocks ahead share the shot, and launched mobs rise through it. The height
// comes from the arena floor, not the bot, so a bot thrown into the air doesn't take the camera up into the sky. The
// bot's facing is snapped to a compass direction so aiming at a target doesn't swing the camera.
async function frameCamera(pos, yaw) {
  const [x, , z] = pos || (await entityPos(BOT)) || ARENA;
  const y = ARENA[1];
  const facing = yaw ?? Math.round((await botYaw().catch(() => 0)) / 90) * 90;
  const r = (facing * Math.PI) / 180;
  const ahead = [-Math.sin(r), Math.cos(r)];
  const right = [-ahead[1], ahead[0]];
  focus = [x, z, facing];
  shot = [x + right[0] * 9 + ahead[0] * 2, y + 5, z + right[1] * 9 + ahead[1] * 2];
  const look = [x + ahead[0] * 4.5, y + 1.5, z + ahead[1] * 4.5];
  await server.command(`gamemode spectator ${CAMERA}`);
  await server.command(`tp ${CAMERA} ${shot.map((n) => n.toFixed(2)).join(' ')} facing ${look.map((n) => n.toFixed(2)).join(' ')}`);
}

// Reframes when the bot walks out of the shot (launches straight up stay in frame), or when the camera was moved,
// e.g. a setup command teleported every player.
function startFollow() {
  clearInterval(follow);
  follow = setInterval(async () => {
    if (state.camera !== 'live' || state.resetting || state.deploying) return;
    try {
      const [bot, cam] = [await entityPos(BOT), await entityPos(CAMERA)];
      const strayed = bot && (!focus || Math.hypot(bot[0] - focus[0], bot[2] - focus[1]) > 5);
      const moved = cam && shot && Math.hypot(cam[0] - shot[0], cam[1] - shot[1], cam[2] - shot[2]) > 0.5;
      if (strayed) await frameCamera(bot);
      else if (moved) await frameCamera([focus[0], ARENA[1], focus[1]], focus[2]);
    } catch {}
  }, 1500);
}

// current: whether this launch is still the wanted one (a newer launch or a stop cancels the wait).
async function waitForJoin(since, current, who = client) {
  const joined = new RegExp(`\\b${who.name} joined the game`);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (!current()) return false;
    if (server.logSince(since).some((l) => joined.test(l.line))) return true;
    if (!who.running()) throw new Error('The Minecraft client closed before joining.');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The Minecraft client did not join within 3 minutes.');
}

// Launches the client and puts it in spectator behind the bot. Runs in the background: the bot's tests never
// wait for the camera.
async function startCamera() {
  if (mock() || !state.cameraEnabled || client.running() || state.server !== 'running') return;
  const run = ++cameraRun;
  const since = Date.now();
  setState({ camera: 'launching', cameraError: null });
  try {
    await client.launch({
      version: VERSION,
      port: PORT,
      log: (text) => emitter('game:log', { line: `[camera] ${text}`, level: 'info', at: Date.now() }),
      onExit: () => { if (run === cameraRun) { clearInterval(follow); setState({ camera: 'off' }); } },
    });
    setState({ camera: 'joining' });
    if (!(await waitForJoin(since, () => run === cameraRun))) return;
    // The world finishes loading on the client a moment after the join message.
    await new Promise((r) => setTimeout(r, 1500));
    await frameCamera();
    setState({ camera: 'live' });
    startFollow();
  } catch (e) {
    if (run !== cameraRun) return;
    await client.stop();
    setState({ camera: 'error', cameraError: e.message });
  }
}

async function stopCamera() {
  cameraRun++;
  clearInterval(follow);
  focus = null;
  shot = null;
  await client.stop();
  if (state.camera !== 'off') setState({ camera: 'off' });
}

async function setCamera({ on }) {
  setState({ cameraEnabled: Boolean(on), cameraError: null });
  if (on) startCamera();
  else await stopCamera();
  return status();
}

// "Play in Minecraft": opens a real client window for the user next to the bot, then runs the mod's test-plan setup
// for them (its items, its targets), the same setup the playtester got. The user is op, has Resistance like the bot,
// and can switch to /gamemode creative. A deploy or reset reopens the window on the new world.
async function startPlay() {
  if (mock() || player.running() || state.server !== 'running') return;
  const run = ++playRun;
  const since = Date.now();
  setState({ play: 'launching', playError: null });
  try {
    await player.launch({
      version: VERSION,
      port: PORT,
      log: (text) => emitter('game:log', { line: `[play] ${text}`, level: 'info', at: Date.now() }),
      onExit: () => { if (run === playRun) setState({ play: 'off' }); },
    });
    setState({ play: 'joining' });
    if (!(await waitForJoin(since, () => run === playRun, player))) return;
    await new Promise((r) => setTimeout(r, 1500));
    const [x, y, z] = (await entityPos(BOT)) || ARENA;
    for (const cmd of [
      `op ${PLAYER}`, `gamemode survival ${PLAYER}`, `clear ${PLAYER}`,
      `effect give ${PLAYER} resistance infinite 4 true`, `effect give ${PLAYER} saturation infinite 0 true`,
      `tp ${PLAYER} ${(x - 3).toFixed(2)} ${y.toFixed(2)} ${(z - 3).toFixed(2)} facing ${x.toFixed(2)} ${(y + 1).toFixed(2)} ${(z + 4).toFixed(2)}`,
    ]) await server.command(cmd);
    for (const raw of playSetup.commands) {
      await server.command(`execute as ${PLAYER} at ${PLAYER} run ${raw.replaceAll('@bot', PLAYER)}`);
    }
    const tries = playSetup.tries.map((t) => `/${t}`).join(', ');
    const hint = `Benana: you're in with the mod's items and husk eggs for targets.${tries ? ` Try ${tries}.` : ''} /gamemode creative to fly.`;
    await server.command(`tellraw ${PLAYER} ${JSON.stringify({ text: hint, color: 'yellow' })}`);
    setState({ play: 'live' });
  } catch (e) {
    if (run !== playRun) return;
    await player.stop();
    setState({ play: 'error', playError: e.message });
  }
}

async function stopPlay() {
  playRun++;
  await player.stop();
  if (state.play !== 'off') setState({ play: 'off' });
}

// What the user gets when they join: every command in the mod's test plan that gives the player something (the plan's
// setup and the game_setup lists inside its checks, first of each kind), plus husk eggs to have targets. Plugin
// commands that do other things (summoning a boss) are left to the user and suggested in chat.
function playKit(plan) {
  const all = [...(plan?.setup || [])];
  for (const c of plan?.checks || []) {
    for (const m of String(c.steps || '').matchAll(/game_setup\W{0,3}(\[[^\]]*\])/g)) {
      try { all.push(...JSON.parse(m[1])); } catch {}
    }
  }
  const vanilla = /^(summon|effect|kill|tp|teleport|clear|gamerule|time|weather|fill|setblock|data|execute|attribute|difficulty|gamemode|item|tag|scoreboard|team|spawnpoint|damage|particle|playsound|say|tellraw|title|xp|experience|enchant)\b/;
  const gives = new Map();
  const tries = new Set();
  for (const raw of all.map((c) => String(c).replace(/^\//, '').trim())) {
    if (/^give\b|\bgive\b/.test(raw)) {
      const key = raw.replace(/\s+\d+$/, '').replace(/\{.*\}/, '');
      if (!gives.has(key)) gives.set(key, raw);
    } else if (!vanilla.test(raw) && !raw.includes('@bot')) tries.add(raw.split(' ')[0]);
  }
  return { commands: [...gives.values(), 'give @bot husk_spawn_egg 16'], tries: [...tries].slice(0, 3) };
}

// plan: the loaded mod's test plan; its items are handed to the user once they join.
async function setPlay({ on, plan } = {}) {
  if (plan !== undefined) playSetup = plan ? playKit(plan) : { commands: ['give @bot husk_spawn_egg 16'], tries: [] };
  if (!on) { await stopPlay(); return status(); }
  if (state.server !== 'running' || state.bot !== 'online') throw new Error('Start the game first.');
  startPlay();
  return status();
}

// Studio jars are copied in as studio-<ModName>.jar.
function deployedOnDisk() {
  try {
    const jar = fs.readdirSync(server.pluginsDir()).find((f) => /^studio-.*\.jar$/.test(f));
    return jar ? { plugin: jar.replace(/^studio-|\.jar$/g, '') } : null;
  } catch { return null; }
}
state.deployed = deployedOnDisk();

// The deployed mod's resource pack (its generated textures and models). Paper offers it to every player who
// joins, from the control server, so a real Minecraft client sees the mod's own art.
const PACK_FILE = path.join(serverDir, 'studio-pack.zip');
function packOffer() {
  if (!state.controlUrl || !fs.existsSync(PACK_FILE)) return null;
  const sha1 = crypto.createHash('sha1').update(fs.readFileSync(PACK_FILE)).digest('hex');
  return { url: `${state.controlUrl}/pack.zip?v=${sha1.slice(0, 10)}`, sha1 };
}
// The pack's item textures, so the live view's HUD can draw the mod's items as a real client would.
let textures = { key: null, map: {} };
function packTexturesNow() {
  try {
    const st = fs.statSync(PACK_FILE);
    const key = `${st.size}:${st.mtimeMs}`;
    if (textures.key !== key) textures = { key, map: packTextures(PACK_FILE) };
  } catch { textures = { key: null, map: {} }; }
  return textures.map;
}
let hud = null;
function withTextures(h) {
  const map = packTexturesNow();
  const art = (i) => (i?.itemModel && map[i.itemModel] ? { ...i, texture: map[i.itemModel] } : i);
  return { ...h, hotbar: h.hotbar.map(art), ground: h.ground.map((g) => ({ ...g, item: art(g.item) })) };
}

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
        ...process.env, MC_PORT: String(PORT), MC_VERSION: VERSION, BOT_NAME: BOT, CAMERA_NAME: CAMERA,
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
      if (msg.event === 'hud') { hud = msg.hud; emitter('game:hud', withTextures(hud)); }
      if (msg.event === 'fx') emitter('game:fx', msg.fx);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (host === child) { host = null; hud = null; emitter('game:hud', null); setState({ bot: 'offline', viewerUrl: null }); }
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
  for (const cmd of [`tp ${BOT} ${ARENA.join(' ')} 0 0`, `gamemode survival ${BOT}`, `effect clear ${BOT}`, `effect give ${BOT} resistance infinite 4 true`, `effect give ${BOT} saturation infinite 0 true`, `clear ${BOT}`])
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
    // Setup commands can move every player (`tp @a`) or change game modes; put the camera back.
    if (state.camera === 'live') await frameCamera().catch(() => {});
    return out;
  }
  if (tool === 'reset_arena') {
    await resetArena();
    await prepareBot();
    if (state.camera === 'live') await frameCamera(ARENA).catch(() => {});
    await botCall('wait_ticks', { ticks: 10 });
    return { reset: true, note: 'Arena rebuilt flat (grass at y=64), all mobs/items/projectiles removed, bot back at the center with an empty inventory. Run your setup commands again. Plugin state such as cooldowns is NOT reset; wait it out.' };
  }
  if (tool === 'server_log') return server.logSince(Number(args.sinceMs) || 0, args.level).slice(-200);
  if (tool === 'showcase') return setShowcase(args);
  throw new Error(`Unknown game tool ${tool}`);
}

function startControl() {
  if (control) return Promise.resolve();
  return new Promise((resolve) => {
    control = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/pack.zip')) {
        if (!fs.existsSync(PACK_FILE)) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        fs.createReadStream(PACK_FILE).pipe(res);
        return;
      }
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
    pack: packOffer(),
  });
  setState({ server: 'running' });
  await prepareWorld();
  await startHost();
  await prepareBot();
  setState({ viewerUrl: `http://127.0.0.1:${VIEWER_PORT}` });
  startCamera();
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
  await stopPlay();
  await stopCamera();
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

async function deployNow({ jarPath, packPath, emit }) {
  if (emit) emitter = emit;
  setState({ deploying: path.basename(jarPath, '.jar') });
  try {
    const out = await swapPlugin(jarPath, packPath);
    setState({ deployed: out.loaded ? { plugin: out.plugin, jar: jarPath, pack: Boolean(out.pack), at: Date.now() } : deployedOnDisk() });
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

async function swapPlugin(jarPath, packPath) {
  if (!fs.existsSync(jarPath)) return { loaded: false, plugin: null, errors: [`Jar not found: ${jarPath}`], logTail: [] };
  if (mock()) return { loaded: true, plugin: path.basename(jarPath, '.jar'), pack: Boolean(packPath), errors: [], logTail: ['[mock] plugin enabled'] };
  return rebootFresh(jarPath, packPath);
}

// Stops the game, wipes the saved world so each mod starts on untouched terrain (earlier mods leave craters
// that arena resets never reach), optionally installs a studio jar, and boots a fresh server.
async function rebootFresh(jarPath, packPath) {
  systemNode();
  await startControl();
  // The vanilla client cannot reconnect by itself, so it is relaunched after the reboot (the user's too, if open).
  const replay = player.running();
  await stopPlay();
  await stopCamera();
  await stopHost();
  await server.stop();
  setState({ server: 'stopped', bot: 'offline', viewerUrl: null });
  server.wipeWorld();
  if (jarPath) {
    const dir = server.pluginsDir();
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^studio-.*\.jar$/.test(f)) fs.rmSync(path.join(dir, f));
    fs.copyFileSync(jarPath, path.join(dir, `studio-${path.basename(jarPath)}`));
    // A mod without assets must not inherit the previous mod's pack.
    fs.rmSync(PACK_FILE, { force: true });
    if (packPath && fs.existsSync(packPath)) fs.copyFileSync(packPath, PACK_FILE);
  }
  const since = Date.now();
  await bootGame();
  if (replay) startPlay();
  const lines = server.logSince(since);
  const enabled = lines.map((l) => l.line.match(/\[([^\]]+)\] Enabling (\S+) v/)).find(Boolean);
  const errors = lines.filter((l) => l.level === 'error').map((l) => l.line);
  return { loaded: Boolean(enabled), plugin: enabled ? enabled[2] : null, pack: fs.existsSync(PACK_FILE), errors, logTail: lines.slice(-40).map((l) => l.line) };
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
    'For bows, crossbows, tridents and throwables, use `shoot` (never `use_item` on a mob: that only right-clicks it). It aims, fires, and reports the projectile, explosions, ammo used, and the health/deaths/knockback/height gain of every living entity nearby. When the effect lasts after impact (a black hole, a cloud, a delayed blast), pass `watchTicks` covering it so the same call measures it: each entity\'s `impactDistance` (start, closest, end) shows a pull or a push. A `track_entity` call afterwards starts seconds late.',
    'Each tool call takes 1-8 real seconds. For anything timing-sensitive (cooldowns, combos), summon all targets first and do it in ONE call: `attack_sequence` for melee, `shoot` with `entityIds` for ranged.',
    'When the mod moves, boosts, launches or hurts the PLAYER, the bot is the test subject: measure it with `track_self` (just watch for N ticks), `use_item` with `trackSelf` (right-click and record the bot), or `move` (hold forward/jump/sprint/sneak and record the bot). They report max upward velocity, height gain, launches with their ticks, horizontal distance, health and effects. Never guess the bot\'s entity id; `nearby_entities` does not list the bot.',
    'Right-click a block (or aim at a far block) with `use_item` and `position`. Place and break blocks as a player with `place_block` and `dig_block`; they fire the plugin\'s block events, which console `setblock` does not. Boss bars: `boss_bars`. Action bar and title text show up in `read_chat` and in tool `chat` fields. Particles and sounds the mod plays (explosion particles, a thunder sound): `particles_and_sounds` with the sinceMs of the action.',
    '`bot_state` lists effects and, for each item, its customName, lore and itemModel (the mod\'s own resource-pack model, e.g. "benana:storm_core").',
    'The bot has Resistance V so it survives; for a fall-damage or health check, run `effect clear @bot resistance` first and give it back afterwards with `effect give @bot resistance infinite 4 true`. To stop a target mob walking around without breaking knockback, give it `effect give @e[type=husk] slowness infinite 255 true`.',
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
const DEMO_TOOLS = [...TOOLS.filter((t) => t !== 'report_check' && t !== 'finish'), 'showcase'].map((t) => `mcp__minecraft__${t}`);

// The demo's outline, captioned over the live view: the steps it will show and the one on screen now.
let showcase = null;
function setShowcase({ steps, step, note } = {}) {
  if (Array.isArray(steps) && steps.length) showcase = { steps: steps.map((t) => String(t).slice(0, 80)).slice(0, 10), step: 0, note: null };
  if (!showcase) throw new Error('Call showcase with `steps` (the outline) first.');
  if (step != null) showcase.step = Math.max(1, Math.min(showcase.steps.length, Number(step) || 1));
  if (note !== undefined) showcase.note = note ? String(note).slice(0, 120) : null;
  emitter('game:showcase', showcase);
  return { showing: showcase.step ? `${showcase.step}/${showcase.steps.length}: ${showcase.steps[showcase.step - 1]}` : 'outline set' };
}
function clearShowcase() {
  showcase = null;
  emitter('game:showcase', null);
}

function demoPrompt({ testPlan, spec }) {
  return [
    'You are showing a user what a Minecraft mod does. They watch the bot through a live camera with a caption bar, and you drive the bot with the `minecraft` tools. This is a walkthrough, not a test: do not judge anything, but do show EVERY feature.',
    `Mod: ${testPlan.modName}: ${testPlan.summary}`,
    ...(spec?.behavior?.length ? ['Behavior (the features to show):', ...spec.behavior.map((b) => `- ${b}`)] : []),
    ...(spec?.assets?.length ? ['Art the mod ships (show each item in the bot\'s hands and use it):', ...spec.assets.map((a) => `- ${a.name}: ${a.look || ''}`)] : []),
    '',
    'Plan first:',
    '1. Turn the behavior into 3 to 7 showcase steps in the order a player meets them, one per feature: getting the item or summoning the boss, the main effect, each phase, limit or variant (cooldowns, thresholds, ranges), what drops, and using what dropped. Titles are short and plain, like "Phase two: red bar, slams every 3s".',
    '2. Call `showcase` with `steps` (the titles), then `reset_arena`.',
    '',
    'Then for each step:',
    '- Call `showcase` with `step` (1-based) and a `note` telling the viewer what to watch for ("Watch the bot get thrown into the air").',
    '- Set it up with `game_setup` (see the test plan setup below), then perform it like a player: `move_to` targets, `move` to strafe or jump, `attack`, `shoot`, `use_item`, `chat` for commands. Summon targets 3 blocks away for melee and 8 to 10 blocks for ranged.',
    '- When the mod acts on the player (a slam, a launch, a pull, a boost), stand where it happens and call `track_self` (or `use_item` with `trackSelf`) so the camera follows the bot through the air.',
    '- Do not skip a feature because it needs a state that takes long to reach. Get there with commands: lower a boss to just above a threshold with `data merge entity @e[type=<type>,limit=1,sort=nearest] {Health:<n>f}` and then hit it once so the mod sees real damage; finish it with hits or `damage @e[...] <amount> minecraft:player_attack by @bot`. Give the bot a time-limited item rather than waiting out a cooldown.',
    '- Items that drop: walk onto them with `move_to`, `equip` them, then use them (`use_item` with `trackSelf` if they move the player, then `move` with jump so the effect shows).',
    '- Leave 20 to 40 ticks (`wait_ticks`) after each visible moment so the viewer can follow.',
    'Never use NoAI mobs, and summon mobs with {PersistenceRequired:1b}. Keep the boss alive until its step. Stay under 40 tool calls. Do not call report_check or finish and do not edit files.',
    'Finish with ONE plain sentence for the user listing what they just saw.',
    '',
    'Setup commands from the test plan:',
    JSON.stringify(testPlan.setup || [], null, 2),
    'Checks (how each feature can be exercised):',
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
    'game:camera': (args = {}) => setCamera(args),
    'game:play': (args = {}) => setPlay(args),
    'game:status': () => status(),
    'game:hud': () => (hud ? withTextures(hud) : null),
    'game:showcase': () => showcase,
    'game:logs': ({ limit } = {}) => server.logSince(0).slice(-Math.min(Number(limit) || 300, 1000)),
    'game:start': () => start(emit),
    'game:stop': () => stop(),
    'game:command': ({ command }) => runCommand(command),
    'game:tool': ({ tool, args }) => runTool(tool, args),
  };
}

module.exports = {
  VERSION, status, start, stop, deployPlugin, resetWorld, runCommand, runTool,
  mcpConfig, playtesterTools, playtestPrompt, demoTools: DEMO_TOOLS, demoPrompt, clearShowcase, readVerdict, mockVerdict, playKit, handlers,
};

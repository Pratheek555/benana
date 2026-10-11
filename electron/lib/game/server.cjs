// Local Paper server: download, configure, run, read the console, and send commands over RCON.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { dataDir } = require('../env.cjs');
const { spawnExecutable, terminateProcessTree } = require('../processes.cjs');

const VERSION = '1.21.4';
const UA = 'benana/0.1 (neatHack)';
const dir = path.join(dataDir, 'game', 'server');
const PORT = Number(process.env.BENANA_MC_PORT) || 25599;
const RCON_PORT = Number(process.env.BENANA_RCON_PORT) || 25598;
const LEVEL = 'studio-flat64';

const ANSI = /\x1b\[[0-9;]*m/g;
const ready = /Done \([\d.,]+s\)! For help/;

async function ensureJar(log) {
  fs.mkdirSync(dir, { recursive: true });
  const meta = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${VERSION}/builds/latest`, { headers: { 'User-Agent': UA } });
  if (!meta.ok) throw new Error(`Paper build lookup failed: ${meta.status}`);
  const dl = (await meta.json()).downloads?.['server:default'];
  if (!dl?.url) throw new Error('Paper build lookup returned no server download.');
  const jar = path.join(dir, dl.name);
  if (fs.existsSync(jar)) return jar;
  log(`downloading ${dl.name} (${Math.round(dl.size / 1e6)} MB)…`);
  const res = await fetch(dl.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Paper download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== dl.checksums.sha256) throw new Error('Paper download checksum mismatch.');
  fs.writeFileSync(jar, buf);
  return jar;
}

function localJar() {
  if (!fs.existsSync(dir)) return null;
  const jar = fs.readdirSync(dir).filter((f) => /^paper-.*\.jar$/.test(f)).sort().pop();
  return jar ? path.join(dir, jar) : null;
}

// pack: { url, sha1 } of the deployed mod's resource pack, offered to every player who joins (not required).
function configure(rconPassword, pack) {
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  const props = {
    'server-port': PORT,
    'online-mode': false,
    'enable-rcon': true,
    'rcon.port': RCON_PORT,
    'rcon.password': rconPassword,
    // Surface at y=64: prismarine-viewer only places its camera once the bot is above y=0.
    'level-name': LEVEL,
    'level-type': 'minecraft\\:flat',
    'generator-settings': JSON.stringify({
      layers: [
        { block: 'minecraft:bedrock', height: 1 },
        { block: 'minecraft:stone', height: 124 },
        { block: 'minecraft:dirt', height: 3 },
        { block: 'minecraft:grass_block', height: 1 },
      ],
      biome: 'minecraft:plains',
    }),
    'generate-structures': false,
    'spawn-protection': 0,
    difficulty: 'easy',
    gamemode: 'survival',
    'view-distance': 6,
    'simulation-distance': 6,
    'max-players': 4,
    motd: 'Benana Mod Studio',
    'resource-pack': pack ? pack.url.replace(/:/g, '\\:') : '',
    'resource-pack-sha1': pack ? pack.sha1 : '',
    // A new id per pack version makes clients download the new art instead of reusing a cached pack.
    'resource-pack-id': pack ? pack.sha1.slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-') : '',
    'require-resource-pack': false,
  };
  fs.writeFileSync(path.join(dir, 'server.properties'), Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
}

class Server {
  constructor() {
    this.child = null;
    this.lines = [];
    this.rconPassword = crypto.randomBytes(12).toString('hex');
    this.onLine = () => {};
  }

  pluginsDir() { return path.join(dir, 'plugins'); }

  // Deletes the saved world so the next start generates a pristine flat one. Only call while stopped.
  wipeWorld() {
    if (this.child) throw new Error('Stop the server before wiping its world.');
    for (const suffix of ['', '_nether', '_the_end']) fs.rmSync(path.join(dir, `${LEVEL}${suffix}`), { recursive: true, force: true });
  }

  async start({ onLine = () => {}, log = () => {}, pack = null } = {}) {
    if (this.child) return;
    this.onLine = onLine;
    const jar = localJar() || (await ensureJar(log));
    configure(this.rconPassword, pack);
    const child = spawnExecutable('java', ['-Xms1G', '-Xmx2G', '-jar', jar, '--nogui'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let resolveReady, rejectReady;
    const done = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
    let buf = '';
    const read = (chunk) => {
      buf += chunk.toString();
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const raw of parts) {
        const line = raw.replace(ANSI, '').replace(/^>\s*/, '');
        if (!line.trim() || /Thread RCON Client/.test(line)) continue;
        const level = /\bERROR\]|Exception|\tat /.test(line) ? 'error' : /\bWARN\]/.test(line) ? 'warn' : 'info';
        const entry = { line, level, at: Date.now() };
        this.lines.push(entry);
        if (this.lines.length > 4000) this.lines.splice(0, 1000);
        this.onLine(entry);
        if (ready.test(line)) resolveReady();
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (e) => rejectReady(new Error(`Could not start Java: ${e.message}`)));
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      rejectReady(new Error(`Paper exited with code ${code} before it was ready.`));
    });
    const timeout = setTimeout(() => rejectReady(new Error('Paper did not finish starting within 4 minutes.')), 240000);
    try { await done; } finally { clearTimeout(timeout); }
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    const exited = new Promise((res) => child.once('exit', res));
    try { child.stdin.write('stop\n'); } catch {}
    const timer = setTimeout(() => terminateProcessTree(child), 20000);
    await exited;
    clearTimeout(timer);
    this.child = null;
  }

  running() { return Boolean(this.child); }

  logSince(sinceMs = 0, level) {
    return this.lines.filter((l) => l.at >= sinceMs && (!level || l.level === level || (level === 'warn' && l.level === 'error')));
  }

  command(cmd) { return rcon(RCON_PORT, this.rconPassword, cmd); }
}

// Minimal Source RCON client (one connection per command).
function rcon(port, password, command) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const packet = (id, type, body) => {
      const b = Buffer.from(body, 'utf8');
      const p = Buffer.alloc(14 + b.length);
      p.writeInt32LE(10 + b.length, 0);
      p.writeInt32LE(id, 4);
      p.writeInt32LE(type, 8);
      b.copy(p, 12);
      return p;
    };
    let buf = Buffer.alloc(0);
    let authed = false;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`RCON timed out: ${command}`)); }, 10000);
    sock.on('connect', () => sock.write(packet(1, 3, password)));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < len + 4) break;
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.toString('utf8', 12, len + 2);
        buf = buf.subarray(len + 4);
        if (!authed && type === 2) {
          if (id === -1) { clearTimeout(timer); sock.destroy(); return reject(new Error('RCON authentication failed.')); }
          authed = true;
          sock.write(packet(2, 2, command));
        } else if (authed && id === 2) {
          clearTimeout(timer);
          sock.end();
          return resolve(body.replace(/§./g, ''));
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

module.exports = { Server, VERSION, PORT, dir };

// Real Minecraft camera: a vanilla Java client that joins the local Paper server as a spectator so the live view
// shows native rendering (particles, the mod's resource pack, boss bars) while Mineflayer keeps doing the testing.
// Benana downloads the client from Mojang on first use and captures its window into the Electron app.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { dataDir } = require('../env.cjs');
const { resolveExecutable, terminateProcessTree } = require('../processes.cjs');

const NAME = 'Camera';
const dir = path.join(dataDir, 'game', 'client');
// The launcher's shared asset store; objects found there are copied instead of downloaded again.
const sharedObjects = process.env.APPDATA ? path.join(process.env.APPDATA, '.minecraft', 'assets', 'objects') : null;
const WIDTH = 1280;
const HEIGHT = 720;
// The capture picks the client's window by this title prefix.
const TITLE = 'Minecraft';

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

async function get(url, as = 'json') {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return as === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; }
  }
  throw last;
}

async function download(dest, url, hash, size) {
  if (fs.existsSync(dest) && (!size || fs.statSync(dest).size === size)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = await get(url, 'buf');
  if (hash && sha1(buf) !== hash) throw new Error(`Checksum mismatch for ${url}`);
  fs.writeFileSync(dest, buf);
  return true;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const OS = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];
function allowed(rules) {
  if (!rules) return true;
  return rules.reduce((ok, r) => {
    if (r.features) return ok;
    const match = !r.os || ((!r.os.name || r.os.name === OS) && (!r.os.arch || r.os.arch === process.arch));
    return match ? r.action === 'allow' : ok;
  }, false);
}

// Client jar, libraries and assets for `version`, cached under ~/.benana/game/client. Returns the launch recipe.
async function ensure(version, log) {
  const manifest = await get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error(`Mojang has no Minecraft ${version} client.`);
  const v = await get(entry.url);
  const vdir = path.join(dir, 'versions', version);
  const jar = path.join(vdir, `${version}.jar`);
  if (await download(jar, v.downloads.client.url, v.downloads.client.sha1, v.downloads.client.size)) log(`downloaded the Minecraft ${version} client`);

  const libs = v.libraries.filter((l) => allowed(l.rules) && l.downloads?.artifact);
  await pool(libs, 8, (l) => download(path.join(dir, 'libraries', l.downloads.artifact.path), l.downloads.artifact.url, l.downloads.artifact.sha1, l.downloads.artifact.size));

  const index = await get(v.assetIndex.url);
  fs.mkdirSync(path.join(dir, 'assets', 'indexes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'indexes', `${v.assetIndex.id}.json`), JSON.stringify(index));
  const missing = Object.values(index.objects).filter(({ hash }) => !fs.existsSync(path.join(dir, 'assets', 'objects', hash.slice(0, 2), hash)));
  if (missing.length) log(`fetching ${missing.length} Minecraft assets…`);
  await pool(missing, 16, async ({ hash, size }) => {
    const rel = path.join(hash.slice(0, 2), hash);
    const dest = path.join(dir, 'assets', 'objects', rel);
    const shared = sharedObjects && path.join(sharedObjects, rel);
    if (shared && fs.existsSync(shared) && fs.statSync(shared).size === size) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(shared, dest);
    } else {
      await download(dest, `https://resources.download.minecraft.net/${rel.replace(/\\/g, '/')}`, hash, size);
    }
  });
  return { v, jar, classpath: [...libs.map((l) => path.join(dir, 'libraries', l.downloads.artifact.path)), jar] };
}

// Options that skip first-run screens, keep rendering while the window is unfocused, and silence music.
function writeOptions(game) {
  const file = path.join(game, 'options.txt');
  const keep = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const forced = {
    onboardAccessibility: 'false', skipMultiplayerWarning: 'true', joinedFirstServer: 'true', tutorialStep: 'none',
    pauseOnLostFocus: 'false', inactivityFpsLimit: 'minimized', renderDistance: '8', soundCategory_music: '0.0',
    narrator: '0', lang: 'en_us', fov: '0.25', particles: '0',
  };
  const lines = keep.filter((l) => !(l.split(':')[0] in forced));
  for (const [k, val] of Object.entries(forced)) lines.push(`${k}:${val}`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// A saved server entry with acceptTextures on, so the mod's resource pack is accepted without a prompt.
function writeServers(game, address) {
  const str = (s) => { const b = Buffer.from(s, 'utf8'); const h = Buffer.alloc(2); h.writeUInt16BE(b.length); return Buffer.concat([h, b]); };
  const tag = (type, name, payload) => Buffer.concat([Buffer.from([type]), str(name), payload]);
  const entry = Buffer.concat([
    tag(8, 'name', str('Benana Mod Studio')), tag(8, 'ip', str(address)),
    tag(1, 'acceptTextures', Buffer.from([1])), tag(1, 'hidden', Buffer.from([0])), Buffer.from([0]),
  ]);
  const count = Buffer.alloc(4); count.writeInt32BE(1);
  const list = tag(9, 'servers', Buffer.concat([Buffer.from([10]), count, entry]));
  fs.writeFileSync(path.join(game, 'servers.dat'), Buffer.concat([tag(10, '', Buffer.concat([list, Buffer.from([0])]))]));
}

// Windows: once the client's window exists, strip its frame (so the capture has no title bar) and park it far
// off-screen. Windows keeps rendering it and the capture keeps working, so it never covers the user's desktop.
const PARK = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class BenanaPark {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
"@
$target = [uint32]$args[0]
for ($i = 0; $i -lt 480; $i++) {
  $script:found = [IntPtr]::Zero
  [BenanaPark]::EnumWindows({ param($h, $l)
    $owner = [uint32]0; [void][BenanaPark]::GetWindowThreadProcessId($h, [ref]$owner)
    if ($owner -eq $target -and [BenanaPark]::IsWindowVisible($h) -and [BenanaPark]::GetWindowTextLength($h) -gt 0) { $script:found = $h; return $false }
    return $true }, [IntPtr]::Zero) | Out-Null
  if ($script:found -ne [IntPtr]::Zero) {
    $style = [BenanaPark]::GetWindowLong($script:found, -16)
    [void][BenanaPark]::SetWindowLong($script:found, -16, ($style -band -bnot 0x00CF0000))
    [void][BenanaPark]::SetWindowPos($script:found, [IntPtr]::Zero, 40000, 0, $args[1], $args[2], 0x0034)
    exit 0
  }
  Start-Sleep -Milliseconds 250
}
exit 1
`;

function park(pid) {
  if (process.platform !== 'win32' || process.env.BENANA_CAMERA_WINDOW === 'show') return;
  const script = `& {${PARK}} ${Number(pid)} ${WIDTH} ${HEIGHT}`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true });
}

function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

class Client {
  constructor() { this.child = null; }

  running() { return Boolean(this.child); }

  // Launches the client straight into the server (quick play). Resolves once the process is up; the caller waits
  // for the join in the server log.
  async launch({ version, port, log = () => {}, onExit = () => {} }) {
    if (this.child) return;
    const { v, classpath } = await ensure(version, log);
    const game = path.join(dir, 'game');
    fs.mkdirSync(game, { recursive: true });
    const address = `127.0.0.1:${port}`;
    writeOptions(game);
    writeServers(game, address);
    const natives = path.join(dir, 'versions', version, 'natives');
    fs.mkdirSync(natives, { recursive: true });
    const vars = {
      natives_directory: natives, launcher_name: 'benana', launcher_version: '0.1', classpath: classpath.join(path.delimiter),
      auth_player_name: NAME, version_name: version, game_directory: game, assets_root: path.join(dir, 'assets'),
      assets_index_name: v.assetIndex.id, auth_uuid: offlineUuid(NAME), auth_access_token: '0', clientid: '0', auth_xuid: '0',
      user_type: 'legacy', version_type: 'release', resolution_width: String(WIDTH), resolution_height: String(HEIGHT),
    };
    const expand = (list) => list.flatMap((a) => (typeof a === 'string' ? [a] : allowed(a.rules) ? [].concat(a.value) : []))
      .map((s) => s.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? ''));
    const args = [
      '-Xmx2G', ...expand(v.arguments.jvm), v.mainClass, ...expand(v.arguments.game),
      '--width', String(WIDTH), '--height', String(HEIGHT), '--quickPlayMultiplayer', address,
    ];
    const out = fs.openSync(path.join(dir, 'client.log'), 'w');
    // Not spawnExecutable: it hides windows, and a hidden window cannot be captured.
    const child = spawn(resolveExecutable('java'), args, { cwd: game, stdio: ['ignore', out, out], windowsHide: false });
    fs.closeSync(out);
    this.child = child;
    park(child.pid);
    child.on('error', (e) => log(`camera client failed to start: ${e.message}`));
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      onExit(code);
    });
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const exited = new Promise((res) => child.once('exit', res));
    terminateProcessTree(child);
    await Promise.race([exited, new Promise((res) => setTimeout(res, 5000))]);
  }
}

module.exports = { Client, NAME, TITLE, dir };

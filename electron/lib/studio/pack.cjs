// Mod resource packs: each mod repo keeps the art its agents drew under pack/ (see templates/paper-plugin/tools/texture.cjs).
// After a build Benana validates the pack, zips it next to the jar, and the game runtime offers it to players.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Minimal zip writer (deflate, no zip64). entries: [{ name, data: Buffer }]
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const fname = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01, so identical packs hash identically
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fname.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fname.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fname, packed);
    centrals.push(central, fname);
    offset += local.length + fname.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).replace(/\\/g, '/')];
  });
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// "benana:item/core" -> ["benana", "item/core"]; a bare path is in the minecraft namespace.
const split = (id) => (String(id).includes(':') ? String(id).split(':') : ['minecraft', String(id)]);

// Every "model" reference in an item definition (definitions nest: conditions, selects, composites).
function modelRefs(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => modelRefs(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.model === 'string') out.push(node.model);
    Object.values(node).forEach((v) => typeof v === 'object' && modelRefs(v, out));
  }
  return out;
}

// The argument text of every `name(...)` call, with nested parentheses balanced.
function callArgs(text, name) {
  const out = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (const m of text.matchAll(re)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    for (; i < text.length && depth; i++) depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
    out.push(text.slice(from, i - 1).trim());
  }
  return out;
}

// A NamespacedKey expression as "ns:path". Follows fields and constants the key was stored in
// (`coreKey = new NamespacedKey("benana", "core")`, `CORE = "benana:core"`); null when it cannot tell.
function keyOf(expr, text, pluginNs, depth = 0) {
  if (depth > 3) return null;
  const e = expr.trim();
  let m;
  if ((m = e.match(/^new\s+NamespacedKey\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/))) return `${m[1]}:${m[2]}`;
  // new NamespacedKey(plugin, "x") uses the plugin's lowercased name as the namespace.
  if ((m = e.match(/^new\s+NamespacedKey\(\s*[\w.()]+\s*,\s*"([^"]+)"\s*\)$/))) return pluginNs ? `${pluginNs}:${m[1]}` : null;
  if ((m = e.match(/^NamespacedKey\.minecraft\(\s*"([^"]+)"\s*\)$/))) return `minecraft:${m[1]}`;
  if ((m = e.match(/^(?:java\.util\.)?Objects\.requireNonNull\(\s*(.+)\)$/))) return keyOf(m[1], text, pluginNs, depth + 1);
  if ((m = e.match(/^NamespacedKey\.fromString\(\s*(.+?)\s*\)$/))) {
    const str = stringOf(m[1], text, depth);
    return str == null ? null : str.includes(':') ? str : `minecraft:${str}`;
  }
  if ((m = e.match(/^(?:this\.|\w+\.)?(\w+)$/))) {
    const assigned = text.match(new RegExp(`\\b${m[1]}\\s*=\\s*([^;]+);`));
    return assigned ? keyOf(assigned[1], text, pluginNs, depth + 1) : null;
  }
  return null;
}

function stringOf(expr, text, depth) {
  const e = expr.trim();
  const lit = e.match(/^"([^"]+)"$/);
  if (lit) return lit[1];
  const id = e.match(/^(?:this\.|\w+\.)?(\w+)$/);
  const assigned = id && text.match(new RegExp(`\\b${id[1]}\\s*=\\s*"([^"]+)"\\s*;`));
  return assigned && depth < 3 ? assigned[1] : null;
}

// Item models the plugin code points at with setItemModel(...). `id` is null when the key is built in a way
// this cannot follow (a helper method, string concatenation); `names` then holds the code's string literals.
function codeModels(repoDir) {
  const src = path.join(repoDir, 'src', 'main', 'java');
  const yml = path.join(repoDir, 'src', 'main', 'resources', 'plugin.yml');
  const pluginName = fs.existsSync(yml) ? fs.readFileSync(yml, 'utf8').match(/^name:\s*["']?([\w-]+)/m)?.[1] : null;
  const pluginNs = pluginName ? pluginName.toLowerCase() : null;
  const found = [];
  for (const rel of walk(src).filter((f) => f.endsWith('.java'))) {
    const text = fs.readFileSync(path.join(src, rel), 'utf8');
    for (const arg of callArgs(text, 'setItemModel')) {
      const id = keyOf(arg, text, pluginNs);
      found.push(id ? { id, file: rel } : { id: null, file: rel, expr: arg, names: [...text.matchAll(/"([^"\n]+)"/g)].map((x) => x[1]) });
    }
  }
  return found;
}

/**
 * Validates repoDir/pack and zips it to outFile.
 * @returns {{ ok, errors: string[], warnings: string[], assets: {id, size, texture}[], zip: string|null, files: number }}
 */
function build(repoDir, outFile) {
  const packDir = path.join(repoDir, 'pack');
  const files = walk(packDir);
  const errors = [];
  const warnings = [];
  const assets = [];
  const has = (rel) => files.includes(rel);
  const readJson = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(packDir, rel), 'utf8')); } catch (e) { errors.push(`pack/${rel}: invalid JSON (${e.message})`); return null; }
  };
  const used = codeModels(repoDir);
  const assetFiles = files.filter((f) => f.startsWith('assets/'));
  if (!assetFiles.length) {
    for (const u of used) if (u.id && !u.id.startsWith('minecraft:')) errors.push(`${u.file} calls setItemModel("${u.id}") but pack/ has no assets. Draw it with tools/texture.cjs.`);
    return { ok: !errors.length, errors, warnings, assets, zip: null, files: 0 };
  }

  const meta = has('pack.mcmeta') ? readJson('pack.mcmeta') : null;
  if (!has('pack.mcmeta')) errors.push('pack/pack.mcmeta is missing.');
  else if (meta && typeof meta.pack?.pack_format !== 'number') errors.push('pack/pack.mcmeta needs pack.pack_format (46 for 1.21.4).');

  const items = assetFiles.filter((f) => /^assets\/[^/]+\/items\/.+\.json$/.test(f));
  const defined = new Set();
  for (const rel of items) {
    const [, ns, name] = rel.match(/^assets\/([^/]+)\/items\/(.+)\.json$/);
    defined.add(`${ns}:${name}`);
    const def = readJson(rel);
    if (!def) continue;
    const refs = modelRefs(def.model ? def : {});
    if (!refs.length) errors.push(`pack/${rel}: needs a "model" object, e.g. { "model": { "type": "minecraft:model", "model": "${ns}:item/${name}" } }.`);
    let texture = null;
    let size = null;
    for (const ref of refs) {
      const [mns, mpath] = split(ref);
      if (mns === 'minecraft') continue;
      const modelRel = `assets/${mns}/models/${mpath}.json`;
      if (!has(modelRel)) { errors.push(`pack/${rel}: model ${ref} does not exist (expected pack/${modelRel}).`); continue; }
      const model = readJson(modelRel);
      for (const tex of Object.values(model?.textures || {})) {
        if (typeof tex !== 'string' || tex.startsWith('#')) continue;
        const [tns, tpath] = split(tex);
        if (tns === 'minecraft') continue;
        const texRel = `assets/${tns}/textures/${tpath}.png`;
        if (!has(texRel)) { errors.push(`pack/${modelRel}: texture ${tex} does not exist (expected pack/${texRel}).`); continue; }
        const buf = fs.readFileSync(path.join(packDir, texRel));
        const dim = pngSize(buf);
        if (!dim) errors.push(`pack/${texRel}: not a PNG.`);
        else if (dim.width !== dim.height && dim.height % dim.width !== 0) errors.push(`pack/${texRel}: ${dim.width}x${dim.height}; item textures must be square (or a vertical animation strip).`);
        else if (dim.width > 64) warnings.push(`pack/${texRel}: ${dim.width}px wide; 16 or 32 matches Minecraft's style.`);
        if (dim && !texture) { texture = `data:image/png;base64,${buf.toString('base64')}`; size = dim.width; }
      }
    }
    assets.push({ id: `${ns}:${name}`, size, texture });
  }
  for (const u of used) {
    if (!u.id || u.id.startsWith('minecraft:')) continue;
    if (!defined.has(u.id)) errors.push(`${u.file} calls setItemModel("${u.id}") but pack/assets/${split(u.id)[0]}/items/${split(u.id)[1]}.json does not exist.`);
  }
  // A key the code builds dynamically counts when the asset's id or name appears among its strings.
  const usedBy = (a) => used.some((u) => u.id === a.id || (!u.id && u.names.some((n) => n === a.id || n === split(a.id)[1])));
  for (const a of assets) if (!usedBy(a)) warnings.push(`${a.id} is drawn but no setItemModel(...) in the code uses it.`);

  let zipFile = null;
  if (!errors.length) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, zip(files.sort().map((rel) => ({ name: rel, data: fs.readFileSync(path.join(packDir, rel)) }))));
    zipFile = outFile;
  }
  return { ok: !errors.length, errors, warnings, assets, zip: zipFile, files: files.length };
}

// Reads back a zip from `zip()` (stored or deflated entries): name -> Buffer.
function unzip(buf) {
  const files = new Map();
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) return files;
  let at = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0 && buf.readUInt32LE(at) === 0x02014b50; n--) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    try { files.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw); } catch {}
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return files;
}

/** Item model id -> PNG data URL for each item a pack zip defines, so the app can draw the mod's items. */
function packTextures(zipFile) {
  const files = unzip(fs.readFileSync(zipFile));
  const json = (rel) => { try { return JSON.parse(files.get(rel).toString('utf8')); } catch { return null; } };
  const out = {};
  for (const rel of files.keys()) {
    const m = rel.match(/^assets\/([^/]+)\/items\/(.+)\.json$/);
    if (!m) continue;
    for (const ref of modelRefs(json(rel)?.model || {})) {
      const [mns, mpath] = split(ref);
      const tex = Object.values(json(`assets/${mns}/models/${mpath}.json`)?.textures || {}).find((t) => typeof t === 'string' && !t.startsWith('#'));
      const [tns, tpath] = tex ? split(tex) : [];
      const png = tex && files.get(`assets/${tns}/textures/${tpath}.png`);
      if (png) { out[`${m[1]}:${m[2]}`] = `data:image/png;base64,${png.toString('base64')}`; break; }
    }
  }
  return out;
}

module.exports = { build, zip, unzip, packTextures, pngSize, codeModels };

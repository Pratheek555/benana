#!/usr/bin/env node
// Draws item textures for this mod's resource pack from pixel-art files in art/.
//
//   node tools/texture.cjs                 render every art/*.json
//   node tools/texture.cjs art/core.json   render one
//
// An art file:
//   {
//     "name": "storm_core",            // item id: lowercase letters, digits and _
//     "style": "generated",            // "generated" (held flat, like a gem) or "handheld" (held like a sword)
//     "palette": { ".": null, "k": "#1b1030", "p": "#8a4bff", "w": "#ffffffcc" },
//     "pixels": [ "16 rows", "of 16 palette characters each (or 32x32)" ]
//   }
//
// For each one it writes:
//   pack/assets/benana/textures/item/<name>.png   the texture
//   pack/assets/benana/models/item/<name>.json    the model
//   pack/assets/benana/items/<name>.json          the item definition the plugin points at:
//                                                 meta.setItemModel(new NamespacedKey("benana", "<name>"))
//   preview/<name>.png                            16x upscale on a checkerboard; Read it to look at your art
// No dependencies: Node's zlib only.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const NS = 'benana';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function color(hex, where) {
  if (hex == null || hex === 'transparent') return [0, 0, 0, 0];
  const m = String(hex).match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) throw new Error(`${where}: "${hex}" is not a #rrggbb or #rrggbbaa color`);
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}

function render(file) {
  const art = JSON.parse(fs.readFileSync(file, 'utf8'));
  const where = path.relative(root, file);
  const name = art.name || path.basename(file, '.json');
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`${where}: name "${name}" must be lowercase letters, digits and _`);
  const rows = art.pixels || [];
  const size = rows.length;
  if (![16, 32].includes(size)) throw new Error(`${where}: pixels needs 16 or 32 rows, found ${size}`);
  const palette = Object.fromEntries(Object.entries(art.palette || {}).map(([k, v]) => [k, color(v, `${where} palette "${k}"`)]));
  const rgba = Buffer.alloc(size * size * 4);
  rows.forEach((row, y) => {
    const chars = [...row];
    if (chars.length !== size) throw new Error(`${where}: row ${y} has ${chars.length} pixels, expected ${size}`);
    chars.forEach((ch, x) => {
      const c = palette[ch];
      if (!c) throw new Error(`${where}: row ${y} uses "${ch}", which is not in the palette`);
      rgba.set(c, (y * size + x) * 4);
    });
  });
  const opaque = [...Array(size * size).keys()].filter((i) => rgba[i * 4 + 3] > 0).length;
  if (opaque < size * size * 0.08) throw new Error(`${where}: only ${opaque} visible pixels; draw a real silhouette`);

  const out = (rel, data) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
    return rel.replace(/\\/g, '/');
  };
  const written = [
    out(`pack/assets/${NS}/textures/item/${name}.png`, png(size, size, rgba)),
    out(`pack/assets/${NS}/models/item/${name}.json`, `${JSON.stringify({ parent: `minecraft:item/${art.style === 'handheld' ? 'handheld' : 'generated'}`, textures: { layer0: `${NS}:item/${name}` } }, null, 2)}\n`),
    out(`pack/assets/${NS}/items/${name}.json`, `${JSON.stringify({ model: { type: 'minecraft:model', model: `${NS}:item/${name}` } }, null, 2)}\n`),
  ];

  // Preview: each pixel becomes a 16x16 square over a grey checkerboard, so transparency is visible.
  const scale = 256 / size;
  const big = Buffer.alloc(256 * 256 * 4);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const s = ((Math.floor(y / scale) * size) + Math.floor(x / scale)) * 4;
      const a = rgba[s + 3] / 255;
      const bg = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 200 : 160;
      const d = (y * 256 + x) * 4;
      for (let k = 0; k < 3; k++) big[d + k] = Math.round(rgba[s + k] * a + bg * (1 - a));
      big[d + 3] = 255;
    }
  }
  written.push(out(`preview/${name}.png`, png(256, 256, big)));
  return { name, model: `${NS}:${name}`, size, written };
}

function main() {
  const args = process.argv.slice(2);
  const files = args.length
    ? args.map((a) => path.resolve(a))
    : fs.existsSync(path.join(root, 'art'))
      ? fs.readdirSync(path.join(root, 'art')).filter((f) => f.endsWith('.json')).map((f) => path.join(root, 'art', f))
      : [];
  if (!files.length) throw new Error('No art files. Write art/<name>.json first (see the header of tools/texture.cjs).');
  for (const f of files) {
    const r = render(f);
    console.log(`${r.model} (${r.size}x${r.size}): ${r.written.join(', ')}`);
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`texture: ${e.message}`); process.exit(1); }
}

module.exports = { png, render };

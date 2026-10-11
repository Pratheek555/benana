// Block textures.
//
// 1. Built-in: 16×16 textures drawn in code in the style of the current vanilla set (no game
//    assets). Every generator is seamlessly tileable (noise and cells wrap at 16 px), and lumpy
//    blocks (gravel, netherrack, glowstone, wart) use lit Voronoi "pebbles" like the real ones.
// 2. Resource pack: if PNGs with vanilla file names exist under /textures/block/, they replace
//    the built-in tiles (see loadPack). Grass and foliage are tinted like vanilla biome colours.
import * as THREE from 'three';
import { rng, hash3 } from './noise.js';

const N = 16;
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const lerp = (a, b, t) => a + (b - a) * t;
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
const tone = (pal, v) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(v * pal.length)))];

// ---------- tileable primitives ----------
// Value noise on a lattice that wraps every `period` cells, so 16 px tiles repeat seamlessly.
function pnoise(x, y, period, seed) {
  const s = N / period;
  const fx = x / s, fy = y / s;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const w = (v) => ((v % period) + period) % period;
  const h = (a, b) => hash3(w(a), w(b), 0, seed);
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return lerp(lerp(h(x0, y0), h(x0 + 1, y0), sx), lerp(h(x0, y0 + 1), h(x0 + 1, y0 + 1), sx), sy);
}
const fbmT = (x, y, seed, periods = [2, 4, 8]) => periods.reduce((v, p, i) => v + pnoise(x, y, p, seed + i * 13) / 2 ** i, 0) / periods.reduce((a, _, i) => a + 1 / 2 ** i, 0);

// Toroidal Voronoi: nearest and second-nearest distance and the owning cell id.
function makeCells(count, seed, jitter = 1) {
  const r = rng(seed);
  const pts = Array.from({ length: count }, () => [r() * N, r() * N, r()]);
  return (x, y) => {
    let d1 = 1e9, d2 = 1e9, id = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      let dx = Math.abs(x + 0.5 - pts[i][0]); let dy = Math.abs(y + 0.5 - pts[i][1]);
      dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy);
      const d = Math.hypot(dx, dy * jitter);
      if (d < d1) { d2 = d1; d1 = d; id = i; cx = pts[i][0]; cy = pts[i][1]; } else if (d < d2) d2 = d;
    }
    // Signed offset from the cell centre (wrapped), used for top-left lighting.
    let ox = x + 0.5 - cx; let oy = y + 0.5 - cy;
    if (ox > N / 2) ox -= N; if (ox < -N / 2) ox += N; if (oy > N / 2) oy -= N; if (oy < -N / 2) oy += N;
    return { d1, d2, id, v: pts[id][2], ox, oy };
  };
}

function tile(draw, seed) {
  const px = new Uint8ClampedArray(N * N * 4);
  const r = rng(seed);
  const set = (x, y, c, a = 255) => { const i = ((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a; };
  const get = (x, y) => { const i = ((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  draw({ set, get, r, seed });
  return px;
}

// ---------- generators ----------
// Soft mottling (stone, dirt, sand, grass top). `specks` sprinkles single darker/lighter pixels.
function mottled(palette, { periods = [2, 4, 8], grain = 0.3, specks = 0, light = 0 } = {}) {
  const pal = palette.map(hex);
  return ({ set, r, seed }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = fbmT(x, y, seed, periods) * (1 - grain) + r() * grain;
      if (specks && r() < specks) v = r() < 0.6 ? 0 : 0.999;
      if (light && r() < light) v = Math.min(0.999, v + 0.3);
      set(x, y, tone(pal, v));
    }
  };
}

// Lumpy pebbles/cells lit from the top-left with dark seams: gravel, netherrack, glowstone…
function pebbles(palette, { count = 9, seam = 0.9, seamColor, highlight = 0.12, centerBright = 0, jitter = 1 } = {}) {
  const pal = palette.map(hex); const sc = seamColor ? hex(seamColor) : null;
  return ({ set, r, seed }) => {
    const cell = makeCells(count, seed, jitter);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = cell(x, y);
      let base = tone(pal, c.v * 0.85 + r() * 0.15);
      const lit = -(c.ox + c.oy) / (c.d1 + 0.6) * highlight; // brighter toward the top-left of each lump
      base = shade(base, 1 + lit + (centerBright ? Math.max(0, 1 - c.d1 / 2.2) * centerBright : 0));
      if (c.d2 - c.d1 < seam) base = sc || shade(base, 0.62);
      set(x, y, base);
    }
  };
}

// Vertical bark with grooves and the odd light streak (logs, stems, basalt sides).
function bark(palette, { groove = 0x000000, grooveEvery = 3, streak = 0, streakColor } = {}) {
  const pal = palette.map(hex); const gc = hex(groove); const stc = streakColor ? hex(streakColor) : null;
  return ({ set, r, seed }) => {
    const cols = Array.from({ length: N }, (_, x) => hash3(x, 0, 0, seed));
    for (let x = 0; x < N; x++) {
      const isGroove = (x + Math.floor(cols[x] * 2)) % grooveEvery === 0;
      for (let y = 0; y < N; y++) {
        let c = tone(pal, cols[x] * 0.6 + pnoise(x, y, 8, seed) * 0.25 + r() * 0.15);
        if (isGroove && pnoise(x, y, 4, seed + 5) > 0.3) c = mixc(c, gc, 0.55);
        if (stc && cols[x] > 1 - streak * 1.6 && pnoise(x, y, 4, seed + 9) > 0.45) c = mixc(c, stc, 0.75); // thin glowing veins
        set(x, y, c);
      }
    }
  };
}
const mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Log ends: bark rim, then rings around a lighter core.
function rings(barkPal, woodPal, { ringColor } = {}) {
  const b = barkPal.map(hex); const w = woodPal.map(hex); const rc = ringColor ? hex(ringColor) : null;
  return ({ set, r }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (edge) { set(x, y, b[Math.floor(r() * b.length)]); continue; }
      let c = w[Math.floor(r() * w.length)];
      if (rc && (Math.round(d) === 2 || Math.round(d) === 5)) c = mixc(c, rc, 0.6);
      set(x, y, c);
    }
  };
}

// Leaves: dense clusters with light tips, darker hollows and transparent gaps.
function leaves(palette, { holes = 0.17, tips } = {}) {
  const pal = palette.map(hex); const tp = tips ? hex(tips) : null;
  return ({ set, r, seed }) => {
    const cell = makeCells(11, seed);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = cell(x, y);
      const v = Math.max(0, Math.min(0.999, 0.75 - c.d1 / 4 + r() * 0.3 - (c.ox + c.oy) * 0.03));
      let col = tone(pal, v);
      if (tp && c.d1 < 0.9 && r() < 0.6) col = tp;
      const gap = c.d2 - c.d1 < 0.55 && r() < holes * 3.2;
      set(x, y, col, gap || r() < holes * 0.25 ? 0 : 255);
    }
  };
}

// Grass-block-style side: base texture with a top fringe of `top` that drips down unevenly.
function fringed(base, topPal, { depth = 3, drip = 0.45, shadow = 0.8 } = {}) {
  const tp = topPal.map(hex);
  return (ctx) => {
    base(ctx);
    const { set, get, r } = ctx;
    for (let x = 0; x < N; x++) {
      let d = depth + (r() < 0.5 ? 1 : 0);
      if (r() < drip) d += 1 + Math.floor(r() * 2.5);
      for (let y = 0; y < d; y++) set(x, y, tp[Math.floor(r() * tp.length)]);
      set(x, d, shade(get(x, d), shadow)); // contact shadow under the fringe
    }
  };
}

function cross(draw) {
  return (ctx) => { for (let i = 0; i < N * N; i++) ctx.set(i % N, Math.floor(i / N), [0, 0, 0], 0); draw(ctx); };
}

// Short grass: blades fanning out from the bottom, lighter at the tips.
function shortGrass(palette) {
  const pal = palette.map(hex);
  return cross(({ set, r }) => {
    for (let b = 0; b < 9; b++) {
      let x = 3 + Math.floor(r() * 10);
      const lean = (x - 7.5) / 9;
      const top = 2 + Math.floor(r() * 9);
      let fx = x;
      for (let y = N - 1; y >= top; y--) {
        const t = (N - 1 - y) / (N - 1 - top + 0.01);
        set(Math.round(fx), y, pal[Math.min(pal.length - 1, Math.floor(t * pal.length))]);
        fx += lean * 0.6 + (r() - 0.5) * 0.3;
      }
    }
  });
}

// Flower: stem with two leaves and a petal head with a contrasting centre.
function flower(petals, centre, { stem = 0x3f7a1e, leaf = 0x52922a, shape = 'cup' } = {}) {
  const p = petals.map(hex); const c = hex(centre); const st = hex(stem); const lf = hex(leaf);
  return cross(({ set, r }) => {
    for (let y = 7; y < N; y++) set(7, y, st);
    set(6, 11, lf); set(5, 10, lf); set(8, 12, lf); set(9, 11, lf);
    const cx = 7, cy = 5;
    const pts = shape === 'cup'
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0, -2], [-2, 0], [2, 0], [0, 2], [-2, -1], [2, -1]]
      : [[0, -2], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2], [-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dy] of pts) set(cx + dx, cy + dy, p[Math.floor(r() * p.length)]);
    set(cx, cy, c);
  });
}

function petalsCover(palette) {
  const p = palette.map(hex);
  return cross(({ set, r }) => {
    for (let k = 0; k < 5; k++) {
      const cx = 2 + Math.floor(r() * 12); const cy = 9 + Math.floor(r() * 6);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) set(cx + dx, cy + dy, p[Math.floor(r() * p.length)]);
      set(cx, cy, hex(0xfff0c0));
    }
  });
}

function roots(palette) {
  const p = palette.map(hex);
  return cross(({ set, r }) => {
    for (let b = 0; b < 6; b++) {
      let x = 2 + Math.floor(r() * 12); const top = 3 + Math.floor(r() * 7);
      for (let y = N - 1; y >= top; y--) { set(x, y, p[Math.floor(r() * p.length)]); if (r() < 0.25) x += r() < 0.5 ? -1 : 1; }
      set(x, top - 1, p[p.length - 1]);
    }
  });
}

// Birch: white bark with short dark horizontal marks.
function birchBark() {
  const white = [0xd9d5c9, 0xe4e0d4, 0xeeebe1, 0xcfcbbf].map(hex); const dark = hex(0x2b2a26); const grey = hex(0x8f8b80);
  return ({ set, r, seed }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) set(x, y, white[Math.floor(r() * white.length)]);
    for (let k = 0; k < 9; k++) {
      const y = Math.floor(r() * N); const x0 = Math.floor(r() * N); const len = 2 + Math.floor(r() * 4);
      for (let i = 0; i < len; i++) set(x0 + i, y, i === 0 || i === len - 1 ? grey : dark);
      if (r() < 0.4) set(x0 + 1, y + 1, grey);
    }
    void seed;
  };
}

const PAL = {
  grass: [0x4b7f29, 0x568f2f, 0x5f9b34, 0x6aa63b, 0x78b245, 0x86bd4f],
  dirt: [0x5e3f28, 0x6b4a30, 0x795437, 0x86603f, 0x926a46, 0x9e7650],
  stone: [0x5f5f5f, 0x6c6c6c, 0x777777, 0x808080, 0x898989, 0x949494, 0xa0a0a0],
  netherrack: [0x5a1e1e, 0x672424, 0x732a2a, 0x7f3131, 0x8b3838, 0x963f3f],
};

const T = {
  // ----- overworld -----
  grass_top: mottled(PAL.grass, { periods: [4, 8, 16], grain: 0.55, light: 0.05 }),
  grass_side: fringed(mottled(PAL.dirt, { grain: 0.45, specks: 0.06 }), [0x5f9b34, 0x6aa63b, 0x78b245, 0x568f2f]),
  dirt: mottled(PAL.dirt, { grain: 0.45, specks: 0.06 }),
  stone: mottled(PAL.stone, { periods: [4, 8, 16], grain: 0.32, specks: 0.035 }),
  andesite: pebbles([0x7d7f7f, 0x868888, 0x8f9191, 0x989a9a, 0xa3a5a5], { count: 14, seam: 0.45, highlight: 0.06 }),
  sand: mottled([0xd2c690, 0xd9cd99, 0xdfd4a2, 0xe5dbab, 0xebe1b4], { periods: [4, 8], grain: 0.6 }),
  gravel: pebbles([0x5b5452, 0x6e6664, 0x817977, 0x948c89, 0xa8a09d], { count: 13, seam: 0.7, highlight: 0.14, seamColor: 0x403a38 }),
  snow: mottled([0xe6eef4, 0xedf3f8, 0xf4f8fb, 0xfbfdff], { periods: [4, 8], grain: 0.4 }),
  snow_side: fringed(mottled(PAL.dirt, { grain: 0.45, specks: 0.06 }), [0xf4f8fb, 0xfbfdff, 0xe6eef4], { depth: 4, drip: 0.5 }),
  oak_log: bark([0x4a3721, 0x5a4329, 0x665032, 0x735b3a], { groove: 0x2a1f12, grooveEvery: 3 }),
  oak_top: rings([0x4a3721, 0x5a4329], [0xb08f5c, 0xa6855a, 0xba9a66], { ringColor: 0x8c6a3e }),
  oak_leaves: leaves([0x2a5b18, 0x336b1d, 0x3c7a22, 0x478a2a, 0x529633], { tips: 0x63a83c }),
  birch_log: birchBark(),
  birch_top: rings([0xd9d5c9, 0x2b2a26], [0xc9b27a, 0xd2bc86, 0xbfa870], { ringColor: 0xa48e5a }),
  birch_leaves: leaves([0x4a7230, 0x557f37, 0x618b3f, 0x6e9849], { tips: 0x84ac57 }),
  cherry_log: bark([0x2e1a23, 0x3a2230, 0x452a3a, 0x523243], { groove: 0x170c12, grooveEvery: 2 }),
  cherry_top: rings([0x3a2230, 0x2e1a23], [0xd9a7ae, 0xe3b4ba, 0xcd99a1], { ringColor: 0xb47f88 }),
  cherry_leaves: leaves([0xd5799f, 0xe48db0, 0xef9fbf, 0xf6b3cd, 0xfbc8db], { holes: 0.13, tips: 0xffe0ec }),
  tall_grass: shortGrass([0x3f7522, 0x4b8429, 0x5a9532, 0x6aa63b, 0x7cb747]),
  poppy: flower([0xc81a1a, 0xdc2a26, 0xe9443a], 0x241a0e),
  dandelion: flower([0xf2c623, 0xfbd93a, 0xffe75e], 0xd99a12, { shape: 'star' }),
  cornflower: flower([0x3c5fd6, 0x4f74e6, 0x6a8cf3], 0x1e2f7a, { shape: 'star' }),
  pink_petals: petalsCover([0xf4a9c7, 0xfbc0d6, 0xec95b9]),
  // ----- nether -----
  netherrack: pebbles(PAL.netherrack, { count: 12, seam: 0.55, seamColor: 0x3e1212, highlight: 0.1 }),
  crimson_nylium: mottled([0x7a1414, 0x8c1818, 0x9e1d1d, 0xb02424, 0xc23030], { periods: [4, 8], grain: 0.55, light: 0.04 }),
  crimson_side: fringed(pebbles(PAL.netherrack, { count: 12, seam: 0.55, seamColor: 0x3e1212, highlight: 0.1 }), [0x8c1818, 0x9e1d1d, 0xb02424]),
  warped_nylium: mottled([0x165c55, 0x1b6d64, 0x217e74, 0x288f83, 0x30a092], { periods: [4, 8], grain: 0.55, light: 0.04 }),
  warped_side: fringed(pebbles(PAL.netherrack, { count: 12, seam: 0.55, seamColor: 0x3e1212, highlight: 0.1 }), [0x1b6d64, 0x217e74, 0x288f83]),
  crimson_stem: bark([0x4f1426, 0x5e1a2e, 0x6d2036, 0x7c2840], { groove: 0x2a0812, grooveEvery: 2, streak: 0.12, streakColor: 0xd04a6a }),
  crimson_stem_top: rings([0x5e1a2e, 0x4f1426], [0x8f3044, 0x9c3a4e, 0x82293c], { ringColor: 0x6a1e30 }),
  warped_stem: bark([0x203f48, 0x274d58, 0x2e5b68, 0x356978], { groove: 0x10222a, grooveEvery: 2, streak: 0.12, streakColor: 0x3fd4b8 }),
  warped_stem_top: rings([0x274d58, 0x203f48], [0x2f8a78, 0x389a86, 0x287a6a], { ringColor: 0x1f6a5c }),
  nether_wart_block: pebbles([0x6a0a0a, 0x7a0e0e, 0x8c1212, 0x9e1818, 0xb02020], { count: 10, seam: 0.5, highlight: 0.16 }),
  warped_wart_block: pebbles([0x0f6a62, 0x147a72, 0x198c83, 0x1fa094, 0x27b3a6], { count: 10, seam: 0.5, highlight: 0.16 }),
  shroomlight: pebbles([0xd9762a, 0xe68a34, 0xf0a040, 0xf8b850], { count: 8, seam: 0.5, seamColor: 0xa04a1a, centerBright: 0.35 }),
  glowstone: pebbles([0xb58938, 0xcfa449, 0xe3bb5c, 0xf2d27a], { count: 10, seam: 0.6, seamColor: 0x6b4a1c, centerBright: 0.45 }),
  magma: pebbles([0x3a1206, 0x4a1806, 0x5a1e08, 0x66240a], { count: 9, seam: 0.38, seamColor: 0xff7a14, highlight: 0.05 }),
  basalt: bark([0x3e3d42, 0x48474c, 0x525157, 0x5c5b61], { groove: 0x26252a, grooveEvery: 3 }),
  basalt_top: pebbles([0x45444a, 0x504f55, 0x5b5a60, 0x66656b], { count: 7, seam: 0.6, highlight: 0.08 }),
  blackstone: pebbles([0x1e1a20, 0x262128, 0x2e2830, 0x372f39], { count: 11, seam: 0.5, highlight: 0.1 }),
  soul_sand: pebbles([0x47362a, 0x523f31, 0x5d4838, 0x68513f], { count: 10, seam: 0.8, seamColor: 0x2c2018, highlight: 0.1 }),
  crimson_roots: roots([0x7c1414, 0x9e1818, 0xb52b2b, 0xd04040]),
  warped_roots: roots([0x147a72, 0x1a8c83, 0x22a094, 0x3fd4b8]),
};

export const TILE = Object.fromEntries(Object.keys(T).map((k, i) => [k, i]));
const KEYS = Object.keys(T);

function arrayTexture(data, size, layers) {
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function buildTextureArray() {
  const data = new Uint8Array(N * N * 4 * KEYS.length);
  KEYS.forEach((k, i) => data.set(tile(T[k], i * 101 + 7), i * N * N * 4));
  return arrayTexture(data, N, KEYS.length);
}

// ---------- resource pack loader ----------
// Vanilla file names for each tile, plus the biome tint vanilla applies to greyscale textures.
const GRASS = [0x91, 0xbd, 0x59]; // plains grass
const FOLIAGE = [0x77, 0xab, 0x2f]; // plains foliage
const BIRCH = [0x80, 0xa7, 0x55];
const PACK = {
  grass_top: ['grass_block_top', GRASS], grass_side: ['grass_block_side', null, 'grass_block_side_overlay'], dirt: ['dirt'],
  stone: ['stone'], andesite: ['andesite'], sand: ['sand'], gravel: ['gravel'], snow: ['snow'], snow_side: ['grass_block_snow'],
  oak_log: ['oak_log'], oak_top: ['oak_log_top'], oak_leaves: ['oak_leaves', FOLIAGE], birch_log: ['birch_log'], birch_top: ['birch_log_top'],
  birch_leaves: ['birch_leaves', BIRCH], cherry_log: ['cherry_log'], cherry_top: ['cherry_log_top'], cherry_leaves: ['cherry_leaves'],
  tall_grass: [['short_grass', 'grass'], GRASS], poppy: ['poppy'], dandelion: ['dandelion'], cornflower: ['cornflower'], pink_petals: ['pink_petals'],
  netherrack: ['netherrack'], crimson_nylium: ['crimson_nylium'], crimson_side: ['crimson_nylium_side'], warped_nylium: ['warped_nylium'],
  warped_side: ['warped_nylium_side'], crimson_stem: ['crimson_stem'], crimson_stem_top: ['crimson_stem_top'], warped_stem: ['warped_stem'],
  warped_stem_top: ['warped_stem_top'], nether_wart_block: ['nether_wart_block'], warped_wart_block: ['warped_wart_block'], shroomlight: ['shroomlight'],
  glowstone: ['glowstone'], magma: ['magma'], basalt: ['basalt_side'], basalt_top: ['basalt_top'], blackstone: ['blackstone'], soul_sand: ['soul_sand'],
  crimson_roots: ['crimson_roots'], warped_roots: ['warped_roots'],
};

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function firstImage(base, names) {
  for (const n of [].concat(names)) { const img = await loadImage(`${base}/${n}.png`); if (img) return img; }
  return null;
}

// Returns a texture array built from the pack, falling back per tile to the built-in texture,
// or null when no pack is installed. Animated strips (magma, etc.) use their first frame.
export async function loadPack(base = '/textures/block') {
  if (!(await loadImage(`${base}/stone.png`))) return null;
  const imgs = await Promise.all(KEYS.map((k) => (PACK[k] ? firstImage(base, PACK[k][0]) : null)));
  const size = Math.max(N, ...imgs.filter(Boolean).map((i) => i.width));
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  const data = new Uint8Array(size * size * 4 * KEYS.length);
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[i];
    g.clearRect(0, 0, size, size);
    const img = imgs[i];
    if (img) {
      g.drawImage(img, 0, 0, img.width, img.width, 0, 0, size, size); // square top frame
      const overlay = PACK[k][2] && (await loadImage(`${base}/${PACK[k][2]}.png`));
      if (overlay) {
        const o = document.createElement('canvas'); o.width = o.height = size;
        const og = o.getContext('2d'); og.imageSmoothingEnabled = false;
        og.drawImage(overlay, 0, 0, overlay.width, overlay.width, 0, 0, size, size);
        tintCanvas(og, size, GRASS);
        g.drawImage(o, 0, 0);
      }
      if (PACK[k][1]) tintCanvas(g, size, PACK[k][1]);
    } else {
      // Built-in fallback for tiles the pack lacks, scaled up with nearest-neighbour.
      const px = tile(T[k], i * 101 + 7);
      const t = document.createElement('canvas'); t.width = t.height = N;
      t.getContext('2d').putImageData(new ImageData(px, N, N), 0, 0);
      g.drawImage(t, 0, 0, size, size);
    }
    data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
  }
  let credit = null;
  try { const r = await fetch(`${base}/../credit.txt`); if (r.ok) credit = (await r.text()).trim().slice(0, 300); } catch { /* optional */ }
  return { texture: arrayTexture(data, size, KEYS.length), size, credit };
}

function tintCanvas(g, size, [tr, tg, tb]) {
  const d = g.getImageData(0, 0, size, size);
  for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (d.data[i] * tr) / 255; d.data[i + 1] = (d.data[i + 1] * tg) / 255; d.data[i + 2] = (d.data[i + 2] * tb) / 255; }
  g.putImageData(d, 0, 0);
}

// ---------- liquids ----------
export function lavaTexture() {
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S);
  const pal = [0x8a1c00, 0xc23a00, 0xe85a00, 0xff7a10, 0xffa030, 0xffd060].map(hex);
  const cell = makeCells(9, 41);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c1 = cell(x % N, y % N);
    const v = pnoise(x % N, y % N, 4, 3) * 0.55 + (1 - Math.min(1, (c1.d2 - c1.d1) / 3)) * 0.45;
    img.data.set([...tone(pal, Math.pow(v, 1.2)), 255], (y * S + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function waterNormal() {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S);
  // Sum of waves with integer frequencies, so the map tiles seamlessly.
  const waves = [[3, 1, 0.0, 1], [-2, 4, 1.3, 0.8], [5, -3, 2.1, 0.55], [7, 6, 0.7, 0.35], [-9, 4, 4.2, 0.25], [12, -11, 1.9, 0.15], [-15, -7, 3.3, 0.12]];
  const h = (x, y) => waves.reduce((v, [a, b, p, amp]) => v + amp * Math.sin(((a * x + b * y) / S) * Math.PI * 2 + p), 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h(x + 1, y) - h(x - 1, y); const dy = h(x, y + 1) - h(x, y - 1);
    const l = Math.hypot(dx, dy, 1);
    img.data.set([((-dx / l) * 0.5 + 0.5) * 255, ((-dy / l) * 0.5 + 0.5) * 255, (1 / l) * 255, 255], (y * S + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// For the texture preview page.
export function tilePixels(key) { return tile(T[key], KEYS.indexOf(key) * 101 + 7); }
export { KEYS };

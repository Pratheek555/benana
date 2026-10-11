// 16×16 block textures in the style of the modern (1.14+) Minecraft texture set, drawn in code
// (no game assets). All tiles live in one texture array so mipmaps never bleed between tiles.
import * as THREE from 'three';
import { rng, noise2 } from './noise.js';

const N = 16;
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

// A tile is drawn into a Uint8ClampedArray(16*16*4).
function tile(draw, seed) {
  const px = new Uint8ClampedArray(N * N * 4);
  const r = rng(seed);
  const set = (x, y, c, a = 255) => { const i = ((y & 15) * N + (x & 15)) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a; };
  const get = (x, y) => { const i = ((y & 15) * N + (x & 15)) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  draw({ set, get, r, n: (x, y, f = 0.35, s = 0) => noise2(x * f, y * f, seed * 7 + s) });
  return px;
}

// Clustered palette fill: low-frequency noise picks the band, high-frequency adds grain.
function cluster(palette, { f = 0.45, grain = 0.35 } = {}) {
  const pal = palette.map(hex);
  return ({ set, r, n }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = Math.min(0.999, Math.max(0, n(x, y, f) * (1 - grain) + r() * grain));
      set(x, y, pal[Math.floor(v * pal.length)]);
    }
  };
}

function grassSide(top, dirt) {
  return (ctx) => {
    cluster(dirt)(ctx);
    const pal = top.map(hex);
    for (let x = 0; x < N; x++) {
      const d = 2 + Math.floor(ctx.r() * 2.2) + (ctx.r() < 0.25 ? 2 : 0);
      for (let y = 0; y < d; y++) ctx.set(x, y, pal[Math.floor(ctx.r() * pal.length)]);
    }
  };
}

function bark(palette, { stripes = 3 } = {}) {
  const pal = palette.map(hex);
  return ({ set, r, n }) => {
    for (let x = 0; x < N; x++) {
      const col = Math.floor(n(x, 0, 0.9) * pal.length * 0.999);
      for (let y = 0; y < N; y++) {
        let c = pal[Math.min(pal.length - 1, Math.max(0, col + (r() < 0.2 ? 1 : 0) - (r() < 0.12 ? 1 : 0)))];
        if ((x + Math.floor(n(x, y, 0.25) * 3)) % stripes === 0) c = shade(c, 0.78);
        set(x, y, c);
      }
    }
  };
}

function rings(outer, inner) {
  const o = outer.map(hex); const i = inner.map(hex);
  return ({ set, r }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = Math.floor(d) % 2 === 0;
      set(x, y, edge ? o[Math.floor(r() * o.length)] : shade(i[Math.floor(r() * i.length)], ring ? 0.88 : 1));
    }
  };
}

function leaves(palette, holes = 0.16) {
  const pal = palette.map(hex);
  return ({ set, r, n }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = Math.min(0.999, n(x, y, 0.6) * 0.6 + r() * 0.4);
      set(x, y, pal[Math.floor(v * pal.length)], r() < holes ? 0 : 255);
    }
  };
}

// Cross-quad plant: drawn blades/stems on transparent background.
function plant(stem, head) {
  const s = stem.map(hex); const h = head ? head.map(hex) : null;
  return ({ set, r }) => {
    for (let i = 0; i < N * N; i++) set(i % N, Math.floor(i / N), [0, 0, 0], 0);
    if (!h) {
      for (let b = 0; b < 7; b++) {
        let x = 2 + Math.floor(r() * 12);
        const top = 3 + Math.floor(r() * 8);
        for (let y = N - 1; y >= top; y--) { set(x, y, s[Math.floor(r() * s.length)]); if (r() < 0.18) x += r() < 0.5 ? -1 : 1; }
      }
    } else {
      for (let y = 8; y < N; y++) set(7 + (y % 3 === 0 ? 1 : 0), y, s[0]);
      set(6, 11, s[1] || s[0]); set(9, 12, s[1] || s[0]);
      for (let y = 3; y < 9; y++) for (let x = 5; x < 11; x++) {
        const d = Math.hypot(x - 7.5, y - 5.5);
        if (d < 2.9) set(x, y, d < 1.1 && h[2] ? h[2] : h[Math.floor(r() * Math.min(2, h.length))]);
      }
    }
  };
}

function emissive(palette, spots, spotColor) {
  const pal = palette.map(hex); const sc = hex(spotColor);
  return ({ set, r, n }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = Math.min(0.999, n(x, y, 0.5) * 0.7 + r() * 0.3);
      set(x, y, n(x, y, 0.8, 9) > 1 - spots ? sc : pal[Math.floor(v * pal.length)]);
    }
  };
}

function cracks(base, crack, amount = 0.5) {
  const b = base.map(hex); const c = hex(crack);
  return ({ set, r, n }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = Math.min(0.999, n(x, y, 0.5) * 0.6 + r() * 0.4);
      const k = Math.abs(n(x, y, 0.32, 5) - 0.5);
      set(x, y, k < 0.04 * amount * 2 ? c : b[Math.floor(v * b.length)]);
    }
  };
}

const T = {
  // overworld
  grass_top: cluster([0x4f8f2f, 0x5a9c35, 0x67aa3d, 0x72b544, 0x5e9f38, 0x80c04d], { f: 0.5 }),
  grass_side: grassSide([0x5a9c35, 0x67aa3d, 0x72b544], [0x7a5233, 0x8a5c3a, 0x936443, 0x6f4a2d, 0x9c6e4b]),
  dirt: cluster([0x6f4a2d, 0x7a5233, 0x8a5c3a, 0x936443, 0x9c6e4b, 0x83593a], { f: 0.55, grain: 0.5 }),
  stone: cracks([0x7e7e7e, 0x868686, 0x8f8f8f, 0x777777, 0x969696], 0x666666, 0.6),
  andesite: cluster([0x7f8282, 0x888b8b, 0x939696, 0x747777, 0x9da0a0], { f: 0.7, grain: 0.45 }),
  sand: cluster([0xdbcf9c, 0xe2d6a6, 0xd4c78f, 0xe8ddb1, 0xcfc088], { f: 0.6, grain: 0.6 }),
  gravel: cluster([0x7d7471, 0x8f8582, 0x6a6260, 0xa19794, 0x5d5654], { f: 0.9, grain: 0.7 }),
  snow: cluster([0xf2f6fa, 0xe9eff5, 0xfbfdff, 0xdfe7ef], { f: 0.5, grain: 0.5 }),
  snow_side: grassSide([0xf2f6fa, 0xe9eff5, 0xfbfdff], [0x7e7e7e, 0x868686, 0x8f8f8f, 0x777777]),
  oak_log: bark([0x4d3a22, 0x5c4529, 0x6b5131, 0x785b37]),
  oak_top: rings([0x5c4529, 0x4d3a22], [0xa88754, 0xb6935d, 0x9c7c4a]),
  oak_leaves: leaves([0x2f6d22, 0x3a7d29, 0x468c31, 0x529a38, 0x2a6020]),
  birch_log: ({ set, r, n }) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dark = n(x, y, 0.45, 3) > 0.74 && r() < 0.9;
      set(x, y, dark ? hex(0x2d2a26) : hex([0xe8e5dc, 0xdedbd1, 0xf2efe7, 0xd2cfc4][Math.floor(r() * 4)]));
    }
  },
  birch_top: rings([0xe8e5dc, 0xd2cfc4], [0xc8b47a, 0xd6c38a, 0xbca86e]),
  birch_leaves: leaves([0x5b8a35, 0x6a9a3e, 0x79a947, 0x4e7c2e]),
  cherry_log: bark([0x3a2430, 0x47293a, 0x553245, 0x2e1c26]),
  cherry_top: rings([0x47293a, 0x3a2430], [0xd8a7b0, 0xe6b8c0, 0xc7959f]),
  cherry_leaves: leaves([0xf4b6cf, 0xeca3c2, 0xfac6da, 0xe590b6, 0xffd6e6], 0.12),
  tall_grass: plant([0x4f8f2f, 0x5a9c35, 0x67aa3d, 0x72b544]),
  poppy: plant([0x3d7a2a, 0x2f6d22], [0xd02828, 0xe03a3a, 0x2a2a2a]),
  dandelion: plant([0x3d7a2a, 0x2f6d22], [0xf3d23a, 0xffe04f, 0xe8b52a]),
  cornflower: plant([0x3d7a2a, 0x2f6d22], [0x4f6fe6, 0x6a86f2, 0x2a3fa0]),
  pink_petals: plant([0x3d7a2a], [0xfac6da, 0xf4b6cf, 0xffe9f1]),
  // nether
  netherrack: cracks([0x6e2a2a, 0x7a3030, 0x612424, 0x843737, 0x5a2020], 0x3e1414, 0.7),
  crimson_nylium: cluster([0x8f1d1d, 0xa22222, 0xb52b2b, 0x7c1818, 0xc23434], { f: 0.6 }),
  crimson_side: grassSide([0xa22222, 0xb52b2b, 0x8f1d1d], [0x6e2a2a, 0x7a3030, 0x612424, 0x843737]),
  warped_nylium: cluster([0x1f6b63, 0x237a70, 0x2b8c80, 0x185a53, 0x34a090], { f: 0.6 }),
  warped_side: grassSide([0x237a70, 0x2b8c80, 0x1f6b63], [0x6e2a2a, 0x7a3030, 0x612424, 0x843737]),
  crimson_stem: bark([0x5a1a2c, 0x6d2036, 0x7e2840, 0x4a1424], { stripes: 2 }),
  crimson_stem_top: rings([0x6d2036, 0x5a1a2c], [0x9a3a4e, 0xab4458, 0x8a3144]),
  warped_stem: bark([0x2a4f5a, 0x316070, 0x3a6f80, 0x1f3e48], { stripes: 2 }),
  warped_stem_top: rings([0x316070, 0x2a4f5a], [0x3aa38f, 0x45b39e, 0x2f8f7c]),
  nether_wart_block: cluster([0x7a0e0e, 0x8c1212, 0x9e1818, 0x6a0b0b, 0xb02020], { f: 0.7, grain: 0.4 }),
  warped_wart_block: cluster([0x167a72, 0x1a8c83, 0x22a094, 0x126b64, 0x29b3a5], { f: 0.7, grain: 0.4 }),
  shroomlight: emissive([0xf0a040, 0xf8b850, 0xe08a30, 0xffcc66], 0.25, 0xfff0b0),
  glowstone: emissive([0xb98b3c, 0xd4a64a, 0xa07428, 0xe8c066], 0.35, 0xfff3c4),
  magma: cracks([0x5a1e08, 0x6a240a, 0x4a1806, 0x7a2c0c], 0xff8a1a, 1.6),
  basalt: bark([0x45444a, 0x504f56, 0x5b5a61, 0x3a393e], { stripes: 3 }),
  basalt_top: cluster([0x4a494f, 0x55545a, 0x403f45, 0x605f66], { f: 0.9, grain: 0.6 }),
  blackstone: cluster([0x221d24, 0x2b252e, 0x342d37, 0x1a161c, 0x3d3540], { f: 0.6, grain: 0.5 }),
  soul_sand: cluster([0x4c3a2e, 0x5a4536, 0x3f3026, 0x66503f], { f: 0.8, grain: 0.6 }),
  crimson_roots: plant([0x9e1818, 0xb52b2b, 0x7c1818]),
  warped_roots: plant([0x1a8c83, 0x22a094, 0x29b3a5]),
};

export const TILE = Object.fromEntries(Object.keys(T).map((k, i) => [k, i]));

export function buildTextureArray() {
  const keys = Object.keys(T);
  const data = new Uint8Array(N * N * 4 * keys.length);
  keys.forEach((k, i) => data.set(tile(T[k], i * 101 + 7), i * N * N * 4));
  const tex = new THREE.DataArrayTexture(data, N, N, keys.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Lava surface (tiled, scrolls in the shader) and a water normal map.
export function lavaTexture() {
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S);
  const pal = [0x8a1c00, 0xc23a00, 0xe85a00, 0xff7a10, 0xffa030, 0xffd060].map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = noise2(x * 0.12, y * 0.12, 3) * 0.7 + noise2(x * 0.4, y * 0.4, 9) * 0.3;
    const p = pal[Math.min(pal.length - 1, Math.floor(Math.pow(v, 1.4) * pal.length * 1.15))];
    img.data.set([...p, 255], (y * S + x) * 4);
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

export { mix, shade };

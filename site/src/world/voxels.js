// Voxel storage and meshing. Only faces that touch air (or a see-through block) are emitted,
// and each face vertex gets ambient occlusion from its three neighbours — Minecraft's
// "smooth lighting" — which is most of what makes blocks read as solid and modern.
import * as THREE from 'three';
import { TILE } from './textures.js';

// kind: solid | cutout (leaves) | plant (cross quads)
const DEFS = [
  ['air'],
  ['grass', 'solid', { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }],
  ['dirt', 'solid', 'dirt'],
  ['stone', 'solid', 'stone'],
  ['andesite', 'solid', 'andesite'],
  ['sand', 'solid', 'sand'],
  ['gravel', 'solid', 'gravel'],
  ['snow', 'solid', { top: 'snow', side: 'snow_side', bottom: 'stone' }],
  ['oak_log', 'solid', { top: 'oak_top', side: 'oak_log', bottom: 'oak_top' }],
  ['oak_leaves', 'cutout', 'oak_leaves', { wave: 0.5 }],
  ['birch_log', 'solid', { top: 'birch_top', side: 'birch_log', bottom: 'birch_top' }],
  ['birch_leaves', 'cutout', 'birch_leaves', { wave: 0.5 }],
  ['cherry_log', 'solid', { top: 'cherry_top', side: 'cherry_log', bottom: 'cherry_top' }],
  ['cherry_leaves', 'cutout', 'cherry_leaves', { wave: 0.6 }],
  ['tall_grass', 'plant', 'tall_grass', { wave: 1 }],
  ['poppy', 'plant', 'poppy', { wave: 0.8 }],
  ['dandelion', 'plant', 'dandelion', { wave: 0.8 }],
  ['cornflower', 'plant', 'cornflower', { wave: 0.8 }],
  ['pink_petals', 'plant', 'pink_petals', { wave: 0.6 }],
  ['netherrack', 'solid', 'netherrack'],
  ['crimson_nylium', 'solid', { top: 'crimson_nylium', side: 'crimson_side', bottom: 'netherrack' }],
  ['warped_nylium', 'solid', { top: 'warped_nylium', side: 'warped_side', bottom: 'netherrack' }],
  ['crimson_stem', 'solid', { top: 'crimson_stem_top', side: 'crimson_stem', bottom: 'crimson_stem_top' }],
  ['warped_stem', 'solid', { top: 'warped_stem_top', side: 'warped_stem', bottom: 'warped_stem_top' }],
  ['nether_wart_block', 'solid', 'nether_wart_block'],
  ['warped_wart_block', 'solid', 'warped_wart_block'],
  ['shroomlight', 'solid', 'shroomlight', { emit: 2 }],
  ['glowstone', 'solid', 'glowstone', { emit: 2.4 }],
  ['magma', 'solid', 'magma', { emit: 1.6 }],
  ['basalt', 'solid', { top: 'basalt_top', side: 'basalt', bottom: 'basalt_top' }],
  ['blackstone', 'solid', 'blackstone'],
  ['soul_sand', 'solid', 'soul_sand'],
  ['crimson_roots', 'plant', 'crimson_roots', { wave: 1 }],
  ['warped_roots', 'plant', 'warped_roots', { wave: 1 }],
];

export const B = {};
export const BLOCKS = DEFS.map(([name, kind = 'air', tex, opts = {}], id) => {
  B[name] = id;
  const t = typeof tex === 'string' ? { top: tex, side: tex, bottom: tex } : tex || {};
  return { id, name, kind, emit: opts.emit || 0, wave: opts.wave || 0, tiles: t.top ? [TILE[t.side], TILE[t.side], TILE[t.top], TILE[t.bottom], TILE[t.side], TILE[t.side]] : null };
});

export class Voxels {
  constructor(sx, sy, sz) {
    Object.assign(this, { sx, sy, sz, ox: -Math.floor(sx / 2), oz: -Math.floor(sz / 2) });
    this.data = new Uint8Array(sx * sy * sz);
    this.top = new Int16Array(sx * sz).fill(-1);
  }
  idx(x, y, z) { return (y * this.sz + (z - this.oz)) * this.sx + (x - this.ox); }
  inside(x, y, z) { return x >= this.ox && x < this.ox + this.sx && y >= 0 && y < this.sy && z >= this.oz && z < this.oz + this.sz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.data[this.idx(x, y, z)] : 0; }
  set(x, y, z, b) {
    if (!this.inside(x, y, z)) return;
    this.data[this.idx(x, y, z)] = b;
    const c = (z - this.oz) * this.sx + (x - this.ox);
    if (b && y > this.top[c]) this.top[c] = y;
  }
  setIfAir(x, y, z, b) { if (this.get(x, y, z) === 0) this.set(x, y, z, b); }
}

// Face definitions: direction, 4 corners (CCW from outside), tile index into def.tiles.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], t: 0, shade: 0.8 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], t: 1, shade: 0.8 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], t: 2, shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], t: 3, shade: 0.55 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], t: 4, shade: 0.9 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], t: 5, shade: 0.9 },
];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_CURVE = [0.42, 0.62, 0.8, 1];

class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.l = []; this.e = []; this.w = []; this.i = []; this.v = 0; }
  quad(verts, normal, layer, ao, emit, wave) {
    for (let k = 0; k < 4; k++) {
      this.p.push(...verts[k]); this.n.push(...normal); this.uv.push(...UVS[k]);
      this.c.push(ao[k], ao[k], ao[k]); this.l.push(layer); this.e.push(emit); this.w.push(wave[k]);
    }
    const v = this.v;
    // Flip the diagonal so AO interpolates without the classic anisotropy artefact.
    if (ao[0] + ao[2] > ao[1] + ao[3]) this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    else this.i.push(v + 1, v + 2, v + 3, v + 1, v + 3, v);
    this.v += 4;
  }
  // Typed arrays, so a worker can hand them to the page without copying.
  arrays() {
    return {
      position: new Float32Array(this.p), normal: new Float32Array(this.n), uv: new Float32Array(this.uv), color: new Float32Array(this.c),
      layer: new Float32Array(this.l), emit: new Float32Array(this.e), wave: new Float32Array(this.w),
      index: this.v > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
    };
  }
}

const SIZES = { position: 3, normal: 3, uv: 2, color: 3, layer: 1, emit: 1, wave: 1 };
export function geometryFrom(a) {
  const g = new THREE.BufferGeometry();
  for (const [k, n] of Object.entries(SIZES)) g.setAttribute(k, new THREE.BufferAttribute(a[k], n));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  return g;
}
export const transferables = (a) => Object.values(a).map((x) => x.buffer);

export function mesh(vox) {
  const solid = new Buf();
  const cutout = new Buf();
  const opaque = (b) => b && BLOCKS[b].kind === 'solid';
  const occ = (x, y, z) => (opaque(vox.get(x, y, z)) ? 1 : 0);
  for (let z = vox.oz; z < vox.oz + vox.sz; z++) {
    for (let x = vox.ox; x < vox.ox + vox.sx; x++) {
      const topY = vox.top[(z - vox.oz) * vox.sx + (x - vox.ox)];
      for (let y = 0; y <= topY; y++) {
        const id = vox.get(x, y, z);
        if (!id) continue;
        const def = BLOCKS[id];
        if (def.kind === 'plant') {
          const layer = def.tiles[0];
          const s = 0.42;
          for (const [ax, az, bx, bz] of [[-s, -s, s, s], [-s, s, s, -s]]) {
            const cx = x + 0.5; const cz = z + 0.5;
            const v = [[cx + ax, y, cz + az], [cx + bx, y, cz + bz], [cx + bx, y + 0.95, cz + bz], [cx + ax, y + 0.95, cz + az]];
            cutout.quad(v, [0, 1, 0], layer, [0.85, 0.85, 1, 1], def.emit, [0, 0, def.wave, def.wave]);
          }
          continue;
        }
        const buf = def.kind === 'cutout' ? cutout : solid;
        for (const f of FACES) {
          const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
          const nb = vox.get(nx, ny, nz);
          if (opaque(nb)) continue;
          if (def.kind === 'cutout' && nb === id) continue; // no inner faces inside a leaf mass
          const ao = [];
          const verts = [];
          for (const c of f.c) {
            verts.push([x + c[0], y + c[1], z + c[2]]);
            // The two edge neighbours and the corner neighbour on the face's outer side.
            const dx = c[0] ? 1 : -1, dy = c[1] ? 1 : -1, dz = c[2] ? 1 : -1;
            let s1, s2, cr;
            if (f.n[0]) { s1 = occ(nx, y + dy, z); s2 = occ(nx, y, z + dz); cr = occ(nx, y + dy, z + dz); }
            else if (f.n[1]) { s1 = occ(x + dx, ny, z); s2 = occ(x, ny, z + dz); cr = occ(x + dx, ny, z + dz); }
            else { s1 = occ(x + dx, y, nz); s2 = occ(x, y + dy, nz); cr = occ(x + dx, y + dy, nz); }
            const level = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            ao.push(AO_CURVE[level] * f.shade);
          }
          buf.quad(verts, f.n, def.tiles[f.t], ao, def.emit, [def.wave, def.wave, def.wave, def.wave]);
        }
      }
    }
  }
  return { solid: solid.arrays(), cutout: cutout.arrays() };
}

// Patches a MeshStandardMaterial to sample the block texture array, add per-vertex emission,
// and sway leaves and plants in the wind.
export function blockMaterial({ cutout = false, uniforms }) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0, side: cutout ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: cutout ? 0.5 : 0, envMapIntensity: 0.55,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBlocks = uniforms.uBlocks; // shared, so a resource pack can be swapped in live
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float layer; attribute float emit; attribute float wave;
        varying float vLayer; varying float vEmit; varying vec2 vTileUv;
        uniform float uTime; uniform float uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLayer = layer; vEmit = emit; vTileUv = uv;
        if (wave > 0.0) {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float t = uTime * 1.6;
          float g = sin(wp.x * 0.35 + t) * 0.6 + sin(wp.z * 0.27 + t * 1.3) * 0.4;
          transformed.x += (sin(t * 2.1 + wp.x * 1.7 + wp.z) * 0.035 + g * 0.05) * wave * uWind;
          transformed.z += (cos(t * 1.7 + wp.z * 1.3 + wp.x) * 0.035 + g * 0.035) * wave * uWind;
          transformed.y += sin(t * 2.4 + wp.x + wp.z) * 0.012 * wave * uWind;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uBlocks; varying float vLayer; varying float vEmit; varying vec2 vTileUv;`)
      .replace('#include <map_fragment>', `vec4 texel = texture(uBlocks, vec3(vTileUv, vLayer + 0.25)); diffuseColor *= texel;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += texel.rgb * texel.rgb * vEmit * 2.2;`);
  };
  m.customProgramCacheKey = () => `block-${cutout}`;
  return m;
}

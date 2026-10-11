// The Overworld: an island continent with snowy peaks, a cherry grove, birch and oak forests,
// flower meadows and beaches, under a golden-hour sun with layered clouds.
import * as THREE from 'three';
import { fbm2, noise2, rng, smooth, clamp01 } from './noise.js';
import { Voxels, B } from './voxels.js';
import { skyDome, cloudDeck, particles } from './sky.js';

export const SEA = 22;

export function generateOverworld(size = 200) {
  const H = 84;
  const vox = new Voxels(size, H, size);
  const half = size / 2;
  const r = rng(1337);
  const height = new Map();
  const heightAt = (x, z) => {
    const k = `${x},${z}`;
    if (height.has(k)) return height.get(k);
    const d = Math.hypot(x / half, z / half);
    const island = smooth(clamp01((1.02 - d) / 0.35));
    const plains = fbm2(x * 0.011, z * 0.011, 3) * 16;
    const hills = Math.pow(fbm2(x * 0.024, z * 0.024, 9), 2) * 14;
    const ridge = 1 - Math.abs(fbm2(x * 0.014, z * 0.014, 21) * 2 - 1);
    const north = smooth(clamp01((-z - 10) / 60)) * smooth(clamp01((half - Math.abs(x)) / 40));
    const mountains = north * Math.pow(ridge, 2.2) * 46;
    const h = Math.floor(14 + (plains + hills + mountains + 8) * island - (1 - island) * 6);
    height.set(k, h);
    return h;
  };

  // Terrain columns. Only the top few blocks are filled: nothing below is ever visible.
  for (let x = vox.ox; x < vox.ox + size; x++) for (let z = vox.oz; z < vox.oz + size; z++) {
    const h = heightAt(x, z);
    const lo = Math.min(h, heightAt(x + 1, z), heightAt(x - 1, z), heightAt(x, z + 1), heightAt(x, z - 1));
    const beach = h <= SEA + 1;
    const underwater = h < SEA;
    const rocky = h >= 44 + noise2(x * 0.2, z * 0.2, 5) * 4;
    const snowy = h >= 54 + noise2(x * 0.15, z * 0.15, 6) * 5;
    for (let y = Math.max(0, lo - 3); y <= h; y++) {
      let b = B.stone;
      const depth = h - y;
      if (snowy) b = depth === 0 ? B.snow : B.stone;
      else if (rocky) b = noise2(x * 0.3, y * 0.3 + z * 0.3, 8) > 0.55 ? B.andesite : B.stone;
      else if (underwater) b = depth < 3 ? (noise2(x * 0.1, z * 0.1, 2) > 0.6 ? B.gravel : B.sand) : B.stone;
      else if (beach) b = depth < 4 ? B.sand : B.stone;
      else b = depth === 0 ? B.grass : depth < 4 ? B.dirt : B.stone;
      vox.set(x, y, z, b);
    }
  }

  // Biomes by low-frequency noise: cherry grove on the hills, birch woods, oak forest, meadows.
  const biome = (x, z) => {
    const v = fbm2(x * 0.009, z * 0.009, 77);
    const h = heightAt(x, z);
    if (v > 0.58 && h > 30 && h < 46) return 'cherry';
    if (v < 0.36) return 'birch';
    if (fbm2(x * 0.02, z * 0.02, 55) > 0.55) return 'meadow';
    return 'oak';
  };
  const flat = (x, z, h) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => Math.abs(heightAt(x + a, z + b) - h) <= 1);

  for (let x = vox.ox + 4; x < vox.ox + size - 4; x++) for (let z = vox.oz + 4; z < vox.oz + size - 4; z++) {
    const h = heightAt(x, z);
    if (vox.get(x, h, z) !== B.grass) continue;
    const bi = biome(x, z);
    const roll = r();
    const density = bi === 'meadow' ? 0.004 : bi === 'cherry' ? 0.02 : 0.03;
    if (roll < density && flat(x, z, h)) {
      if (bi === 'cherry') cherryTree(vox, x, h + 1, z, r);
      else if (bi === 'birch' || (bi === 'oak' && r() < 0.25)) birchTree(vox, x, h + 1, z, r);
      else oakTree(vox, x, h + 1, z, r);
      continue;
    }
    // Ground cover.
    const p = r();
    if (bi === 'cherry' && p < 0.35) vox.setIfAir(x, h + 1, z, B.pink_petals);
    else if (bi === 'meadow' && p < 0.12) vox.setIfAir(x, h + 1, z, [B.poppy, B.dandelion, B.cornflower][Math.floor(r() * 3)]);
    else if (p < (bi === 'meadow' ? 0.5 : 0.28)) vox.setIfAir(x, h + 1, z, B.tall_grass);
    else if (p < 0.31) vox.setIfAir(x, h + 1, z, [B.poppy, B.dandelion][Math.floor(r() * 2)]);
  }
  return { vox, heightAt };
}

function blob(vox, cx, cy, cz, rx, ry, rz, b, r, rough = 0.25) {
  for (let x = -rx; x <= rx; x++) for (let y = -ry; y <= ry; y++) for (let z = -rz; z <= rz; z++) {
    const d = (x * x) / (rx * rx + 0.01) + (y * y) / (ry * ry + 0.01) + (z * z) / (rz * rz + 0.01);
    if (d <= 1 - r() * rough) vox.setIfAir(cx + x, cy + y, cz + z, b);
  }
}

function oakTree(vox, x, y, z, r) {
  const big = r() < 0.18;
  const h = big ? 7 + Math.floor(r() * 3) : 4 + Math.floor(r() * 3);
  for (let i = 0; i < h; i++) vox.set(x, y + i, z, B.oak_log);
  blob(vox, x, y + h - 1, z, big ? 4 : 2, big ? 3 : 2, big ? 4 : 2, B.oak_leaves, r);
  if (big) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r() < 0.6) { vox.set(x + dx, y + h - 3, z + dz, B.oak_log); blob(vox, x + dx * 3, y + h - 2, z + dz * 3, 2, 2, 2, B.oak_leaves, r); }
}

function birchTree(vox, x, y, z, r) {
  const h = 6 + Math.floor(r() * 3);
  for (let i = 0; i < h; i++) vox.set(x, y + i, z, B.birch_log);
  blob(vox, x, y + h - 1, z, 2, 3, 2, B.birch_leaves, r, 0.35);
}

// Cherry trees: a short trunk splitting into angled branches under wide, flat pink canopies.
function cherryTree(vox, x, y, z, r) {
  const trunk = 3 + Math.floor(r() * 2);
  for (let i = 0; i < trunk; i++) vox.set(x, y + i, z, B.cherry_log);
  const arms = 2 + Math.floor(r() * 2);
  for (let a = 0; a < arms; a++) {
    const ang = (a / arms) * Math.PI * 2 + r();
    const dx = Math.cos(ang); const dz = Math.sin(ang);
    let px = x, py = y + trunk, pz = z;
    const len = 3 + Math.floor(r() * 3);
    for (let i = 0; i < len; i++) { px = Math.round(x + dx * (i + 1)); pz = Math.round(z + dz * (i + 1)); py += i % 2 === 0 ? 1 : 0; vox.set(px, py, pz, B.cherry_log); }
    blob(vox, px, py + 1, pz, 4, 2, 4, B.cherry_leaves, r, 0.3);
  }
}

export function overworldScene() {
  const sunDir = new THREE.Vector3(-0.62, 0.2, -0.76).normalize();
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xf0b88c);
  scene.add(skyDome({ zenith: 0x1f4fb0, horizon: 0xffc08a, ground: 0x4a5f7a, sunDir, sunColor: 0xffd9a8, glow: 1.2 }));

  const hemi = new THREE.HemisphereLight(0xc4dcff, 0x6a5638, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd2a0, 3.4);
  sun.position.copy(sunDir).multiplyScalar(260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 20, far: 600 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const clouds = cloudDeck({ y: 140, sunDir, lit: 0xfff1de, shade: 0xb79a9a, coverage: 0.5, fogColor });
  scene.add(clouds.group);
  const petals = particles({ count: 900, area: 200, yMin: 24, yMax: 60, color: 0xffc2da, size: 0.5, fall: 0.8, swirl: 2, opacity: 0.85, additive: false, seed: 3 });
  const motes = particles({ count: 1400, area: 220, yMin: 20, yMax: 70, color: 0xfff1b8, size: 0.28, rise: 0.15, opacity: 0.7, seed: 9 });
  scene.add(petals.points, motes.points);

  return {
    scene, sunDir, sun, hemi, fogColor,
    sea: SEA,
    water: { color: 0x0e5583, deep: 0x0b2a4a, level: SEA + 0.88 },
    atmo: { fogColor, sunColor: new THREE.Color(0xffc890), density: 0.0017, heightFalloff: 0.06, fogBase: SEA, rays: 1, smoke: 0, nether: 0 },
    bloom: { strength: 0.55, radius: 0.7, threshold: 0.92 },
    exposure: 0.92,
    orbit: { center: new THREE.Vector3(0, 30, 0), speed: 0.028, shots: [
      { r: 112, h: 46, look: 36 }, { r: 84, h: 40, look: 34 }, { r: 98, h: 50, look: 40 }, { r: 126, h: 58, look: 38 },
      { r: 76, h: 37, look: 33 }, { r: 104, h: 52, look: 44 }, { r: 170, h: 96, look: 24 },
    ] },
    update(t) { clouds.uniforms.uTime.value = t; petals.uniforms.uTime.value = t; motes.uniforms.uTime.value = t; },
  };
}

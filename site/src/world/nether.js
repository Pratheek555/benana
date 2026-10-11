// The Nether: crimson and warped forests, basalt deltas and nether wastes around a lava sea,
// closed in by cliffs and a glowstone-studded ceiling, filled with drifting smoke and embers.
import * as THREE from 'three';
import { fbm2, noise2, rng, smooth, clamp01 } from './noise.js';
import { Voxels, B } from './voxels.js';
import { skyDome, particles } from './sky.js';

export const LAVA = 20;

export function generateNether(size = 200) {
  const H = 90;
  const vox = new Voxels(size, H, size);
  const half = size / 2;
  const r = rng(666);
  const floorAt = (x, z) => {
    const d = Math.hypot(x / half, z / half);
    const wall = smooth(clamp01((d - 0.78) / 0.2));
    const base = fbm2(x * 0.016, z * 0.016, 4) * 26 + 8;
    const terr = Math.floor(base / 3) * 3 + Math.floor(noise2(x * 0.2, z * 0.2, 2) * 2); // terraced cliffs
    return Math.floor(terr * (1 - wall) + wall * 82);
  };
  const ceilAt = (x, z) => Math.floor(70 + fbm2(x * 0.03, z * 0.03, 7) * 10);
  const biome = (x, z) => {
    const a = fbm2(x * 0.01, z * 0.01, 31); const b = fbm2(x * 0.01, z * 0.01, 47);
    if (a > 0.56) return 'crimson';
    if (b > 0.57) return 'warped';
    if (a < 0.4 && b < 0.42) return 'basalt';
    return 'wastes';
  };

  for (let x = vox.ox; x < vox.ox + size; x++) for (let z = vox.oz; z < vox.oz + size; z++) {
    const h = floorAt(x, z);
    const lo = Math.min(h, floorAt(x + 1, z), floorAt(x - 1, z), floorAt(x, z + 1), floorAt(x, z - 1));
    const bi = biome(x, z);
    for (let y = Math.max(0, lo - 3); y <= Math.min(h, H - 1); y++) {
      let b = B.netherrack;
      const top = y === h;
      if (bi === 'crimson' && top && h > LAVA) b = B.crimson_nylium;
      else if (bi === 'warped' && top && h > LAVA) b = B.warped_nylium;
      else if (bi === 'basalt') b = noise2(x * 0.25, z * 0.25 + y * 0.1, 3) > 0.55 ? B.blackstone : B.basalt;
      else if (top && h <= LAVA + 1 && r() < 0.25) b = B.magma;
      else if (bi === 'wastes' && top && noise2(x * 0.08, z * 0.08, 12) > 0.72) b = B.soul_sand;
      vox.set(x, y, z, b);
    }
    // Ceiling: a shell with holes, glowstone hanging from its underside.
    const c = ceilAt(x, z);
    if (h < c - 6 && noise2(x * 0.05, z * 0.05, 19) > 0.3) {
      for (let y = c; y < Math.min(H, c + 3); y++) vox.set(x, y, z, B.netherrack);
      if (noise2(x * 0.18, z * 0.18, 23) > 0.74) for (let y = c - 1 - Math.floor(r() * 5); y < c; y++) vox.set(x, y, z, r() < 0.85 ? B.glowstone : B.netherrack);
    }
  }

  // Decoration.
  for (let x = vox.ox + 3; x < vox.ox + size - 3; x++) for (let z = vox.oz + 3; z < vox.oz + size - 3; z++) {
    const h = floorAt(x, z);
    if (h <= LAVA || h > 60) continue;
    const bi = biome(x, z);
    const roll = r();
    if ((bi === 'crimson' || bi === 'warped') && roll < 0.028) { fungus(vox, x, h + 1, z, r, bi === 'crimson'); continue; }
    if (bi === 'basalt' && roll < 0.02) { const t = 4 + Math.floor(r() * 12); for (let i = 1; i <= t; i++) vox.set(x, h + i, z, B.basalt); continue; }
    if (bi === 'crimson' && roll < 0.3) vox.setIfAir(x, h + 1, z, B.crimson_roots);
    else if (bi === 'warped' && roll < 0.3) vox.setIfAir(x, h + 1, z, B.warped_roots);
    else if (bi === 'wastes' && roll < 0.004) for (let i = 1; i <= 2; i++) vox.set(x, h + i, z, B.glowstone);
  }
  return { vox, floorAt };
}

// Huge fungus: a stem, a wart-block dome with shroomlights tucked under its rim.
function fungus(vox, x, y, z, r, crimson) {
  const stem = crimson ? B.crimson_stem : B.warped_stem;
  const wart = crimson ? B.nether_wart_block : B.warped_wart_block;
  const h = 6 + Math.floor(r() * 7);
  const thick = h > 10;
  for (let i = 0; i < h; i++) {
    vox.set(x, y + i, z, stem);
    if (thick) { vox.set(x + 1, y + i, z, stem); vox.set(x, y + i, z + 1, stem); vox.set(x + 1, y + i, z + 1, stem); }
  }
  const rad = thick ? 4 : 3;
  const top = y + h;
  for (let dy = -3; dy <= 1; dy++) for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
    const ring = Math.hypot(dx, dz);
    const lim = dy === 1 ? rad - 1.5 : rad + 0.2;
    if (ring > lim) continue;
    if (dy < 0 && ring < rad - 1.2) continue; // hollow underside
    const b = dy < 0 && r() < 0.06 ? B.shroomlight : wart;
    if (dy === -3 && r() < 0.5) continue;
    vox.setIfAir(x + dx, top + dy, z + dz, b);
  }
}

export function netherScene() {
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0x2a0705);
  scene.add(skyDome({ zenith: 0x1a0303, horizon: 0x5c1408, ground: 0x2a0504, sunDir: null, glow: 0 }));
  const hemi = new THREE.HemisphereLight(0xff8a64, 0x3a0a05, 1.25);
  scene.add(hemi);
  // A dim overhead "light" gives the terrain form and soft shadows; lava and glowstone do the rest.
  const glow = new THREE.DirectionalLight(0xffb48a, 1.5);
  glow.position.set(40, 200, 60);
  glow.castShadow = true;
  glow.shadow.mapSize.set(4096, 4096);
  Object.assign(glow.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 20, far: 400 });
  glow.shadow.bias = -0.0005; glow.shadow.normalBias = 0.05; glow.shadow.radius = 4;
  scene.add(glow, glow.target);
  const lavaLight = new THREE.HemisphereLight(0x000000, 0xff5a1a, 0.45); // bounce from the lava sea below
  scene.add(lavaLight);

  const embers = particles({ count: 1600, area: 190, yMin: LAVA, yMax: 72, color: 0xff8a2a, size: 0.3, rise: 1.6, swirl: 1.5, opacity: 1, seed: 5 });
  const ash = particles({ count: 1800, area: 190, yMin: LAVA, yMax: 72, color: 0x8a7a78, size: 0.3, fall: 0.5, swirl: 3, opacity: 0.5, additive: false, seed: 7 });
  const spores = particles({ count: 1200, area: 190, yMin: LAVA + 4, yMax: 64, color: 0xff3a4a, size: 0.32, rise: 0.25, swirl: 4, opacity: 0.9, seed: 11 });
  const wspores = particles({ count: 900, area: 190, yMin: LAVA + 4, yMax: 64, color: 0x3affd8, size: 0.32, rise: 0.2, swirl: 4, opacity: 0.8, seed: 13 });
  scene.add(embers.points, ash.points, spores.points, wspores.points);

  return {
    scene, sunDir: null, sun: glow, hemi, fogColor,
    lava: { level: LAVA + 0.85 },
    atmo: { fogColor, sunColor: new THREE.Color(0xc2401a), density: 0.0062, heightFalloff: 0.022, fogBase: LAVA, rays: 0, smoke: 1, nether: 1 },
    bloom: { strength: 0.6, radius: 0.75, threshold: 0.9 },
    exposure: 0.85,
    orbit: { center: new THREE.Vector3(0, 34, 0), speed: 0.03, shots: [
      { r: 74, h: 48, look: 30 }, { r: 58, h: 40, look: 32 }, { r: 66, h: 52, look: 28 }, { r: 80, h: 56, look: 36 },
      { r: 52, h: 38, look: 30 }, { r: 70, h: 46, look: 40 }, { r: 84, h: 58, look: 26 },
    ] },
    update(t) { for (const p of [embers, ash, spores, wspores]) p.uniforms.uTime.value = t; },
  };
}

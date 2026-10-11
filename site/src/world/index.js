// Builds and runs the background world. theme 'light' → Overworld, 'dark' → Nether.
// The camera orbits continuously; scrolling only changes the orbit's radius and height.
import * as THREE from 'three';
import { buildTextureArray, loadPack, lavaTexture, waterNormal } from './textures.js';
import { mesh, geometryFrom, blockMaterial, BLOCKS, Voxels } from './voxels.js';
import { generateOverworld, overworldScene } from './overworld.js';
import { generateNether, netherScene } from './nether.js';
import { createPost } from './post.js';

function environment(renderer, scene) {
  // Image-based lighting from the sky only (cheap, and gives water its reflections).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyOnly = new THREE.Scene();
  skyOnly.add(scene.children[0].clone());
  const env = pmrem.fromScene(skyOnly, 0.02).texture;
  pmrem.dispose();
  return env;
}

function waterMesh(level, color, env) {
  const normal = waterNormal();
  normal.repeat.set(220, 220);
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.94, envMap: env, envMapIntensity: 0.6,
    normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.08, ior: 1.33,
  });
  const w = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), m);
  w.rotation.x = -Math.PI / 2;
  w.position.y = level;
  w.receiveShadow = true;
  return { mesh: w, update: (t) => { normal.offset.set(t * 0.004, t * 0.0025); } };
}

function lavaMesh(level) {
  const tex = lavaTexture();
  tex.repeat.set(160, 160);
  const m = new THREE.MeshStandardMaterial({ color: 0x220400, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.25, roughness: 0.6 });
  const l = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), m);
  l.rotation.x = -Math.PI / 2;
  l.position.y = level;
  return { mesh: l, update: (t) => { tex.offset.set(t * 0.0016, Math.sin(t * 0.1) * 0.003); m.emissiveIntensity = 1.2 + Math.sin(t * 0.8) * 0.12; } };
}

export function createWorld(canvas, { theme = 'light', reducedMotion = false, preview = false, onPack, onReady } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const nether = theme === 'dark';
  const SIZE = 200;
  const env = nether ? netherScene() : overworldScene();
  const { scene } = env;
  renderer.toneMappingExposure = env.exposure;

  const tex = buildTextureArray();
  const uniforms = { uTime: { value: 0 }, uWind: { value: reducedMotion ? 0 : 1 }, uBlocks: { value: tex } };
  const solidMat = blockMaterial({ uniforms });
  const cutoutMat = blockMaterial({ cutout: true, uniforms });
  const envMap = environment(renderer, scene);
  solidMat.envMap = envMap; cutoutMat.envMap = envMap;

  // Terrain is built in a worker; sky, water and lighting render meanwhile.
  let vox = null;
  let disposed = false;
  const attach = (m, v) => {
    if (disposed) return;
    vox = v;
    for (const [arrays, mat] of [[m.solid, solidMat], [m.cutout, cutoutMat]]) {
      const obj = new THREE.Mesh(geometryFrom(arrays), mat);
      obj.castShadow = true; obj.receiveShadow = true;
      scene.add(obj);
    }
    onReady?.();
  };
  const buildHere = () => {
    const w = nether ? generateNether(SIZE) : generateOverworld(SIZE);
    attach(mesh(w.vox), w.vox);
  };
  let worker = null;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const v = Object.assign(Object.create(Voxels.prototype), data.vox);
      attach(data.mesh, v);
      worker.terminate(); worker = null;
    };
    worker.onerror = () => { worker?.terminate(); worker = null; setTimeout(buildHere, 0); };
    worker.postMessage({ theme, size: SIZE });
  } catch { setTimeout(buildHere, 0); }
  const liquid = nether ? lavaMesh(env.lava.level) : waterMesh(env.water.level, env.water.color, envMap);
  scene.add(liquid.mesh);
  if (preview) env.sun.shadow.mapSize.set(1024, 1024);

  // A resource pack in /textures/block/ replaces the built-in tiles once it has loaded.
  loadPack().then((pack) => {
    if (!pack || disposed) { pack?.texture.dispose(); return; }
    uniforms.uBlocks.value = pack.texture;
    onPack?.(pack);
  }).catch(() => {});

  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 5000);
  const post = createPost(renderer, scene, camera, env);

  // Orbit state, eased toward the active shot.
  const o = env.orbit;
  const cur = { ...o.shots[0] };
  let shot = 0;
  let angle = nether ? 0.6 : 0.9; // overworld: camera opposite the sun, so it looks into the light

  let pixelRatio = 1;
  let quality = 0;
  function resize() {
    const w = window.innerWidth; const h = window.innerHeight;
    const native = window.devicePixelRatio || 1;
    const small = Math.min(w, h) < 700 || matchMedia('(pointer: coarse)').matches;
    const wanted = small ? Math.min(native, 2) : Math.max(native, 2560 / w, 1440 / h);
    pixelRatio = preview ? 0.5 : Math.min(wanted, 2.5, 4096 / Math.max(w, h)) * (quality >= 3 ? 0.75 : 1);
    if (quality >= 1) pixelRatio = Math.min(pixelRatio, native);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pixelRatio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Adaptive quality: step down (resolution → ray samples/shadow size → below native → no bloom)
  // whenever frames stay slow, so the page's own animations never stutter.
  function degrade() {
    if (quality >= 4) return;
    quality++;
    if (quality === 2) { env.sun.shadow.mapSize.set(2048, 2048); env.sun.shadow.map?.dispose(); env.sun.shadow.map = null; }
    post.setQuality(quality);
    resize();
  }

  // Highest non-plant block at or below `y + 8` around (x, z), scanning a 5×5 footprint.
  function groundBelow(x, z, y) {
    let best = 0;
    if (!vox) return best;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const bx = Math.floor(x) + dx; const bz = Math.floor(z) + dz;
      for (let yy = Math.min(vox.sy - 1, Math.floor(y) + 8); yy > best; yy--) {
        const id = vox.get(bx, yy, bz);
        if (id && BLOCKS[id].kind !== 'plant') { best = yy + 1; break; }
      }
    }
    return best;
  }
  let lift = o.shots[0].h;

  const clock = new THREE.Clock();
  let slow = 0;
  let raf = 0;
  let frames = 0;
  const target = new THREE.Vector3();
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    frames++;
    if (!preview && frames > 30) { if (dt > 1 / 40) slow++; else slow = Math.max(0, slow - 2); if (slow > 50) { degrade(); slow = 0; } }

    const s = o.shots[Math.min(shot, o.shots.length - 1)];
    const k = reducedMotion || preview ? 1 : 1 - Math.pow(0.02, dt);
    cur.r += (s.r - cur.r) * k * 0.5; cur.h += (s.h - cur.h) * k * 0.5; cur.look += (s.look - cur.look) * k * 0.5;
    if (!reducedMotion) angle += dt * o.speed * (preview ? 0 : 1);
    const cx = o.center.x + Math.cos(angle) * cur.r; const cz = o.center.z + Math.sin(angle) * cur.r;
    // Keep clear of terrain and tree canopies: never closer than 4 blocks to what's below.
    const want = Math.max(cur.h, groundBelow(cx, cz, cur.h) + 4);
    lift += (want - lift) * (preview ? 1 : 1 - Math.pow(0.05, dt));
    camera.position.set(cx, lift + Math.sin(t * 0.23) * 1.2, cz);
    target.set(o.center.x, cur.look, o.center.z);
    camera.lookAt(target);

    uniforms.uTime.value = t;
    env.update(t);
    liquid.update(t);
    post.render(t);
  }
  frame();

  return {
    setShot(i) { shot = i; },
    get pixelRatio() { return pixelRatio; },
    get quality() { return quality; },
    dispose() {
      disposed = true;
      worker?.terminate();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scene.traverse((obj) => {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        for (const m of mats) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
      });
      solidMat.dispose(); cutoutMat.dispose(); tex.dispose(); if (uniforms.uBlocks.value !== tex) uniforms.uBlocks.value.dispose(); envMap.dispose(); post.dispose(); renderer.dispose();
    },
  };
}

// A procedural, Minecraft-style voxel world rendered with three.js.
// Every texture is generated here (16×16 pixel art, no game assets), sampled with nearest
// filtering so blocks stay razor sharp at any resolution.
import * as THREE from 'three';

// ---------- deterministic noise ----------
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (x, z, s = 0) => {
  let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const smooth = (t) => t * t * (3 - 2 * t);
function valueNoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = smooth(x - xi), zf = smooth(z - zi);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}
function fbm(x, z, s, oct = 5) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += amp * valueNoise(x * f, z * f, s + i * 17); norm += amp; amp *= 0.5; f *= 2; }
  return v / norm;
}

// ---------- pixel-art textures ----------
function pixelTexture(draw, size = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
function speckle(palette, seed, { alphaHoles = 0 } = {}) {
  const rnd = mulberry32(seed);
  return (g, n) => {
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const [r, gg, b] = hex(palette[Math.floor(rnd() * palette.length)]);
      img.data.set([r, gg, b, alphaHoles && rnd() < alphaHoles ? 0 : 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  };
}

const PAL = {
  grass: [0x5f9e3a, 0x6aa842, 0x578f35, 0x73b44b, 0x4f8530],
  dirt: [0x8a5a3b, 0x7a4f33, 0x966645, 0x6e4529, 0x9c6b48],
  stone: [0x8a8a8a, 0x7d7d7d, 0x969696, 0x737373, 0xa0a0a0],
  sand: [0xdcd09a, 0xd4c78e, 0xe3d8a6, 0xcbbd82],
  snow: [0xf4f8fb, 0xe9eef3, 0xffffff, 0xdfe7ee],
  leaves: [0x3f7d2a, 0x4a8c31, 0x356b23, 0x5a9b3c],
  logSide: [0x6b4a2b, 0x5c3f24, 0x7a5532, 0x4e351e],
  logTop: [0xa98454, 0x9a7748, 0xb8935f],
  water: [0x2f6fd0, 0x3a7be0, 0x2a63bf, 0x4688ea],
};

function grassSide(seed) {
  const dirt = speckle(PAL.dirt, seed);
  const rnd = mulberry32(seed + 9);
  return (g, n) => {
    dirt(g, n);
    for (let x = 0; x < n; x++) {
      const depth = 3 + Math.floor(rnd() * 3);
      for (let y = 0; y < depth; y++) {
        const [r, gg, b] = hex(PAL.grass[Math.floor(rnd() * PAL.grass.length)]);
        g.fillStyle = `rgb(${r},${gg},${b})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  };
}
function logTop(g, n) {
  speckle(PAL.logTop, 77)(g, n);
  g.strokeStyle = 'rgba(90,62,34,0.9)';
  g.lineWidth = 1;
  for (const r of [2, 4, 6]) g.strokeRect(8 - r + 0.5, 8 - r + 0.5, r * 2 - 1, r * 2 - 1);
  g.fillStyle = '#5c3f24';
  g.fillRect(0, 0, n, 1); g.fillRect(0, n - 1, n, 1); g.fillRect(0, 0, 1, n); g.fillRect(n - 1, 0, 1, n);
}

function mat(tex, opts = {}) {
  return new THREE.MeshLambertMaterial({ map: tex, ...opts });
}

// ---------- world ----------
export function createWorld(canvas, { reducedMotion = false, preview = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color(0xf2c9a0);
  scene.fog = new THREE.Fog(FOG, 80, 280);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);

  // Sky: vertical gradient dome, warm golden hour at the horizon.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x3a6fd8) }, mid: { value: new THREE.Color(0x9cc0f0) }, horizon: { value: FOG } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vP;
        void main(){ float h = clamp(vP.y, -0.2, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.22, 0.85, h));
          gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  scene.add(sky);

  // Sun: a square, Minecraft-style, with a soft halo.
  const sunDir = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();
  const sunTex = pixelTexture((g, n) => { g.fillStyle = '#fff6d6'; g.fillRect(2, 2, n - 4, n - 4); g.fillStyle = '#ffe59a'; g.fillRect(4, 4, n - 8, n - 8); });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshBasicMaterial({ map: sunTex, fog: false, transparent: true, depthWrite: false }));
  sun.position.copy(sunDir).multiplyScalar(420);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
  const haloTex = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,230,170,0.85)'); gr.addColorStop(0.35, 'rgba(255,200,140,0.25)'); gr.addColorStop(1, 'rgba(255,190,130,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return c; })());
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
  halo.scale.set(260, 260, 1);
  halo.position.copy(sunDir).multiplyScalar(410);
  scene.add(halo);

  // Light
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b5a3a, 0.95));
  const sunLight = new THREE.DirectionalLight(0xffe2b8, 2.3);
  sunLight.position.copy(sunDir).multiplyScalar(140);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(preview ? 1024 : 4096, preview ? 1024 : 4096);
  const sc = sunLight.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 400;
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.04;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Materials
  const T = {
    grassTop: pixelTexture(speckle(PAL.grass, 1)),
    grassSide: pixelTexture(grassSide(2)),
    dirt: pixelTexture(speckle(PAL.dirt, 3)),
    stone: pixelTexture(speckle(PAL.stone, 4)),
    sand: pixelTexture(speckle(PAL.sand, 5)),
    snow: pixelTexture(speckle(PAL.snow, 6)),
    leaves: pixelTexture(speckle(PAL.leaves, 7, { alphaHoles: 0.14 })),
    logSide: pixelTexture((g, n) => { speckle(PAL.logSide, 8)(g, n); g.fillStyle = 'rgba(40,26,14,0.35)'; for (let x = 1; x < n; x += 4) g.fillRect(x, 0, 1, n); }),
    logTop: pixelTexture(logTop),
  };
  const M = {
    grass: [mat(T.grassSide), mat(T.grassSide), mat(T.grassTop), mat(T.dirt), mat(T.grassSide), mat(T.grassSide)],
    dirt: mat(T.dirt),
    stone: mat(T.stone),
    sand: mat(T.sand),
    snow: [mat(T.stone), mat(T.stone), mat(T.snow), mat(T.stone), mat(T.stone), mat(T.stone)],
    log: [mat(T.logSide), mat(T.logSide), mat(T.logTop), mat(T.logTop), mat(T.logSide), mat(T.logSide)],
    leaves: mat(T.leaves, { alphaTest: 0.5, side: THREE.DoubleSide }),
  };

  // Terrain
  const SIZE = 132;
  const HALF = SIZE / 2;
  const SEA = 9;
  // Gentle hills in front, a lake in the middle, mountains along the back (toward the sun).
  const heightAt = (x, z) => {
    const hills = fbm(x * 0.03, z * 0.03, 11) * 11;
    const ridge = 1 - Math.abs(fbm(x * 0.018, z * 0.018, 29) * 2 - 1);
    const back = smooth(Math.min(1, Math.max(0, (-z - 8) / 50)));
    const lake = Math.max(0, 1 - Math.hypot(x - 6, z - 8) / 22);
    return Math.floor(7 + hills + back * (6 + Math.pow(ridge, 2) * 30) - smooth(lake) * 9);
  };
  const H = new Map();
  for (let x = -HALF; x < HALF; x++) for (let z = -HALF; z < HALF; z++) H.set(`${x},${z}`, heightAt(x, z));
  const h = (x, z) => H.get(`${x},${z}`) ?? heightAt(x, z);

  const blocks = { grass: [], dirt: [], stone: [], sand: [], snow: [], log: [], leaves: [] };
  const rnd = mulberry32(42);
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      const y = h(x, z);
      const minN = Math.min(h(x + 1, z), h(x - 1, z), h(x, z + 1), h(x, z - 1), y);
      const beach = y <= SEA + 1;
      const top = y >= 36 ? 'snow' : beach ? 'sand' : y >= 29 ? 'stone' : 'grass';
      blocks[top].push([x, y, z]);
      for (let yy = y - 1; yy >= Math.max(minN, y - 7); yy--) blocks[y - yy <= 3 && !beach && top !== 'stone' && top !== 'snow' ? 'dirt' : beach ? 'sand' : 'stone'].push([x, yy, z]);
      // Trees on gentle grass, away from the edge.
      if (top === 'grass' && rnd() < 0.018 && Math.abs(x) < HALF - 4 && Math.abs(z) < HALF - 4 && Math.max(Math.abs(h(x + 1, z) - y), Math.abs(h(x, z + 1) - y)) <= 1) {
        const th = 4 + Math.floor(rnd() * 3);
        for (let i = 1; i <= th; i++) blocks.log.push([x, y + i, z]);
        for (let ly = th - 1; ly <= th + 2; ly++) {
          const r = ly >= th + 1 ? 1 : 2;
          for (let lx = -r; lx <= r; lx++) for (let lz = -r; lz <= r; lz++) {
            if ((Math.abs(lx) === r && Math.abs(lz) === r && rnd() < 0.6) || (lx === 0 && lz === 0 && ly < th + 1)) continue;
            blocks.leaves.push([x + lx, y + ly, z + lz]);
          }
        }
      }
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const tmp = new THREE.Object3D();
  for (const [kind, list] of Object.entries(blocks)) {
    const mesh = new THREE.InstancedMesh(box, M[kind], list.length);
    list.forEach(([x, y, z], i) => { tmp.position.set(x + 0.5, y + 0.5, z + 0.5); tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix); });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Water: animated pixel texture on one plane at sea level.
  const waterTex = pixelTexture(speckle(PAL.water, 12), 32);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(4000, 4000); // 2 blocks per texture tile across a sea that reaches the horizon
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.82, color: 0xbad6ff }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA + 0.85;
  water.receiveShadow = true;
  scene.add(water);

  // Clouds: blocky, flat, drifting.
  const cloudGeo = new THREE.BoxGeometry(9, 3, 9);
  const cloudCells = [];
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) if (fbm(x * 0.09, z * 0.09, 91, 3) > 0.62) cloudCells.push([x, z]);
  const clouds = new THREE.InstancedMesh(cloudGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, emissive: 0xfff3e6, emissiveIntensity: 0.55, fog: false }), cloudCells.length);
  cloudCells.forEach(([x, z], i) => { tmp.position.set(x * 9, 150, z * 9); tmp.updateMatrix(); clouds.setMatrixAt(i, tmp.matrix); });
  scene.add(clouds);

  // Pollen: tiny glowing motes catching the light.
  const MOTES = 900;
  const moteGeo = new THREE.BufferGeometry();
  const mp = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) { mp[i * 3] = (rnd() - 0.5) * 120; mp[i * 3 + 1] = 10 + rnd() * 30; mp[i * 3 + 2] = (rnd() - 0.5) * 120; }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xfff1b8, size: 0.18, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(motes);

  // Camera shots, one per text section. Scroll picks the shot; we glide between them.
  const SHOTS = [
    { pos: [0, 36, 98], look: [0, 16, -24] },   // establishing: lake, hills, mountains against the sun
    { pos: [34, 24, 44], look: [4, 13, 2] },
    { pos: [-44, 27, 34], look: [2, 13, -8] },
    { pos: [-48, 44, -6], look: [12, 24, -44] },
    { pos: [22, 30, 46], look: [-4, 10, 0] },
    { pos: [52, 32, -2], look: [-12, 20, -34] },
    { pos: [0, 82, 118], look: [0, 8, -12] },
  ];
  const cur = { pos: new THREE.Vector3(...SHOTS[0].pos), look: new THREE.Vector3(...SHOTS[0].look) };
  let target = 0;

  // Resolution: render at least ~2.5K internally (supersampled on 1080p screens), cap for perf.
  let pixelRatio = 1;
  function resize() {
    const w = window.innerWidth, hgt = window.innerHeight;
    const wanted = Math.max(window.devicePixelRatio || 1, 2560 / w, 1440 / hgt);
    pixelRatio = preview ? 0.5 : Math.min(wanted, 3, 4096 / Math.max(w, hgt));
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    renderer.capabilities && (Object.values(T).forEach((t) => { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; }));
  }
  window.addEventListener('resize', resize);
  resize();

  // Adaptive quality. Renders at least ~2.5K by default; if frames get slow it steps down in
  // tiers (resolution to the screen's native density, then shadows off, then below native),
  // so a weak GPU never starves the page's text animations.
  let slow = 0;
  let tier = 0;
  const clock = new THREE.Clock();
  let raf = 0;
  const native = () => window.devicePixelRatio || 1;
  function degrade() {
    if (pixelRatio > native()) pixelRatio = Math.max(native(), pixelRatio - 0.5);
    else if (sunLight.castShadow) sunLight.castShadow = false;
    else if (pixelRatio > 0.75) pixelRatio = Math.max(0.75, pixelRatio - 0.25);
    else return;
    tier++;
    renderer.setPixelRatio(pixelRatio);
  }
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    if (!preview) {
      if (dt > 1 / 42) slow++; else slow = Math.max(0, slow - 1);
      if (slow > 40) { degrade(); slow = 0; }
    }

    const shot = SHOTS[Math.min(target, SHOTS.length - 1)];
    const k = 1 - Math.pow(0.0025, dt); // frame-rate independent ease
    cur.pos.lerp(new THREE.Vector3(...shot.pos), reducedMotion || preview ? 1 : k * 0.9);
    cur.look.lerp(new THREE.Vector3(...shot.look), reducedMotion || preview ? 1 : k * 0.9);
    const sway = reducedMotion ? 0 : 1;
    camera.position.set(cur.pos.x + Math.sin(t * 0.13) * 3 * sway, cur.pos.y + Math.sin(t * 0.21) * 1.2 * sway, cur.pos.z + Math.cos(t * 0.11) * 3 * sway);
    camera.lookAt(cur.look);

    waterTex.offset.set(t * 0.012, t * 0.007);
    clouds.position.x = ((t * 2.2) % 360) - 180;
    motes.rotation.y = t * 0.01;
    motes.position.y = Math.sin(t * 0.3) * 0.6;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  frame();

  return {
    setShot(i) { target = i; },
    get pixelRatio() { return pixelRatio; },
    get tier() { return tier; },
    dispose() { cancelAnimationFrame(raf); renderer.dispose(); },
  };
}

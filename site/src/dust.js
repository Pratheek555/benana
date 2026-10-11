// Text that breaks into microscopic particles (and assembles from them) between scenes.
// Each scene's copy is rasterised from its real layout (per-glyph DOM ranges), sampled into
// points, and animated on the GPU: outgoing text shatters and drifts away as dust; incoming
// text condenses from dust onto its glyphs, then the crisp DOM text takes over.
import * as THREE from 'three';

const TEXT = '.wordmark, .headline, .kicker, .sub';
const MAX_POINTS = 70000;

const vertex = /* glsl */ `
  uniform float uT;          // 0..1 progress of this transition
  uniform float uMode;       // 1 = break apart, 0 = assemble
  uniform vec2 uView;        // viewport in CSS px
  uniform float uSize;       // particle size in device px when whole
  uniform float uTime;
  attribute vec2 aHome;      // glyph position in CSS px (y down)
  attribute vec4 aColor;
  attribute vec4 aRand;      // random 0..1
  varying vec4 vColor;
  varying float vFade;

  void main() {
    // Sweep left to right with jitter, so the copy crumbles from one end instead of all at once.
    float delay = clamp(aHome.x / uView.x, 0.0, 1.0) * 0.38 + aRand.w * 0.16;
    float k = clamp((uT - delay) / (1.0 - 0.54), 0.0, 1.0);
    float p = uMode > 0.5 ? k : 1.0 - k;           // p = how scattered (0 = on the glyph)
    float e = p * p * (3.0 - 2.0 * p);
    float far = e * e;

    float ang = aRand.x * 6.2831853;
    vec2 dir = vec2(cos(ang), sin(ang));
    float dist = mix(30.0, 360.0, aRand.y);
    vec2 wind = vec2(220.0 + aRand.z * 260.0, -120.0 - aRand.y * 200.0);
    vec2 swirl = vec2(sin(uTime * 1.7 + aRand.x * 40.0), cos(uTime * 1.3 + aRand.z * 40.0)) * 18.0 * e;
    vec2 pos = aHome + dir * dist * e + wind * far + swirl;

    vec2 ndc = vec2(pos.x / uView.x * 2.0 - 1.0, 1.0 - pos.y / uView.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = uSize * mix(1.0, 0.28 + aRand.z * 0.25, smoothstep(0.0, 0.6, p));
    vColor = aColor;
    vFade = 1.0 - smoothstep(0.45, 1.0, p);
  }
`;

const fragment = /* glsl */ `
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    if (r > 0.25) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * vFade * smoothstep(0.25, 0.12, r));
  }
`;

export function createDust({ reducedMotion = false } = {}) {
  if (reducedMotion) return null;
  let renderer;
  const canvas = document.createElement('canvas');
  canvas.className = 'dust';
  canvas.setAttribute('aria-hidden', 'true');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: false });
  } catch {
    return null;
  }
  document.body.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  const size = () => renderer.setSize(window.innerWidth, window.innerHeight, false);
  size();
  window.addEventListener('resize', size);

  const live = new Set();
  let raf = 0;
  const clock = new THREE.Clock();
  const loop = () => {
    const now = performance.now();
    const t = clock.getElapsedTime();
    for (const fx of live) {
      const k = Math.min(1, (now - fx.start) / fx.duration);
      fx.points.material.uniforms.uT.value = Math.max(0, k);
      fx.points.material.uniforms.uTime.value = t;
      fx.points.material.uniforms.uView.value.set(window.innerWidth, window.innerHeight);
      if (k >= 1) finish(fx);
    }
    renderer.render(scene, camera);
    raf = live.size ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function finish(fx) {
    if (!live.has(fx)) return;
    live.delete(fx);
    scene.remove(fx.points);
    fx.points.geometry.dispose();
    fx.points.material.dispose();
    fx.done?.();
  }

  // Rasterise a scene's copy exactly where the browser lays it out, then sample it into points.
  function sample(sceneEl) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * dpr);
    cv.height = Math.ceil(h * dpr);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.scale(dpr, dpr);
    ctx.textBaseline = 'alphabetic';
    const range = document.createRange();
    for (const block of sceneEl.querySelectorAll(TEXT)) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const style = getComputedStyle(node.parentElement);
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = ctx.measureText('Hg');
        const ascent = metrics.fontBoundingBoxAscent;
        const text = node.textContent;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (!ch.trim()) continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (!r.width) continue;
          if (block.classList.contains('wordmark')) {
            const g = ctx.createLinearGradient(0, r.top, 0, r.bottom);
            g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#fff8dc'); g.addColorStop(1, '#ffe36b');
            ctx.fillStyle = g;
          } else {
            ctx.fillStyle = style.color;
          }
          ctx.fillText(ch, r.left, r.top + ascent);
        }
      }
    }
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    // Choose a sampling step that keeps the point count under budget.
    let filled = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 100) filled++;
    filled *= 4;
    const step = Math.max(Math.round(dpr * 1.5), Math.ceil(Math.sqrt(filled / MAX_POINTS)));
    const home = [];
    const color = [];
    const rand = [];
    for (let y = 0; y < cv.height; y += step) {
      for (let x = 0; x < cv.width; x += step) {
        const i = (y * cv.width + x) * 4;
        const a = data[i + 3];
        if (a < 100) continue;
        home.push(x / dpr, y / dpr);
        color.push(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, a / 255);
        rand.push(Math.random(), Math.random(), Math.random(), Math.random());
      }
    }
    return { home, color, rand, pointSize: step * 1.15 };
  }

  function play(sceneEl, mode, { duration = 1250, delay = 0, done } = {}) {
    const s = sample(sceneEl);
    if (!s.home.length) { done?.(); return null; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aHome', new THREE.Float32BufferAttribute(s.home, 2));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(s.color, 4));
    geo.setAttribute('aRand', new THREE.Float32BufferAttribute(s.rand, 4));
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((s.home.length / 2) * 3), 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uT: { value: 0 }, uMode: { value: mode === 'break' ? 1 : 0 }, uTime: { value: 0 },
        uView: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }, uSize: { value: s.pointSize },
      },
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    const fx = { points, start: performance.now() + delay, duration, done };
    mat.uniforms.uT.value = 0;
    live.add(fx);
    kick();
    return fx;
  }

  return {
    breakApart: (el, opts) => play(el, 'break', opts),
    assemble: (el, opts) => play(el, 'assemble', opts),
    // Cut every running transition short (e.g. on fast scrolling); assembles finish instantly.
    flush: () => { for (const fx of [...live]) finish(fx); },
  };
}

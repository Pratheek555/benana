// Sky dome and layered volumetric-looking clouds, shared by both dimensions.
import * as THREE from 'three';

export function skyDome({ zenith, horizon, ground, sunDir, sunColor, sunSize = 0.9994, glow = 1, stars = 0 }) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(4000, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(zenith) }, horizon: { value: new THREE.Color(horizon) }, ground: { value: new THREE.Color(ground) },
        sunDir: { value: sunDir ? sunDir.clone() : new THREE.Vector3(0, -1, 0) }, sunColor: { value: new THREE.Color(sunColor || 0) },
        sunSize: { value: sunSize }, glow: { value: glow }, stars: { value: stars },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `
        uniform vec3 zenith, horizon, ground, sunDir, sunColor; uniform float sunSize, glow, stars; varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 c = mix(horizon, zenith, pow(smoothstep(-0.02, 0.55, y), 0.65));
          c = mix(c, ground, smoothstep(0.0, -0.25, y));
          float s = max(dot(d, sunDir), 0.0);
          // Mie forward-scatter halo + wide warm glow + a round sun disc (HDR, so it blooms).
          c += sunColor * (pow(s, 600.0) * 2.0 + pow(s, 48.0) * 0.28 + pow(s, 8.0) * 0.08) * glow;
          c += sunColor * smoothstep(sunSize, sunSize + 0.00025, s) * 22.0 * glow;
          if (stars > 0.0) { vec2 g = floor(d.xz / max(0.15, d.y + 0.2) * 300.0); float st = step(0.997, h21(g)); c += vec3(st) * stars * smoothstep(0.0, 0.3, y); }
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
}

// Several stacked translucent slices of the same 3D noise read as one volumetric cloud deck.
export function cloudDeck({ y = 150, slices = 6, gap = 3.2, sunDir, lit, shade, coverage = 0.5, scale = 0.0016, speed = 4, size = 5000, fogColor }) {
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 }, sunDir: { value: sunDir.clone() }, lit: { value: new THREE.Color(lit) }, shade: { value: new THREE.Color(shade) },
    coverage: { value: coverage }, scale: { value: scale }, speed: { value: speed }, fogColor: { value: new THREE.Color(fogColor) },
  };
  const geo = new THREE.PlaneGeometry(size, size);
  for (let i = 0; i < slices; i++) {
    const k = i / (slices - 1);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { ...uniforms, slice: { value: k } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform float uTime, coverage, scale, speed, slice; uniform vec3 sunDir, lit, shade, fogColor; varying vec3 vW;
        float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
        float fbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * n3(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }
        void main(){
          vec2 q = vW.xz * scale + vec2(uTime * speed * scale, uTime * speed * scale * 0.35);
          float base = fbm(vec3(q, slice * 0.6));
          float detail = fbm(vec3(q * 3.1, slice * 1.7 + uTime * 0.02));
          float dens = smoothstep(coverage, coverage + 0.22, base * 0.78 + detail * 0.3 - abs(slice - 0.45) * 0.35);
          if (dens < 0.01) discard;
          vec3 v = normalize(vW - cameraPosition);
          float fwd = pow(max(dot(v, sunDir), 0.0), 5.0);
          float top = slice;
          vec3 c = mix(shade, lit, clamp(top * 0.8 + (1.0 - dens) * 0.5, 0.0, 1.0));
          c += lit * fwd * (1.0 - dens) * 1.6;               // silver lining toward the sun
          float dist = length(vW.xz - cameraPosition.xz);
          float fade = 1.0 - smoothstep(900.0, 2400.0, dist);
          c = mix(fogColor, c, fade);
          gl_FragColor = vec4(c, dens * 0.55 * fade);
        }`,
    });
    const p = new THREE.Mesh(geo, m);
    p.rotation.x = -Math.PI / 2;
    p.position.y = y + i * gap;
    p.renderOrder = 1 + i;
    group.add(p);
  }
  return { group, uniforms };
}

// Soft round sprite for particles.
export function softSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Drifting particles, animated in the vertex shader (no per-frame CPU work).
export function particles({ count, area, yMin, yMax, color, size, rise = 0, fall = 0, swirl = 1, opacity = 0.8, additive = true, seed = 1 }) {
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) { pos[i * 3] = (r() - 0.5) * area; pos[i * 3 + 1] = yMin + r() * (yMax - yMin); pos[i * 3 + 2] = (r() - 0.5) * area; rnd[i] = r(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 1));
  const uniforms = { uTime: { value: 0 }, map: { value: softSprite() }, color: { value: new THREE.Color(color) }, size: { value: size }, opacity: { value: opacity } };
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms,
    vertexShader: `
      attribute float rnd; uniform float uTime, size; varying float vA;
      void main(){
        vec3 p = position;
        float span = ${(yMax - yMin).toFixed(1)};
        float t = uTime + rnd * 100.0;
        p.y = ${yMin.toFixed(1)} + mod(p.y - ${yMin.toFixed(1)} + t * ${(rise - fall).toFixed(3)}, span);
        p.x += sin(t * 0.4 + rnd * 6.28) * ${(2 * swirl).toFixed(2)};
        p.z += cos(t * 0.33 + rnd * 9.0) * ${(2 * swirl).toFixed(2)};
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float edge = smoothstep(0.0, 0.12, (p.y - ${yMin.toFixed(1)}) / span) * smoothstep(1.0, 0.85, (p.y - ${yMin.toFixed(1)}) / span);
        vA = edge * (0.55 + 0.45 * sin(t * 2.0 + rnd * 20.0));
        gl_PointSize = size * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; uniform float opacity; varying float vA;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, t.a * vA * opacity); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return { points: pts, uniforms };
}

// Post-processing in the spirit of Solas: depth-aware height fog that scatters warm light toward
// the sun, screen-space crepuscular rays occluded by terrain and trees, rising Nether smoke,
// bloom on HDR emissives, and a filmic grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const ATMO_FRAG = `
  uniform sampler2D tDiffuse, tDepth;
  uniform mat4 projInv, viewInv;
  uniform vec3 camPos, sunDir, fogColor, sunColor;
  uniform vec2 sunUv;
  uniform float density, heightFalloff, fogBase, rays, raySamples, sunFacing, smoke, nether, uTime;
  varying vec2 vUv;

  float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }

  vec3 worldPos(vec2 uv, float d){
    vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = projInv * ndc; v /= v.w;
    return (viewInv * v).xyz;
  }

  void main(){
    vec4 col = texture2D(tDiffuse, vUv);
    float d = texture2D(tDepth, vUv).x;
    bool sky = d >= 0.99999;
    vec3 wp = worldPos(vUv, sky ? 0.9999 : d);
    vec3 ray = wp - camPos;
    float dist = sky ? 3000.0 : length(ray);
    vec3 dir = ray / max(length(ray), 1e-4);

    // Exponential height fog, integrated analytically along the view ray.
    float hc = camPos.y - fogBase;
    float k = heightFalloff;
    float dy = dir.y * dist;
    float integral = abs(dy) > 0.01 ? exp(-k * hc) * (1.0 - exp(-k * dy)) / (k * dir.y) : exp(-k * hc) * dist;
    float dens = density;
    if (smoke > 0.0) {
      // Rising, wavy smoke streams: modulate density with drifting 3D noise sampled mid-ray.
      vec3 m = camPos + dir * min(dist, 140.0) * 0.55;
      float s = n3(vec3(m.x * 0.035, m.y * 0.05 - uTime * 0.25, m.z * 0.035)) * 0.6 + n3(vec3(m.x * 0.09 + uTime * 0.05, m.y * 0.12 - uTime * 0.6, m.z * 0.09)) * 0.4;
      dens *= mix(0.55, 1.9, s);
    }
    float fog = 1.0 - exp(-dens * max(integral, 0.0));
    if (sky) fog *= nether > 0.5 ? 0.85 : 0.35;

    float toSun = max(dot(dir, sunDir), 0.0);
    vec3 scatter = fogColor + sunColor * (pow(toSun, 10.0) * 0.7 + pow(toSun, 3.0) * 0.06) * (1.0 - nether);
    if (nether > 0.5) {
      // Lava light bleeding into the low haze.
      float low = clamp(1.0 - (wp.y - fogBase) / 30.0, 0.0, 1.0);
      scatter = mix(fogColor, sunColor, low * 0.35);
    }
    col.rgb = mix(col.rgb, scatter, fog);

    // Crepuscular rays: march toward the sun, accumulating unoccluded sky.
    if (rays > 0.0 && sunFacing > 0.0) {
      vec2 delta = (vUv - sunUv) / raySamples * 0.95;
      vec2 uv = vUv;
      float illum = 1.0, acc = 0.0;
      for (int i = 0; i < 64; i++) {
        if (float(i) >= raySamples) break;
        uv -= delta;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float open = step(0.99999, texture2D(tDepth, uv).x);
        acc += open * illum;
        illum *= 0.965;
      }
      acc /= raySamples;
      float falloff = pow(max(1.0 - length((vUv - sunUv) * vec2(1.6, 1.0)), 0.0), 1.6);
      col.rgb += sunColor * acc * falloff * rays * sunFacing * 0.55;
    }
    gl_FragColor = col;
  }`;

class AtmospherePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, viewInv: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, fogColor: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() },
        sunUv: { value: new THREE.Vector2(0.5, 0.5) }, density: { value: 0.004 }, heightFalloff: { value: 0.04 }, fogBase: { value: 20 },
        rays: { value: 1 }, raySamples: { value: 48 }, sunFacing: { value: 0 }, smoke: { value: 0 }, nether: { value: 0 }, uTime: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: ATMO_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.sunWorld = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
  }
  configure(a, sunDir) {
    const u = this.material.uniforms;
    u.fogColor.value.copy(a.fogColor); u.sunColor.value.copy(a.sunColor);
    u.density.value = a.density; u.heightFalloff.value = a.heightFalloff; u.fogBase.value = a.fogBase;
    u.rays.value = a.rays; u.smoke.value = a.smoke; u.nether.value = a.nether;
    if (sunDir) u.sunDir.value.copy(sunDir);
    this.sunDir = sunDir;
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    const cam = this.camera;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.projInv.value.copy(cam.projectionMatrixInverse);
    u.viewInv.value.copy(cam.matrixWorld);
    u.camPos.value.copy(cam.position);
    if (this.sunDir) {
      this.sunWorld.copy(cam.position).addScaledVector(this.sunDir, 1000).project(cam);
      u.sunUv.value.set(this.sunWorld.x * 0.5 + 0.5, this.sunWorld.y * 0.5 + 0.5);
      cam.getWorldDirection(this.tmp);
      u.sunFacing.value = THREE.MathUtils.smoothstep(this.tmp.dot(this.sunDir), 0.05, 0.6) * (this.sunWorld.z < 1 ? 1 : 0);
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.12 }, vignette: { value: 0.32 }, lift: { value: new THREE.Vector3(0.0, 0.0, 0.0) }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation, vignette; uniform vec3 lift, tint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation) * tint + lift;
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera, cfg) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
  rt.depthTexture.type = THREE.UnsignedIntType;
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const atmo = new AtmospherePass(camera);
  atmo.needsSwap = true;
  atmo.configure(cfg.atmo, cfg.sunDir);
  composer.addPass(atmo);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), cfg.bloom.strength, cfg.bloom.radius, cfg.bloom.threshold);
  composer.addPass(bloom);
  const grade = new ShaderPass(GRADE);
  if (cfg.atmo.nether) { grade.uniforms.saturation.value = 1.18; grade.uniforms.tint.value.set(1.04, 0.97, 0.94); grade.uniforms.vignette.value = 0.42; }
  else { grade.uniforms.tint.value.set(1.02, 1.0, 0.97); }
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    composer, atmo, bloom,
    setSize(w, h, ratio) { composer.setPixelRatio(ratio); composer.setSize(w, h); },
    setQuality(level) { atmo.material.uniforms.raySamples.value = level >= 2 ? 24 : 48; bloom.enabled = level < 4; },
    render(t) { atmo.material.uniforms.uTime.value = t; composer.render(); },
    dispose() { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); atmo.dispose(); bloom.dispose(); },
  };
}

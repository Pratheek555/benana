// Deterministic value noise + fbm, and a seeded PRNG. Shared by terrain and textures.
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(x, y, z, s = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 2246822519 + s * 3266489917) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const sm = (t) => t * t * (3 - 2 * t);
export const smooth = sm;
export const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function noise2(x, z, s = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = sm(x - xi), zf = sm(z - zi);
  const a = hash3(xi, 0, zi, s), b = hash3(xi + 1, 0, zi, s), c = hash3(xi, 0, zi + 1, s), d = hash3(xi + 1, 0, zi + 1, s);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

export function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const v = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return l(
    l(l(v(0, 0, 0), v(1, 0, 0), xf), l(v(0, 1, 0), v(1, 1, 0), xf), yf),
    l(l(v(0, 0, 1), v(1, 0, 1), xf), l(v(0, 1, 1), v(1, 1, 1), xf), yf),
    zf,
  );
}

export function fbm2(x, z, s = 0, oct = 5) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += a * noise2(x * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}

export function fbm3(x, y, z, s = 0, oct = 4) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += a * noise3(x * f, y * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}

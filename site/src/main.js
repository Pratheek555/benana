import { inject } from '@vercel/analytics';

inject();
import { createWorld } from './world/index.js';
import { createDust } from './dust.js';
import './waitlist.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scenes = [...document.querySelectorAll('.scene')];

// Split headlines into masked words of characters, each with its own stagger delay.
for (const el of document.querySelectorAll('[data-split]')) {
  const words = el.textContent.trim().split(/\s+/);
  const isMark = el.classList.contains('wordmark');
  el.setAttribute('aria-label', el.textContent.trim());
  el.textContent = '';
  let i = 0;
  words.forEach((word, wi) => {
    const w = document.createElement('span');
    w.className = 'w';
    w.setAttribute('aria-hidden', 'true');
    for (const ch of word) {
      const c = document.createElement('span');
      c.className = 'c';
      c.textContent = ch;
      c.style.setProperty('--d', String(Math.round(i * (isMark ? 55 : 22) + wi * 40)));
      w.appendChild(c);
      i++;
    }
    el.appendChild(w);
    if (wi < words.length - 1) { const sp = document.createElement('span'); sp.className = 'sp'; el.appendChild(sp); }
  });
  // Supporting lines start once most of the headline has landed.
  const scene = el.closest('.scene');
  scene.querySelectorAll('[data-fade]').forEach((f, k) => f.style.setProperty('--fd', String(Math.min(1100, i * (isMark ? 55 : 22) * 0.6 + 260 + k * 160))));
}

// One snap point and one rail tick per scene.
const spacer = document.querySelector('.spacer');
const rail = document.querySelector('.rail');
scenes.forEach(() => { spacer.appendChild(document.createElement('div')); rail.appendChild(document.createElement('i')); });
const ticks = [...rail.children];

// ---------- world + light/dark (Overworld / Nether) ----------
const root = document.documentElement;
const preview = new URLSearchParams(location.search).has('preview');
const themeBtn = document.querySelector('.theme');
const themeLabel = document.querySelector('.theme-label');
let world = null;

// ---------- background: real footage when provided, else the live world ----------
// Recorded gameplay goes in public/video/overworld.mp4 and public/video/nether.mp4.
const video = document.getElementById('footage');
const FOOTAGE = { light: 'overworld', dark: 'nether' };
let usingVideo = false;

// Prefers WebM (VP9/AV1) where the browser can play it, then MP4 (H.264/HEVC).
async function footageFor(theme) {
  if (preview) return null;
  const formats = [['webm', 'video/webm; codecs="vp9"'], ['mp4', 'video/mp4; codecs="avc1.640033"']]
    .filter(([, type]) => video.canPlayType(type));
  for (const [ext] of formats) {
    const url = `/video/${FOOTAGE[theme]}.${ext}`;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok && (r.headers.get('content-type') || '').startsWith('video/')) return url;
    } catch { /* try the next format */ }
  }
  return null;
}

async function mountBackground(theme) {
  const url = await footageFor(theme);
  if (url) {
    world?.dispose(); world = null;
    document.getElementById('world').hidden = true;
    usingVideo = true;
    video.src = url;
    video.hidden = false;
    const ready = () => { document.body.classList.add('video-ready'); revealWorld(); };
    video.addEventListener('playing', ready, { once: true });
    if (reducedMotion) { video.addEventListener('loadeddata', ready, { once: true }); video.load(); }
    else video.play().catch(() => { ready(); }); // autoplay blocked: show the first frame
    pushIn(Math.max(0, active));
    return;
  }
  usingVideo = false;
  video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  document.body.classList.remove('video-ready');
  mountWorld(theme);
}

// The intro (and a dimension switch) stays dark until the new world is ready to be seen.
let revealed = false;
function revealWorld() {
  document.body.classList.remove('loading', 'switching');
  if (revealed) return;
  revealed = true;
  document.body.classList.add('ready');
  setTimeout(onScroll, reducedMotion ? 0 : 450);
}

// Footage can't change camera shots, so each scene eases in a little closer instead.
function pushIn(i) {
  if (!usingVideo || reducedMotion) return;
  const k = 1.02 + i * 0.012;
  video.style.transform = `scale(${k.toFixed(3)}) translate3d(${(i % 2 ? -1 : 1) * i * 0.25}%, ${-i * 0.15}%, 0)`;
}

function mountWorld(theme) {
  // A fresh canvas per world: a WebGL context can't be cleanly handed to a second renderer.
  const old = document.getElementById('world');
  const canvas = document.createElement('canvas');
  canvas.id = 'world';
  canvas.setAttribute('aria-hidden', 'true');
  old.replaceWith(canvas);
  try {
    world = createWorld(canvas, { theme, reducedMotion, preview, onPack: showCredit, onReady: revealWorld });
    world.setShot(Math.max(0, active));
  } catch (e) {
    world = null; // No WebGL: the copy still works on the dark background.
    console.warn('WebGL unavailable', e);
    revealWorld();
  }
}

// Resource packs usually require attribution (e.g. CC BY-SA); show the pack's credit line.
function showCredit(pack) {
  const el = document.querySelector('.credit');
  if (!pack.credit) return;
  el.textContent = pack.credit;
  el.hidden = false;
}

function labelTheme(theme) {
  themeLabel.textContent = theme === 'dark' ? 'nether' : 'overworld';
  themeBtn.setAttribute('aria-label', theme === 'dark' ? 'switch to the overworld' : 'switch to the nether');
}

let switching = false;
themeBtn.addEventListener('click', () => {
  if (switching) return;
  switching = true;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.add('switching', 'loading');
  setTimeout(() => {
    world?.dispose();
    root.dataset.theme = next;
    try { localStorage.setItem('benana-theme', next); } catch { /* private mode */ }
    labelTheme(next);
    // Let the fade paint before the (synchronous) world build.
    requestAnimationFrame(() => setTimeout(async () => {
      await mountBackground(next);
      switching = false;
      setTimeout(() => document.body.classList.remove('switching', 'loading'), 8000); // never stay dark
    }, 30));
  }, 480);
});

// ---------- no copying ----------
for (const ev of ['copy', 'cut', 'selectstart', 'dragstart', 'contextmenu']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && ['c', 'x', 'a', 's'].includes(e.key.toLowerCase())) e.preventDefault(); });

// Copy breaks into dust and re-forms from it between scenes (falls back to CSS fades).
const dust = preview ? null : createDust({ reducedMotion });
if (dust) document.body.classList.add('dust-mode');

function swapScenes(i, prev) {
  if (!dust) {
    scenes.forEach((s, k) => {
      s.classList.toggle('on', k === i);
      s.classList.toggle('out', k === prev);
    });
    if (prev >= 0) setTimeout(() => { if (active !== prev) scenes[prev].classList.remove('out'); }, 900);
    return;
  }
  dust.flush();
  if (prev >= 0) {
    dust.breakApart(scenes[prev], { duration: 1300 });
    scenes[prev].classList.remove('on');
  }
  scenes.forEach((s, k) => { if (k !== i) s.classList.remove('on'); });
  const fx = dust.assemble(scenes[i], {
    duration: 1350,
    delay: prev >= 0 ? 220 : 0,
    done: () => { if (active === i) scenes[i].classList.add('on'); },
  });
  if (!fx) scenes[i].classList.add('on');
}

function show(i) {
  if (i === active) return;
  const prev = active;
  active = i;
  swapScenes(i, prev);
  ticks.forEach((t, k) => t.classList.toggle('on', k === i));
  document.body.dataset.scene = String(i);
  world?.setShot(i);
  pushIn(i);
}

function onScroll() {
  const i = Math.round(window.scrollY / window.innerHeight);
  show(Math.max(0, Math.min(scenes.length - 1, i)));
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);

// Keyboard: arrows / page keys step one scene.
window.addEventListener('keydown', (e) => {
  const step = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const next = Math.max(0, Math.min(scenes.length - 1, active + step));
  window.scrollTo({ top: next * window.innerHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
});

let active = -1;
labelTheme(root.dataset.theme);
mountBackground(root.dataset.theme);

// Safety net: reveal the page even if the world never reports ready.
setTimeout(revealWorld, 8000);

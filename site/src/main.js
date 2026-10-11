import { createWorld } from './world.js';

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

let world = null;
try {
  // ?preview renders at low resolution, for headless screenshots on CPU-only machines.
  world = createWorld(document.getElementById('world'), { reducedMotion, preview: new URLSearchParams(location.search).has('preview') });
} catch (e) {
  // No WebGL: the text still works on the dark background.
  console.warn('WebGL unavailable', e);
}

let active = -1;
function show(i) {
  if (i === active) return;
  const prev = active;
  active = i;
  scenes.forEach((s, k) => {
    s.classList.toggle('on', k === i);
    s.classList.toggle('out', k === prev);
    s.classList.remove('settled');
  });
  // Masks stay on while letters rise in, then come off so glows can spread.
  const landed = Math.max(0, ...[...scenes[i].querySelectorAll('.c')].map((c) => Number(c.style.getPropertyValue('--d')) || 0)) + 1100;
  setTimeout(() => { if (active === i) scenes[i].classList.add('settled'); }, reducedMotion ? 0 : landed);
  if (prev >= 0) setTimeout(() => { if (active !== prev) scenes[prev].classList.remove('out'); }, 900);
  ticks.forEach((t, k) => t.classList.toggle('on', k === i));
  document.body.dataset.scene = String(i);
  world?.setShot(i);
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

// Fade the world in from black, then reveal the wordmark.
requestAnimationFrame(() => {
  document.body.classList.add('ready');
  setTimeout(onScroll, reducedMotion ? 0 : 450);
});

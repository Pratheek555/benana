// node scrollto.mjs "<text>" [ms] [offsetPx]: smoothly scrolls the app so the element whose own text starts with <text> sits near the top.
import { execFileSync } from 'node:child_process';
const [text, ms = '1500', offset = '120'] = process.argv.slice(2);
const js = `(async () => {
  const el = [...document.querySelectorAll('*')].find((e) => e.children.length < 3 && e.textContent.trim().startsWith(${JSON.stringify(text)}));
  if (!el) return 'not found';
  let box = el.parentElement; while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return 'no scroller';
  const from = box.scrollTop, to = from + el.getBoundingClientRect().top - box.getBoundingClientRect().top - ${offset};
  const t0 = performance.now();
  await new Promise((done) => { const step = (t) => { const p = Math.min(1, (t - t0) / ${ms}); const e = p < .5 ? 2*p*p : 1 - (-2*p+2)**2/2; box.scrollTop = from + (to - from) * e; p < 1 ? requestAnimationFrame(step) : done(); }; requestAnimationFrame(step); });
  return 'scrolled ' + Math.round(to - from);
})()`;
console.log(execFileSync('node', ['../.audit/demo/cdp.mjs', 'eval', js], { cwd: import.meta.dirname, encoding: 'utf8' }).trim());

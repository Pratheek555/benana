import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { noise2D } from '@remotion/noise';
import { C, F } from '../theme';

// Beat 1: what making a mod looked like before Benana. Windows pile up while the days tick by,
// then everything falls away to the one-line alternative.
export const PAIN_FRAMES = 330;

const COLLAPSE = 236;
const PROMPT_AT = 272;

const STEPS = [
  { at: 12, text: 'Install the JDK, Maven, a Paper server' },
  { at: 52, text: 'Write 400 lines of boilerplate Java' },
  { at: 98, text: 'Draw every texture by hand' },
  { at: 142, text: 'Build. Crash. Read the stack trace.' },
  { at: 186, text: 'Restart, rejoin, test, repeat' },
];

const JAVA = [
  ['kw', 'public final class '], ['ty', 'BlackHolePlugin '], ['kw', 'extends '], ['ty', 'JavaPlugin '], ['p', '{'],
  '\n', ['p', '  '], ['an', '@Override'],
  '\n', ['p', '  '], ['kw', 'public void '], ['fn', 'onEnable'], ['p', '() {'],
  '\n', ['p', '    getServer().getPluginManager()'],
  '\n', ['p', '      .registerEvents('], ['kw', 'new '], ['ty', 'GrenadeListener'], ['p', '(this), this);'],
  '\n', ['p', '    '], ['ty', 'ItemStack '], ['p', 'item = '], ['kw', 'new '], ['ty', 'ItemStack'], ['p', '(Material.SNOWBALL);'],
  '\n', ['p', '    '], ['ty', 'ItemMeta '], ['p', 'meta = item.getItemMeta();'],
  '\n', ['p', '    meta.setCustomModelData('], ['num', '7341'], ['p', ');'],
  '\n', ['p', '    '], ['cm', '// TODO why does the recipe not register??'],
  '\n', ['p', '    '], ['ty', 'NamespacedKey '], ['p', 'key = '], ['kw', 'new '], ['ty', 'NamespacedKey'], ['p', '(this, '], ['str', '"bh"'], ['p', ');'],
  '\n', ['p', '  }'],
];
const TONE = { kw: '#c792ea', ty: '#82aaff', fn: '#ffcb6b', an: '#f78c6c', num: '#f78c6c', str: '#c3e88d', cm: '#5c6370', p: '#d6deeb' };

const GRADLE = [
  ['$ mvn package', C.text2],
  ['[INFO] Scanning for projects...', C.text3],
  ['[INFO] Building black-hole 0.1.0', C.text3],
  ['[ERROR] cannot find symbol: class ItemMeta', C.badText],
  ['[ERROR] package org.bukkit.inventory.meta does not exist', C.badText],
  ['[INFO] BUILD FAILURE', C.bad],
  ['$ mvn package', C.text2],
  ['[ERROR] incompatible types: int cannot be converted', C.badText],
  ['[INFO] BUILD FAILURE', C.bad],
];

const TRACE = [
  '[19:42:07 ERROR]: Could not pass event ProjectileHitEvent',
  'java.lang.NullPointerException: Cannot invoke',
  '  "org.bukkit.entity.Entity.getLocation()"',
  '    at dev.mod.GrenadeListener.onHit(GrenadeListener.java:48)',
  '    at co.aikar.timings.TimedEventExecutor.execute',
  '    at org.bukkit.plugin.SimplePluginManager.callEvent',
  '    at net.minecraft.world.entity.projectile.Snowball',
  '    at net.minecraft.server.level.ServerLevel.tick',
  '[19:42:07 WARN]: Can\'t keep up! Is the server overloaded?',
  '[19:42:12 INFO]: Player lost connection: Timed out',
];

// Each window enters on a spring, drifts slightly, and falls off screen at the collapse.
function Win({ enter, x, y, w, h, rot, title, children, fall = 1 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - enter, fps, config: { damping: 14, stiffness: 120 } });
  const drop = interpolate(frame, [COLLAPSE, COLLAPSE + 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const driftX = noise2D('x' + title, frame / 90, 0) * 6;
  const driftY = noise2D('y' + title, 0, frame / 90) * 6;
  if (frame < enter) return null;
  return (
    <div
      style={{
        position: 'absolute', left: x + driftX, top: y + driftY + drop * 1400 * fall, width: w, height: h,
        transform: `scale(${0.6 + 0.4 * s}) rotate(${rot + drop * 25 * fall}deg)`, opacity: s,
        background: C.panel, border: '1px solid #262626', borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,.7)',
      }}
    >
      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: C.raised, borderBottom: '1px solid #222' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
        <div style={{ marginLeft: 10, fontFamily: F.mono, fontSize: 15, color: C.text3 }}>{title}</div>
      </div>
      <div style={{ padding: 18, height: h - 38, overflow: 'hidden' }}>{children(frame - enter)}</div>
    </div>
  );
}

function Code({ t }) {
  // Types roughly two characters a frame through the token list.
  let budget = Math.floor(t * 2.2);
  const out = [];
  JAVA.forEach((tok, i) => {
    if (budget <= 0) return;
    if (tok === '\n') { out.push(<br key={i} />); return; }
    const [kind, text] = tok;
    const shown = text.slice(0, budget);
    budget -= text.length;
    out.push(<span key={i} style={{ color: TONE[kind] }}>{shown}</span>);
  });
  return <div style={{ fontFamily: F.mono, fontSize: 19, lineHeight: 1.65, whiteSpace: 'pre' }}>{out}</div>;
}

function Lines({ t, lines, every, size = 18 }) {
  const n = Math.min(lines.length, Math.floor(t / every) + 1);
  return (
    <div style={{ fontFamily: F.mono, fontSize: size, lineHeight: 1.6 }}>
      {lines.slice(0, n).map((l, i) => {
        const [text, color] = Array.isArray(l) ? l : [l, i === 0 || l.startsWith('[') ? C.badText : C.text3];
        return <div key={i} style={{ color, whiteSpace: 'pre' }}>{text}</div>;
      })}
    </div>
  );
}

// A 16x16 texture filled one pixel at a time: the slowest way to make a grenade.
function PixelGrid({ t }) {
  const filled = Math.floor(t * 2.4);
  const size = 16;
  const cells = [];
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = Math.floor(i / size);
    const d = Math.hypot(x - 7.5, y - 8.5);
    const color = d < 3 ? '#1a0b2e' : d < 5 ? '#4b1d7a' : d < 6.4 ? '#8b5cf6' : y < 3 && x > 6 && x < 9 ? '#9ca3af' : null;
    cells.push(
      <div key={i} style={{ width: 22, height: 22, border: '1px solid #1c1c1c', background: i < filled && color ? color : 'transparent' }} />,
    );
  }
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${size}, 22px)` }}>{cells}</div>
      <div style={{ fontFamily: F.mono, fontSize: 15, color: C.text3, lineHeight: 1.8 }}>
        <div>grenade.png</div>
        <div>16 × 16</div>
        <div style={{ color: C.accent }}>{Math.min(filled, 256)}/256 px</div>
      </div>
    </div>
  );
}

function DayCounter() {
  const frame = useCurrentFrame();
  const day = Math.round(interpolate(frame, [10, COLLAPSE - 10], [1, 23], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) }));
  const hide = interpolate(frame, [COLLAPSE, COLLAPSE + 14], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', right: 70, top: 56, textAlign: 'right', opacity: hide }}>
      <div style={{ fontFamily: F.mono, fontSize: 22, color: C.text3, letterSpacing: 4 }}>TIME SPENT</div>
      <div style={{ fontFamily: F.pixel, fontSize: 96, color: day > 14 ? C.badText : C.text, lineHeight: 1.1 }}>DAY {day}</div>
    </div>
  );
}

function Steps() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hide = interpolate(frame, [COLLAPSE, COLLAPSE + 14], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 70, top: 56, display: 'flex', flexDirection: 'column', gap: 14, opacity: hide, zIndex: 5 }}>
      {STEPS.map((s, i) => {
        const k = spring({ frame: frame - s.at, fps, config: { damping: 16 } });
        if (frame < s.at) return null;
        const done = frame > (STEPS[i + 1]?.at ?? COLLAPSE);
        return (
          <div key={s.text} style={{ display: 'flex', alignItems: 'center', gap: 16, transform: `translateX(${(1 - k) * -40}px)`, opacity: k }}>
            <div style={{ width: 34, height: 34, borderRadius: 17, background: done ? C.bad : C.accent, color: '#000', fontFamily: F.sans, fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
            <div style={{ fontFamily: F.sans, fontSize: 34, fontWeight: 600, color: done ? C.text3 : C.text, textDecoration: done ? 'line-through' : 'none', textDecorationColor: C.bad, background: 'rgba(0,0,0,.72)', padding: '4px 12px', borderRadius: 8 }}>{s.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function Ending() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - (COLLAPSE + 16), fps, config: { damping: 18 } });
  const out = interpolate(frame, [PROMPT_AT - 8, PROMPT_AT], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const prompt = 'a hammer that calls down lightning';
  const typed = prompt.slice(0, Math.max(0, Math.floor((frame - PROMPT_AT - 4) * 1.3)));
  const caret = Math.floor(frame / 8) % 2 === 0;
  const b = spring({ frame: frame - PROMPT_AT, fps, config: { damping: 18 } });
  if (frame < COLLAPSE + 10) return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      {frame < PROMPT_AT ? (
        <div style={{ fontFamily: F.sans, fontSize: 92, fontWeight: 700, color: C.text, opacity: a * out, transform: `translateY(${(1 - a) * 30}px)` }}>
          What if you just <span style={{ color: C.accent }}>described it?</span>
        </div>
      ) : (
        <div style={{ transform: `scale(${0.9 + 0.1 * b})`, opacity: b, width: 1100, padding: '30px 36px', borderRadius: 22, background: C.panel, border: `1px solid ${C.accent}55`, boxShadow: `0 0 80px ${C.accent}22` }}>
          <div style={{ fontFamily: F.mono, fontSize: 20, color: C.text3, marginBottom: 12 }}>Describe your mod</div>
          <div style={{ fontFamily: F.sans, fontSize: 46, color: C.text }}>
            {typed}<span style={{ opacity: caret ? 1 : 0, color: C.accent }}>|</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}

export const Pain = () => {
  const frame = useCurrentFrame();
  // The shake grows with the pile and stops when it falls.
  const shake = interpolate(frame, [150, COLLAPSE], [0, 7], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * (frame < COLLAPSE ? 1 : 0);
  const sx = noise2D('sx', frame / 3, 0) * shake;
  const sy = noise2D('sy', 0, frame / 3) * shake;
  const redFlash = [146, 168, 200].some((f) => frame >= f && frame < f + 4) ? 0.12 : 0;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 60%, #15110a 0%, ${C.bg} 70%)` }}>
      <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px)` }}>
        <Win enter={24} x={560} y={250} w={820} h={520} rot={-2} title="BlackHolePlugin.java">{(t) => <Code t={t} />}</Win>
        <Win enter={64} x={1080} y={330} w={720} h={360} rot={3} title="mvn package" fall={1.2}>{(t) => <Lines t={t} lines={GRADLE} every={7} />}</Win>
        <Win enter={104} x={150} y={460} w={620} h={440} rot={-4} title="Aseprite — grenade.png" fall={0.9}>{(t) => <PixelGrid t={t} />}</Win>
        <Win enter={146} x={760} y={600} w={1060} h={400} rot={1.5} title="paper-1.21.4 — server console" fall={1.1}>{(t) => <Lines t={t} lines={TRACE} every={4} size={19} />}</Win>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.bad, opacity: redFlash, pointerEvents: 'none' }} />
      <Steps />
      <DayCounter />
      <Ending />
    </AbsoluteFill>
  );
};

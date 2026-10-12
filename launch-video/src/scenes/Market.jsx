import React from 'react';
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame, Easing } from 'remotion';
import { C, F } from '../theme';
import { Caption, Chip, Footage, clamp, useSpring } from '../ui';

// Beat 4: the marketplace is built on Entire. Every agent commit is a checkpoint (prompt, transcript, code),
// published mods push their checkpoints, and a remix starts from any one of them.
// IDs are ExplosiveArrows' real commits and Entire checkpoints (~/.benana/mods/explosive-arrows-2lnt).
export const MARKET_FRAMES = 390;
const GRAPH_END = 250;

const MAIN = [
  { x: 260, label: 'Scaffold', sha: '16a50bb' },
  { x: 560, label: 'Test plan', sha: 'b83fe29' },
  { x: 860, label: 'Builder', sha: '7001fb3', cp: '01M4MQDA1Z26' },
  { x: 1160, label: 'Playtest · pass', sha: '6afefdf', cp: '01M4MQJW8TSR' },
];
const LINE_Y = 420;
const REMIX_Y = 700;

function Node({ x, y, at, label, sha, cp, color = C.entire, glow, above }) {
  const k = useSpring(at, { damping: 13, stiffness: 160 });
  return (
    <div style={{ position: 'absolute', left: x - 30, top: y - 30, opacity: k, transform: `scale(${k})` }}>
      <div style={{ width: 60, height: 60, borderRadius: 30, background: cp ? color : C.raised, border: `3px solid ${color}`, boxShadow: glow ? `0 0 ${30 + glow * 40}px ${color}` : 'none' }} />
      <div style={{ position: 'absolute', top: above ? -132 : 76, left: -90, width: 240, textAlign: 'center' }}>
        <div style={{ fontFamily: F.sans, fontWeight: 650, fontSize: 26, color: C.text }}>{label}</div>
        <div style={{ fontFamily: F.mono, fontSize: 18, color: C.text3, marginTop: 2 }}>{sha}</div>
        {cp && <div style={{ display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 6, background: `${color}22`, border: `1px solid ${color}66`, fontFamily: F.mono, fontSize: 17, color }}>{cp}</div>}
      </div>
    </div>
  );
}

function Line({ x1, y1, x2, y2, at, color = C.entire, curve }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const d = curve ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x1 + 60},${y2} ${x1 + 200},${y2} L${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
  return <path d={d} stroke={color} strokeWidth={5} fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} strokeLinecap="round" />;
}

function Graph() {
  const frame = useCurrentFrame();
  const head = useSpring(0);
  const publish = useSpring(70, { damping: 14 });
  const remixer = useSpring(118, { damping: 14 });
  const pulse = interpolate(frame, [128, 140, 152], [0, 1, 0.3], clamp);
  const ctx = useSpring(176, { damping: 15 });
  const out = interpolate(frame, [GRAPH_END - 12, GRAPH_END], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1300px 800px at 50% 45%, #110c1f 0%, ${C.bg} 70%)`, opacity: out }}>
      <div style={{ position: 'absolute', left: 120, top: 80, display: 'flex', alignItems: 'center', gap: 20, opacity: head }}>
        <Img src={staticFile('logos/entire-wordmark.svg')} style={{ height: 40 }} />
        <div style={{ fontFamily: F.sans, fontSize: 40, fontWeight: 600, color: C.text2 }}>Agent sessions carry Entire checkpoints.</div>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 155, fontFamily: F.mono, fontSize: 22, letterSpacing: 3, color: C.entire, opacity: head }}>REMIX FLOW · START FROM A VERIFIED VERSION</div>
      <div style={{ position: 'absolute', left: 120, top: LINE_Y - 20, fontFamily: F.mono, fontSize: 22, color: C.text3, opacity: head }}>main</div>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {MAIN.slice(1).map((n, i) => <Line key={n.sha} x1={MAIN[i].x} y1={LINE_Y} x2={n.x} y2={LINE_Y} at={6 + i * 12} />)}
        <Line x1={1160} y1={LINE_Y} x2={1500} y2={REMIX_Y} at={140} curve color={C.accent} />
        <Line x1={1500} y1={REMIX_Y} x2={1760} y2={REMIX_Y} at={160} color={C.accent} />
      </svg>
      {MAIN.map((n, i) => <Node key={n.sha} {...n} y={LINE_Y} at={4 + i * 12} glow={n.cp === '01M4MQJW8TSR' ? pulse : 0} above />)}
      {/* Publish: the version's checkpoints go to an Entire remote with the jar. */}
      <div style={{ position: 'absolute', left: 1420, top: LINE_Y - 56, opacity: publish, transform: `translateX(${(1 - publish) * 40}px)`, padding: '16px 22px', borderRadius: 16, background: C.raised, border: `1px solid ${C.entire}66` }}>
        <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 28, color: C.text }}>Published v1</div>
        <div style={{ fontFamily: F.mono, fontSize: 18, color: C.text3, marginTop: 4 }}>jar · sha256 · 2 checkpoints → Entire</div>
      </div>
      {/* Another creator remixes from the passing checkpoint. */}
      <div style={{ position: 'absolute', left: 640, top: REMIX_Y - 32, opacity: remixer, transform: `translateY(${(1 - remixer) * 30}px)`, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: '#2b2140', border: `2px solid ${C.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.sans, fontWeight: 800, fontSize: 28, color: C.accent }}>R</div>
        <div style={{ padding: '12px 20px', borderRadius: 12, background: C.accent, color: '#000', fontFamily: F.sans, fontWeight: 700, fontSize: 26 }}>Remix from 01M4MQJW8TSR</div>
      </div>
      <Node x={1500} y={REMIX_Y} at={150} label="remix/explosive-arrows-v1" sha="checked out at 6afefdf" color={C.accent} />
      <Node x={1760} y={REMIX_Y} at={166} label="Your next version" sha="new agent session" cp="new checkpoints" color={C.accent} />
      <div style={{ position: 'absolute', left: 120, right: 120, top: 860, opacity: ctx, transform: `translateY(${(1 - ctx) * 20}px)`, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {['spec', 'test plan', 'attempts + lessons', 'transcripts (opt-in)'].map((t) => (
          <div key={t} style={{ padding: '10px 18px', borderRadius: 10, border: `1px solid ${C.entire}55`, background: `${C.entire}14`, fontFamily: F.mono, fontSize: 22, color: C.text2 }}>{t}</div>
        ))}
        <div style={{ width: '100%', fontFamily: F.sans, fontSize: 26, color: C.text3 }}>The next creator starts with the code and context from that checkpoint.</div>
      </div>
    </AbsoluteFill>
  );
}

export const Market = ({ pageClip }) => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Sequence durationInFrames={GRAPH_END}>
      <Graph />
    </Sequence>
    <Sequence from={GRAPH_END - 6}>
      {pageClip ? <Footage {...pageClip} dur={MARKET_FRAMES - GRAPH_END} /> : <AbsoluteFill style={{ background: '#0b0b0b' }} />}
      <Chip at={4} color={C.entire} icon={<Img src={staticFile('logos/entire.svg')} style={{ height: 30 }} />}>Benana Marketplace</Chip>
      <Caption at={10}>Publish a mod. Remix any checkpoint.</Caption>
    </Sequence>
  </AbsoluteFill>
);

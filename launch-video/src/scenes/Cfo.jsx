import React from 'react';
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { C, F } from '../theme';
import { Caption, Chip, Footage, clamp, useSpring } from '../ui';

// Beat 5: cfo.ai for creators. Real build costs from the agents' usage, then the CFO answering from cfo.ai.
export const CFO_FRAMES = 270;

function Stat({ at, label, value, prefix = '$', decimals = 2, color = C.text }) {
  const frame = useCurrentFrame();
  const k = useSpring(at, { damping: 16 });
  const v = interpolate(frame, [at, at + 24], [0, value], clamp);
  return (
    <div style={{ opacity: k, transform: `translateY(${(1 - k) * 30}px)`, padding: '22px 28px', borderRadius: 18, background: 'rgba(12,12,12,.9)', border: '1px solid #2a2a2a', minWidth: 300 }}>
      <div style={{ fontFamily: F.mono, fontSize: 20, color: C.text3, letterSpacing: 2 }}>{label}</div>
      <div style={{ fontFamily: F.sans, fontWeight: 750, fontSize: 64, color, marginTop: 6 }}>{prefix}{v.toFixed(decimals)}</div>
    </div>
  );
}

export const Cfo = ({ pageClip, stats }) => {
  const s = stats;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {pageClip ? <Footage {...pageClip} dur={CFO_FRAMES} zoom={[1.0, 1.06]} style={{ filter: 'brightness(.8)' }} /> : <AbsoluteFill style={{ background: '#07120c' }} />}
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(0,0,0,.85) 0%, rgba(0,0,0,0) 55%)' }} />
      <Chip at={4} color={C.good} icon={<Img src={staticFile('logos/cfo-full.svg')} style={{ height: 22 }} />}>Creator CFO, powered by cfo.ai</Chip>
      <div style={{ position: 'absolute', left: 120, bottom: 200, display: 'flex', gap: 28 }}>
        <Stat at={40} label="THUNDERHAMMER BUILD" value={s.buildCost} />
        <Stat at={56} label="DRAGON PET · ESTIMATE" value={s.quote} />
        <Stat at={72} label="BREAK EVEN AT $1.99*" value={s.breakEven} prefix="" decimals={0} color={C.good} />
      </div>
      <Caption at={20} y={950} size={48}>Know what a mod costs, and what to charge, before you ship it.</Caption>
      <div style={{ position: 'absolute', left: 120, bottom: 145, fontFamily: F.mono, fontSize: 22, color: C.text2 }}>*2 sales assumes $1.99 per sale, before marketplace fees.</div>
    </AbsoluteFill>
  );
};

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Lockup } from '../Logo';
import { C, F } from '../theme';
import { clamp, useSpring } from '../ui';

// The drop: the banana builds itself block by block, then the one-line promise.
export const LogoReveal = () => {
  const frame = useCurrentFrame();
  const tag = useSpring(34, { damping: 18 });
  const flash = interpolate(frame, [0, 6], [0.5, 0], clamp);
  const out = interpolate(frame, [78, 90], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(900px 600px at 50% 50%, #1a1406 0%, ${C.bg} 70%)`, alignItems: 'center', justifyContent: 'center', opacity: out }}>
      <div style={{ transform: `translateY(${-40 * tag}px)` }}>
        <Lockup size={1.25} start={0} />
      </div>
      <div style={{ position: 'absolute', top: 650, fontFamily: F.sans, fontSize: 46, fontWeight: 500, color: C.text2, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>
        Describe a mod. It gets <span style={{ color: C.text }}>built</span>, <span style={{ color: C.text }}>drawn</span> and <span style={{ color: C.accent }}>played</span>.
      </div>
      <AbsoluteFill style={{ background: C.accent, opacity: flash }} />
    </AbsoluteFill>
  );
};

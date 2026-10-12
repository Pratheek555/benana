import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Lockup } from '../Logo';
import { C, F } from '../theme';
import { PartnerMark, clamp, useSpring } from '../ui';

// Outro: a curved wall of mods (stills from the footage) turning slowly behind the logo.
export const OUTRO_FRAMES = 120;
const COLS = 14, ROWS = 4, R = 1500, TILE_W = 300, TILE_H = 190;

export const Outro = ({ tiles = [] }) => {
  const frame = useCurrentFrame();
  const spin = interpolate(frame, [0, OUTRO_FRAMES], [-8, 8]);
  const blur = interpolate(frame, [20, 50], [0, 14], clamp);
  const dim = interpolate(frame, [20, 50], [1, 0.35], clamp);
  const partners = useSpring(56, { damping: 18 });
  const cta = useSpring(70, { damping: 18 });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ perspective: 1400, filter: `blur(${blur}px) brightness(${dim})` }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d', transform: `translateZ(${R - 250}px) rotateY(${spin}deg)` }}>
          {Array.from({ length: COLS * ROWS }, (_, i) => {
            const c = i % COLS, r = Math.floor(i / COLS);
            const angle = (c - (COLS - 1) / 2) * (360 / 34);
            const src = tiles.length ? tiles[(c * 3 + r * 5) % tiles.length] : null;
            return (
              <div key={i} style={{ position: 'absolute', width: TILE_W, height: TILE_H, left: -TILE_W / 2, top: (r - ROWS / 2) * (TILE_H + 22), transform: `rotateY(${angle}deg) translateZ(${-R}px)`, borderRadius: 14, overflow: 'hidden', background: C.raised, border: '1px solid #2a2a2a', backfaceVisibility: 'hidden' }}>
                {src && <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: 'translateY(-50px)' }}><Lockup size={1.2} start={24} /></div>
        <div style={{ position: 'absolute', top: 690, opacity: cta, padding: '14px 30px', borderRadius: 999, background: C.accent, color: '#000', fontFamily: F.sans, fontWeight: 750, fontSize: 34 }}>Join the waitlist</div>
        <div style={{ position: 'absolute', bottom: 70, display: 'flex', alignItems: 'center', gap: 56, opacity: partners }}>
          <span style={{ fontFamily: F.mono, fontSize: 22, color: C.text3, letterSpacing: 3 }}>BUILT WITH</span>
          <PartnerMark name="neatlogs" size={44} />
          <PartnerMark name="entire" size={40} />
          <PartnerMark name="cfo" size={48} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

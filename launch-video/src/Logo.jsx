import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from './theme';

// A blocky Minecraft-style banana. Each row is a 13-wide strip:
// h = highlight, y = body, d = shade, s = stem, t = tip, . = empty.
const ROWS = [
  '.........ss..',
  '.........ss..',
  '........hyy..',
  '........hyyd.',
  '.......hyyyd.',
  '......hhyyyd.',
  '.....hhyyyyd.',
  '...hhhyyyydd.',
  '.hhhyyyyyydd.',
  'thyyyyyyydd..',
  '.tdyyyyddd...',
  '..tdddddd....',
];
const FILL = { h: '#f7e19a', y: C.accent, d: '#b8902e', s: '#5b4423', t: '#3a2a14' };

export const BLOCKS = ROWS.flatMap((row, y) => [...row].map((c, x) => ({ x, y, c })).filter((b) => b.c !== '.'));

// Banana mark. `start` delays the block-by-block build; pass build={false} for a static mark.
export function BananaMark({ size = 240, start = 0, build = true }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cell = size / 13;
  return (
    <svg width={size} height={(size * 12) / 13} viewBox={`0 0 ${13 * cell} ${12 * cell}`} style={{ overflow: 'visible' }}>
      {BLOCKS.map((b, i) => {
        // Blocks drop in along the curve, bottom-left first.
        const order = (b.x + (11 - b.y)) * 0.9;
        const k = build ? spring({ frame: frame - start - order, fps, config: { damping: 11, stiffness: 160 } }) : 1;
        return (
          <rect
            key={i}
            x={b.x * cell}
            y={b.y * cell - (1 - k) * cell * 3}
            width={cell + 0.5}
            height={cell + 0.5}
            fill={FILL[b.c]}
            opacity={Math.min(1, k * 1.4)}
          />
        );
      })}
    </svg>
  );
}

export function Wordmark({ size = 120, color = C.text }) {
  return (
    <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: size, letterSpacing: -size * 0.045, color, lineHeight: 1 }}>
      benana
    </div>
  );
}

export function Lockup({ size = 1, start = 0, build = true }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const w = build ? spring({ frame: frame - start - 14, fps, config: { damping: 18 } }) : 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 34 * size }}>
      <BananaMark size={150 * size} start={start} build={build} />
      <div style={{ opacity: w, transform: `translateX(${(1 - w) * -30}px)` }}>
        <Wordmark size={150 * size} />
      </div>
    </div>
  );
}

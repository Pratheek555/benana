import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { C, F } from './theme';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export function useSpring(delay = 0, config = { damping: 16 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config });
}

// Numbered steps that tick from active to done, like the agent's build plan.
export function Checklist({ steps, x = 1180, y = 300, size = 36, color = C.accent }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', flexDirection: 'column', gap: size * 0.55 }}>
      {steps.map((s, i) => {
        const k = spring({ frame: frame - s.at, fps, config: { damping: 15 } });
        const done = s.doneAt != null && frame >= s.doneAt;
        const pop = s.doneAt != null ? spring({ frame: frame - s.doneAt, fps, config: { damping: 9, stiffness: 220 } }) : 0;
        const dot = done ? (s.bad ? C.bad : C.good) : color;
        if (frame < s.at) return null;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: size * 0.5, opacity: k, transform: `translateX(${(1 - k) * 50}px)` }}>
            <div style={{ width: size, height: size, borderRadius: size / 2, background: dot, color: '#000', fontFamily: F.sans, fontWeight: 800, fontSize: size * 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 + 0.25 * Math.sin(Math.min(pop, 1) * Math.PI)})` }}>
              {done ? (s.bad ? '✕' : '✓') : i + 1}
            </div>
            <div style={{ fontFamily: F.sans, fontSize: size, fontWeight: 600, color: C.text, textShadow: '0 2px 18px rgba(0,0,0,.9)' }}>
              {s.text}
              {s.note && <span style={{ fontFamily: F.mono, fontSize: size * 0.55, color: done && s.bad ? C.badText : C.text3, marginLeft: 14 }}>{s.note}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A rounded title pill pinned over footage, like a game title card.
export function Chip({ children, at = 0, x = 60, y = 50, color = C.accent, icon }) {
  const k = useSpring(at, { damping: 14 });
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${0.8 + 0.2 * k})`, transformOrigin: 'left center', opacity: k, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px', borderRadius: 999, background: 'rgba(10,10,10,.82)', border: `1px solid ${color}66`, backdropFilter: 'blur(8px)', fontFamily: F.sans, fontWeight: 650, fontSize: 32, color: C.text }}>
      {icon}
      {children}
    </div>
  );
}

// Footage in a floating window. `src` is a file under public/; crop trims the app's menu bar.
// zoom/pan animate a slow push-in toward (fx, fy) in 0..1 frame coordinates.
export function Footage({ src, startFrom = 0, rate = 1, x = 0, y = 0, w = 1920, h = 1080, radius = 0, cropTop = 0, zoom = [1, 1], fx = 0.5, fy = 0.5, dur = 60, muted = true, style }) {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [0, dur], zoom, { ...clamp, easing: Easing.inOut(Easing.quad) });
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: radius, overflow: 'hidden', background: '#000', ...style }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${z})`, transformOrigin: `${fx * 100}% ${fy * 100}%` }}>
        <OffthreadVideo
          src={staticFile(src)}
          startFrom={Math.round(startFrom * 30)}
          playbackRate={rate}
          muted={muted}
          style={{ position: 'absolute', left: 0, top: -cropTop * (h / (1080 - cropTop)), width: w, height: h + cropTop * (h / (1080 - cropTop)), objectFit: 'cover' }}
        />
      </div>
    </div>
  );
}

export function PartnerMark({ name, size = 44 }) {
  const src = { neatlogs: 'logos/neatlogs.png', entire: 'logos/entire.svg', cfo: 'logos/cfo-full.svg' }[name];
  const label = { neatlogs: 'neatlogs', entire: 'Entire', cfo: 'cfo.ai' }[name];
  const color = { neatlogs: C.neatlogs, entire: C.entire, cfo: C.good }[name];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
      <Img src={staticFile(src)} style={{ height: name === 'cfo' ? size * 0.42 : size, width: 'auto', borderRadius: name === 'neatlogs' ? size * 0.22 : 0 }} />
      <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: size * 0.72, color }}>{label}</span>
    </div>
  );
}

export function Caption({ children, at = 0, y = 930, size = 54 }) {
  const k = useSpring(at, { damping: 18 });
  return (
    <AbsoluteFill style={{ alignItems: 'center', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: y, opacity: k, transform: `translateY(${(1 - k) * 24}px)`, fontFamily: F.sans, fontWeight: 700, fontSize: size, color: C.text, textShadow: '0 4px 30px rgba(0,0,0,.95)', textAlign: 'center' }}>
        {children}
      </div>
    </AbsoluteFill>
  );
}

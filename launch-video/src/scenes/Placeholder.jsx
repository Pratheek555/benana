import React from 'react';
import { AbsoluteFill } from 'remotion';
import { C, F } from '../theme';

export const Placeholder = ({ title, sub, color = C.accent }) => (
  <AbsoluteFill style={{ background: C.bg, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
    <div style={{ fontFamily: F.sans, fontSize: 84, fontWeight: 700, color: C.text }}>{title}</div>
    <div style={{ fontFamily: F.mono, fontSize: 30, color }}>{sub}</div>
  </AbsoluteFill>
);

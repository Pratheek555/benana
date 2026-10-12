import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Lockup } from '../Logo';
import { C } from '../theme';

export const LogoCard = () => (
  <AbsoluteFill style={{ background: C.bg, alignItems: 'center', justifyContent: 'center' }}>
    <Lockup size={1.3} start={5} />
  </AbsoluteFill>
);

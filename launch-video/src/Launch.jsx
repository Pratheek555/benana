import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { Pain } from './scenes/Pain';
import { LogoReveal } from './scenes/LogoReveal';
import { Build } from './scenes/Build';
import { Stuck } from './scenes/Stuck';
import { Market } from './scenes/Market';
import { Traction } from './scenes/Traction';
import { Cfo } from './scenes/Cfo';
import { Outro } from './scenes/Outro';
import { C, FPS } from './theme';
import T from './timeline.json';
import FOOTAGE from './footage.json';

// Section starts come from timeline.json, which music.cjs also reads, so cuts land on the music.
const f = (s) => Math.round(s * FPS);
export const LAUNCH_FRAMES = f(T.end);

const SCENES = [
  [0, T.drop, <Pain />],
  [T.drop, T.build, <LogoReveal />],
  [T.build, T.stuck, <Build appClip={FOOTAGE.buildApp} gameClip={FOOTAGE.game} />],
  [T.stuck, T.market, <Stuck failClip={FOOTAGE.stuckFail} passClip={FOOTAGE.stuckPass} />],
  [T.market, T.traction, <Market pageClip={FOOTAGE.market} />],
  [T.traction, T.cfo, <Traction />],
  [T.cfo, T.outro, <Cfo pageClip={FOOTAGE.cfo} stats={FOOTAGE.cfoStats} />],
  [T.outro, T.end, <Outro tiles={FOOTAGE.tiles} />],
];

export const Launch = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    {SCENES.map(([from, to, el], i) => (
      <Sequence key={i} from={f(from)} durationInFrames={f(to) - f(from)}>{el}</Sequence>
    ))}
    <Audio src={staticFile('music.wav')} />
  </AbsoluteFill>
);

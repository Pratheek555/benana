import React from 'react';
import { Composition } from 'remotion';
import { Launch, LAUNCH_FRAMES } from './Launch';
import { Pain, PAIN_FRAMES } from './scenes/Pain';
import { FPS } from './theme';
import { LogoCard } from './scenes/LogoCard';
import { Traction, TRACTION_FRAMES } from './scenes/Traction';

export const Root = () => (
  <>
    <Composition id="Launch" component={Launch} durationInFrames={LAUNCH_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="Pain" component={Pain} durationInFrames={PAIN_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="Logo" component={LogoCard} durationInFrames={90} fps={FPS} width={1920} height={1080} />
    <Composition id="Traction" component={Traction} durationInFrames={TRACTION_FRAMES} fps={FPS} width={1920} height={1080} />
  </>
);

import React from 'react';
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { C, F } from '../theme';
import { Caption, Checklist, Chip, Footage, clamp, useSpring } from '../ui';

// Beat 2: the agent builds the mod (sped-up app recording + the plan as a checklist),
// shows the texture it drew, then the mod running in a real Minecraft client.
export const BUILD_FRAMES = 450;
const GAME_AT = 210;

const STEPS = [
  { at: 8, doneAt: 40, text: 'Wrote the spec and in-game tests' },
  { at: 40, doneAt: 76, text: 'Wrote the Paper plugin' },
  { at: 76, doneAt: 108, text: 'Drew its own textures' },
  { at: 108, doneAt: 138, text: 'Compiled and deployed' },
  { at: 138, doneAt: 176, text: 'Playtested in real Minecraft' },
  { at: 176, doneAt: 196, text: 'Every check passed', note: '5/5' },
];

function Texture() {
  const k = useSpring(80, { damping: 12 });
  const frame = useCurrentFrame();
  const out = interpolate(frame, [GAME_AT - 20, GAME_AT - 8], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', left: 120 + 1020 - 150, top: 620, opacity: k * out, transform: `scale(${0.6 + 0.4 * k}) rotate(${(1 - k) * -12}deg)`, padding: 18, borderRadius: 18, background: C.raised, border: `1px solid ${C.accent}66`, boxShadow: '0 30px 80px rgba(0,0,0,.8)' }}>
      <Img src={staticFile('textures/thunder_hammer.png')} style={{ width: 200, height: 200, imageRendering: 'pixelated' }} />
      <div style={{ fontFamily: F.mono, fontSize: 18, color: C.text3, textAlign: 'center', marginTop: 8 }}>drawn by the agent</div>
    </div>
  );
}

export const Build = ({ appClip, gameClip }) => {
  const frame = useCurrentFrame();
  const win = useSpring(0, { damping: 18 });
  const toGame = interpolate(frame, [GAME_AT - 10, GAME_AT], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence durationInFrames={GAME_AT}>
        <AbsoluteFill style={{ opacity: toGame }}>
          {gameClip && <Footage {...gameClip} dur={GAME_AT} style={{ filter: 'blur(28px) brightness(.35)', transform: 'scale(1.1)' }} />}
          <AbsoluteFill style={{ background: 'radial-gradient(1200px 800px at 30% 50%, rgba(0,0,0,.2), rgba(0,0,0,.75))' }} />
          {appClip && (
            <Footage {...appClip} dur={GAME_AT} x={120} y={170} w={1020} h={574} radius={18}
              style={{ opacity: win, transform: `translateY(${(1 - win) * 40}px)`, border: '1px solid #2a2a2a', boxShadow: '0 40px 120px rgba(0,0,0,.8)' }} />
          )}
          <Checklist steps={STEPS} x={1210} y={250} size={34} />
          <Texture />
          <Chip at={2} x={120} y={80} icon={<span style={{ color: C.accent }}>●</span>}>One prompt → ThunderHammer</Chip>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={GAME_AT}>
        {gameClip ? <Footage {...gameClip} dur={BUILD_FRAMES - GAME_AT} zoom={[1.0, 1.08]} /> : <AbsoluteFill style={{ background: '#120a1e' }} />}
        <Chip at={4} icon={<Img src={staticFile('textures/black_hole_grenade.png')} style={{ width: 36, height: 36, imageRendering: 'pixelated' }} />}>Another Benana build: Black Hole Grenade</Chip>
        <Chip at={14} x={60} y={130} color={C.good} icon={<span style={{ color: C.good }}>●</span>}>Running in a real 1.21.4 client</Chip>
        <Caption at={30}>Tested by an AI player before you ever see it.</Caption>
      </Sequence>
    </AbsoluteFill>
  );
};

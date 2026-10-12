import React from 'react';
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame, Easing } from 'remotion';
import { C, F } from '../theme';
import { Caption, Chip, Footage, clamp, useSpring } from '../ui';

// Beat 3: the agent gets stuck, reads its Neatlogs trace and Entire checkpoint, and fixes itself.
// Data is ArrowTracer's real run (mod_mv3g59vw): attempt 1 failed bow-shot-reports-hit, attempt 3 passed.
export const STUCK_FRAMES = 300;
const FIX_AT = 180; // timeline.fixed - timeline.stuck

function Card({ at, y, color, logo, title, children }) {
  const k = useSpring(at, { damping: 15 });
  return (
    <div style={{ position: 'absolute', left: 120, top: y, width: 640, padding: '22px 26px', borderRadius: 18, background: C.panel, border: `1px solid ${color}55`, boxShadow: `0 0 50px ${color}18`, opacity: k, transform: `translateX(${(1 - k) * -80}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        {logo}
        <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 30, color }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

// A trace waterfall: spans as bars, the playtest span that measured the bad hit in red.
function Spans({ at }) {
  const frame = useCurrentFrame();
  const rows = [['builder · opus', 0, 0.32], ['compile + deploy', 0.32, 0.12], ['playtester · sonnet', 0.44, 0.5, true], ['  shoot_bow → hit 1.3 blocks', 0.62, 0.2, true]];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(([name, start, len, bad], i) => {
        const g = interpolate(frame, [at + 8 + i * 5, at + 22 + i * 5], [0, 1], clamp);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 250, fontFamily: F.mono, fontSize: 17, color: bad ? C.badText : C.text3, whiteSpace: 'pre' }}>{name}</div>
            <div style={{ position: 'relative', flex: 1, height: 14 }}>
              <div style={{ position: 'absolute', left: `${start * 100}%`, width: `${len * 100 * g}%`, height: 14, borderRadius: 4, background: bad ? C.bad : C.neatlogs }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Wire({ from, at, color }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const [x1, y1] = from, x2 = 1150, y2 = 520;
  const d = `M${x1},${y1} C${x1 + 200},${y1} ${x2 - 200},${y2} ${x2},${y2}`;
  return <path d={d} stroke={color} strokeWidth={3} fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} opacity={0.85} />;
}

function Diagnose() {
  const frame = useCurrentFrame();
  const fixer = useSpring(52, { damping: 14 });
  const lesson = 'Trace along the arrow\'s velocity to the hit, not its first-tick position.';
  const typed = lesson.slice(0, Math.max(0, Math.floor((frame - 74) * 2.4)));
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 800px at 60% 50%, #0a1418 0%, ${C.bg} 70%)` }}>
      <Card at={0} y={150} color={C.bad} logo={<div style={{ width: 40, height: 40, borderRadius: 20, background: C.bad, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontFamily: F.sans, fontSize: 22 }}>✕</div>} title="Playtest evidence">
        <div style={{ fontFamily: F.mono, fontSize: 20, lineHeight: 1.6, color: C.text2 }}>
          bow-shot-reports-hit<br />expected <span style={{ color: C.text }}>6–14 blocks</span> · measured <span style={{ color: C.badText }}>1.3 blocks</span>
        </div>
      </Card>
      <Card at={12} y={385} color={C.neatlogs} logo={<Img src={staticFile('logos/neatlogs.png')} style={{ width: 40, height: 40, borderRadius: 9 }} />} title="Neatlogs trace">
        <Spans at={12} />
      </Card>
      <Card at={24} y={680} color={C.entire} logo={<Img src={staticFile('logos/entire.svg')} style={{ width: 40, height: 40 }} />} title="Entire checkpoint">
        <div style={{ fontFamily: F.mono, fontSize: 20, lineHeight: 1.6, color: C.text2 }}>
          <span style={{ color: C.entire }}>01M4MTPSX2Y5</span> · 615f51d · builder<br />prompt, transcript and the exact code it wrote
        </div>
      </Card>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <Wire from={[760, 230]} at={40} color={C.bad} />
        <Wire from={[760, 500]} at={44} color={C.neatlogs} />
        <Wire from={[760, 770]} at={48} color={C.entire} />
      </svg>
      <div style={{ position: 'absolute', left: 1150, top: 400, width: 660, padding: '28px 32px', borderRadius: 22, background: C.raised, border: `1px solid ${C.accent}66`, opacity: fixer, transform: `scale(${0.85 + 0.15 * fixer})`, transformOrigin: 'left center' }}>
        <div style={{ fontFamily: F.sans, fontWeight: 750, fontSize: 36, color: C.accent }}>Fixer agent</div>
        <div style={{ fontFamily: F.mono, fontSize: 18, color: C.text3, marginTop: 4 }}>reads all three, writes a lesson, patches the plugin</div>
        <div style={{ marginTop: 18, fontFamily: F.sans, fontSize: 28, lineHeight: 1.4, color: C.text, minHeight: 80 }}>
          {typed && <><span style={{ color: C.text3 }}>Lesson: </span>{typed}</>}
        </div>
      </div>
    </AbsoluteFill>
  );
}

export const Stuck = ({ failClip, passClip }) => {
  const frame = useCurrentFrame();
  const flash = frame < FIX_AT ? 0 : interpolate(frame, [FIX_AT, FIX_AT + 8], [0.35, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence durationInFrames={60}>
        {failClip ? <Footage {...failClip} dur={60} /> : <AbsoluteFill style={{ background: '#140606' }} />}
        <AbsoluteFill style={{ background: 'rgba(80,0,0,.18)' }} />
        <Chip at={4} color={C.bad} icon={<span style={{ color: C.bad }}>●</span>}>ArrowTracer · attempt 1 failed</Chip>
        <Caption at={10}>Sometimes the agent gets stuck.</Caption>
      </Sequence>
      <Sequence from={60} durationInFrames={FIX_AT - 60}>
        <Diagnose />
      </Sequence>
      <Sequence from={FIX_AT}>
        {passClip ? <Footage {...passClip} dur={120} /> : <AbsoluteFill style={{ background: '#06140c' }} />}
        <Chip at={2} color={C.good} icon={<span style={{ color: C.good }}>●</span>}>4/4 checks passing · fixed itself</Chip>
        <Caption at={8}>It reads its own trace, rewinds, and fixes it.</Caption>
      </Sequence>
      <AbsoluteFill style={{ background: C.good, opacity: flash, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};

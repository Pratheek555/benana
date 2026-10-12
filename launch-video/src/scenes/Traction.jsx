import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F } from '../theme';

// Building in public: a real question from a real account, answered in the thread.
// Text matches https://x.com/PressX_Global/status/2109273926962483588 exactly.
export const TRACTION_FRAMES = 150;

const X = { bg: '#000', line: '#2f3336', name: '#e7e9ea', dim: '#71767b', pink: '#f91880', blue: '#1d9bf0' };

function Badge() {
  return (
    <svg width="26" height="26" viewBox="0 0 22 22" style={{ marginLeft: 4 }}>
      <path fill="#e2b719" d="M20.4 11c0-1.4-.8-2.6-2-3.2.4-1.3.1-2.8-.9-3.8s-2.4-1.3-3.8-.9C13.1 1.9 11.9 1.1 10.5 1.1S7.9 1.9 7.3 3.1c-1.3-.4-2.8-.1-3.8.9s-1.3 2.4-.9 3.8C1.4 8.4.6 9.6.6 11s.8 2.6 2 3.2c-.4 1.3-.1 2.8.9 3.8s2.4 1.3 3.8.9c.6 1.2 1.8 2 3.2 2s2.6-.8 3.2-2c1.3.4 2.8.1 3.8-.9s1.3-2.4.9-3.8c1.2-.6 2-1.8 2-3.2z" />
      <path fill="#000" d="M9.4 15.2 5.8 11.6l1.4-1.4 2.2 2.2 5-5 1.4 1.4z" />
    </svg>
  );
}

const Icon = ({ d }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" style={{ verticalAlign: -6, marginRight: 8 }}><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
);
const REPLY = "M4 11a7 7 0 0 1 7-7h2a7 7 0 0 1 0 14h-1l-5 3v-4a7 7 0 0 1-3-6z";
const VIEWS = "M5 20V11M10 20V5M15 20v-8M20 20V8";

function Post({ avatar, name, handle, badge, text, likes, views, liked, enter, last }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - enter, fps, config: { damping: 16 } });
  // The heart pops when the like lands.
  const pop = liked ? spring({ frame: frame - enter - 22, fps, config: { damping: 7, stiffness: 200 } }) : 0;
  const isLiked = liked && frame > enter + 22;
  return (
    <div style={{ display: 'flex', gap: 22, opacity: k, transform: `translateY(${(1 - k) * 40}px)` }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Img src={staticFile(avatar)} style={{ width: 84, height: 84, borderRadius: 42 }} />
        {!last && <div style={{ width: 3, flex: 1, background: X.line, marginTop: 8 }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', fontFamily: F.sans, fontSize: 32 }}>
          <span style={{ color: X.name, fontWeight: 700 }}>{name}</span>
          {badge && <Badge />}
          <span style={{ color: X.dim, marginLeft: 12 }}>{handle} · Oct 11</span>
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 36, color: X.name, lineHeight: 1.4, marginTop: 8, whiteSpace: 'pre-line' }}>{text}</div>
        <div style={{ display: 'flex', gap: 90, marginTop: 20, fontFamily: F.sans, fontSize: 26, color: X.dim }}>
          <span><Icon d={REPLY} />{liked ? 1 : ''}</span>
          <span style={{ color: isLiked ? X.pink : X.dim, display: 'inline-block', transform: `scale(${1 + 0.35 * Math.sin(Math.min(pop, 1) * Math.PI)})` }}>
            {isLiked ? '♥' : '♡'} {isLiked ? likes : likes - (liked ? 1 : 0)}
          </span>
          <span><Icon d={VIEWS} />{views}</span>
        </div>
      </div>
    </div>
  );
}

export const Traction = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = spring({ frame, fps, config: { damping: 18 } });
  const out = interpolate(frame, [TRACTION_FRAMES - 12, TRACTION_FRAMES], [1, 0], { extrapolateLeft: 'clamp' });
  const zoom = interpolate(frame, [0, TRACTION_FRAMES], [1, 1.05]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 55%, #0d1520 0%, ${C.bg} 75%)`, alignItems: 'center', justifyContent: 'center', opacity: out }}>
      <div style={{ position: 'absolute', top: 90, fontFamily: F.mono, fontSize: 28, letterSpacing: 6, color: C.accent, opacity: head }}>
        BUILT IN PUBLIC · #NEATHACK
      </div>
      <div style={{ transform: `scale(${zoom})`, width: 1240, padding: '44px 52px', borderRadius: 28, background: X.bg, border: `1px solid ${X.line}`, boxShadow: '0 40px 120px rgba(29,155,240,.12)' }}>
        <Post
          avatar="avatar-pressx.png" name="PressX" handle="@PressX_Global" badge enter={6}
          text="Which Minecraft versions does benana support?" likes={1} views={18} liked
        />
        <Post
          avatar="avatar-pratheek.png" name="Pratheek Ravikumar" handle="@Pratheekr5" enter={40} last
          text={'Currently we support 1.21.4, but we will be rolling support to other versions soon!\n\nPlease do waitlist, so that we could notify you :)'}
          likes={1} views={11}
        />
      </div>
    </AbsoluteFill>
  );
};

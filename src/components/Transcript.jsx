import React, { useEffect, useRef, useState } from 'react';
import { call, on } from '../api.js';

const GLYPH = { agent: '›', tool: '⚙', verify: '◆', you: '»', user: '»' };

export default function Transcript({ run, session }) {
  const [lines, setLines] = useState([]);
  const box = useRef(null);
  const runId = run?.id;

  useEffect(() => {
    setLines([]);
    if (runId) {
      call('run:get', { id: runId }).then((r) => setLines(r?.transcript || [])).catch(() => {});
      return on('transcript', ({ id, line }) => id === runId && setLines((l) => [...l, line]));
    }
    if (session) {
      const load = () => call('sessions:transcript', { kind: session.kind, id: session.id }).then(setLines).catch(() => {});
      load();
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
    return undefined;
  }, [runId, session?.id]);

  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length]);

  const title = run ? `${run.id} · ${run.kind} · ${run.origin}` : session ? `${session.kind === 'codex' ? 'Codex' : 'Claude Code'} · attached · ${session.cwd}` : 'select an agent';
  return (
    <div className="transcript">
      <div className="bar">
        <span>live transcript <span className="faint">(read-only)</span> · <span className="bee">{title}</span></span>
        <span className="spacer" />
        {run?.sessionId && <span className="faint">session {run.sessionId.slice(0, 8)}</span>}
        {run?.worktree && <a className="bee" style={{ cursor: 'pointer' }} onClick={() => window.benana.invoke('open-path', run.worktree)}>worktree ↗</a>}
        <a className="bee" style={{ cursor: 'pointer' }} onClick={() => window.benana.openExternal('https://app.neatlogs.com')}>neatlogs ↗</a>
      </div>
      <div className="lines" ref={box}>
        {lines.map((l, i) => (
          <div className={`line ${l.role}`} key={i}><span className="who">{GLYPH[l.role] || '·'}</span>{l.text}</div>
        ))}
        {!lines.length && <div className="faint">Nothing yet.</div>}
      </div>
    </div>
  );
}

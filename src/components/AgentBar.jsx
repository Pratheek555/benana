import React, { useState } from 'react';

const LIVE = ['running', 'verifying', 'preparing'];

function dotClass(a) {
  if (a.origin === 'attached') return a.active ? 'on' : '';
  if (LIVE.includes(a.status)) return 'on';
  if (a.status === 'passed') return 'ok';
  if (a.status === 'failed') return 'bad';
  return '';
}

export default function AgentBar({ agents, selected, onSelect, onSpawn, onConnect }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`agentbar ${open ? 'open' : ''}`}>
      <div className="head">
        {open && <span>agents · {agents.length}</span>}
        <button className="tab" onClick={() => setOpen(!open)} title="toggle">{open ? '«' : '»'}</button>
      </div>
      <div style={{ overflow: 'auto', display: 'grid', gap: 4 }}>
        {agents.map((a) => {
          const key = `${a.origin}:${a.id}`;
          const sel = selected && `${selected.origin}:${selected.id}` === key;
          const label = a.origin === 'attached' ? (a.kind === 'codex' ? 'cx' : 'cc') : a.id.slice(-2);
          return (
            <div key={key} className={`agent ${sel ? 'sel' : ''}`} onClick={() => onSelect({ origin: a.origin, id: a.id, kind: a.kind })} title={a.task || a.title}>
              <div className="glyph">{label}<span className={`dot ${dotClass(a)}`} /></div>
              {open && (
                <div className="meta">
                  <div className="name">{a.origin === 'attached' ? `${a.kind === 'codex' ? 'Codex' : 'Claude Code'}` : `${a.id} · ${a.kind}`}</div>
                  <div className="sub">
                    {a.origin === 'attached' ? <><span className="bee">attached</span> · {a.active ? 'live' : 'idle'} · {(a.cwd || '').split('/').pop()}</> : <>{a.origin} · {a.status}</>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!agents.length && open && <div className="empty">No agents yet. Start one from the brief box, or connect your local Claude Code / Codex.</div>}
      </div>
      <div className="actions">
        <button className="iconbtn" onClick={onSpawn} title="spawn subagent"><span className="ic bee">+</span>{open && 'spawn subagent'}</button>
        <button className="iconbtn" onClick={onConnect} title="connect local sessions"><span className="ic">⇄</span>{open && 'connect local sessions'}</button>
      </div>
    </div>
  );
}

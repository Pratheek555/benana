import React, { useState } from 'react';
import { call } from '../api.js';

export default function Brief({ run, session, project, notify, onStarted }) {
  const [text, setText] = useState('');
  const [agent, setAgent] = useState('claude');
  const target = run ? `tell ${run.id}` : session ? `resume ${session.kind === 'codex' ? 'codex' : 'claude'} session in benana` : 'new task';

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      if (run) await call('run:brief', { id: run.id, text: t });
      else if (session) onStarted(await call('sessions:resume', { kind: session.kind, id: session.id, cwd: session.cwd, brief: t }));
      else {
        if (!project.repoPath) throw new Error('Set a local checkout path (reopen the project) to run agents.');
        onStarted(await call('run:start', { task: t, agent }));
      }
    } catch (e) { notify(e.message, 'error'); setText(t); }
  };

  return (
    <div className="brief">
      <span className="prompt">brief ›</span>
      {!run && !session && (
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
      )}
      <input id="brief-input" value={text} placeholder={`${target}: describe what you want…`} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
      <button className="btn sm" onClick={send} disabled={!text.trim()}>⏎</button>
    </div>
  );
}

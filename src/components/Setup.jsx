import React, { useState } from 'react';
import { call } from '../api.js';

export default function Setup({ config, onOpen, busy, toast }) {
  const last = config?.last || {};
  const [repo, setRepo] = useState(last.repo || '');
  const [repoPath, setRepoPath] = useState(last.repoPath || '');
  const [deep, setDeep] = useState(false);
  const env = config?.env || {};

  return (
    <div className="setup">
      <div className="box">
        <h1>benana</h1>
        <div className="lede">Feel the flow of intent before you write a line. Point benana at a repo; it builds the intent graph from its history and wires your agents into it.</div>
        <div className="field">
          <label>GitHub repo</label>
          <div className="in"><input className="input" placeholder="owner/name  e.g. expressjs/cors" value={repo} onChange={(e) => setRepo(e.target.value.trim())} /></div>
        </div>
        <div className="field">
          <label>Local checkout (agents work in worktrees of this)</label>
          <div className="in">
            <input className="input" placeholder="/path/to/your/clone (optional for browsing)" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} />
            <button className="btn ghost" onClick={async () => setRepoPath((await call('project:pick-path')) || repoPath)}>Browse</button>
          </div>
        </div>
        <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Deep extraction: asks your local <span className="mono bee">claude</span> to explain why decisions and dead ends happened</span>
        </label>
        <div className="checks">
          <span className={`pill ${env.github ? 'ok' : ''}`}>GitHub {env.github ? 'authed' : 'anonymous'}</span>
          <span className={`pill ${env.cloudflare ? 'ok' : 'bad'}`}>Artifacts {env.cloudflare ? 'ready' : 'no token'}</span>
          <span className={`pill ${env.neatlogs ? 'ok' : ''}`}>Neatlogs {env.neatlogs ? 'ready' : 'not set'}</span>
        </div>
        <button className="btn" disabled={!repo || Boolean(busy)} onClick={() => onOpen({ repo, repoPath, deep })}>
          {busy ? <><span className="spin" /> {busy}</> : 'Open project →'}
        </button>
      </div>
      {toast && <div className={`toast ${toast.level}`}>{toast.text}</div>}
    </div>
  );
}

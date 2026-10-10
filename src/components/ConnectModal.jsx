import React, { useEffect, useState } from 'react';
import { call } from '../api.js';

export default function ConnectModal({ onClose, notify }) {
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  useEffect(() => { call('sessions:plan').then(setPlan).catch((e) => notify(e.message, 'error')); }, [notify]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Connect your local agents</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          <b className="bee">Observe</b> is already on: benana reads Claude Code (<span className="mono">~/.claude/projects</span>) and Codex (<span className="mono">~/.codex/sessions</span>) transcripts for this repo and lists them as <i>attached</i>.
          <br /><b className="bee">Assist</b> registers the <span className="mono">benana-intent</span> MCP server with your own agents, so every session you start in a terminal gets <span className="mono">intent_context / intent_check / intent_record</span>. These exact changes will be made:
        </div>
        {plan && (
          <>
            <div className="mono faint" style={{ marginTop: 12, fontSize: 11 }}>CLAUDE CODE (user scope)</div>
            <pre>{plan.claude}</pre>
            <div className="mono faint" style={{ fontSize: 11 }}>CODEX ({plan.codexFile}, backed up first)</div>
            <pre>{plan.codex}</pre>
          </>
        )}
        {result && <pre>{`claude: ${result.claude.ok ? 'ok' : 'failed'} ${result.claude.out}\ncodex: ${result.codex.ok ? 'ok' : 'failed'} ${result.codex.out}`}</pre>}
        <div className="actions">
          <button className="btn danger" onClick={async () => { setResult(await call('sessions:uninstall')); notify('removed benana from your agents'); }}>Remove</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn" onClick={async () => { try { setResult(await call('sessions:install')); notify('benana-intent connected'); } catch (e) { notify(e.message, 'error'); } }}>Connect</button>
        </div>
      </div>
    </div>
  );
}

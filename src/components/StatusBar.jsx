import React, { useEffect, useState } from 'react';
import { call, fmtTokens } from '../api.js';

export default function StatusBar({ project, agents, tokens, conflicts, integrations, busy }) {
  const [head, setHead] = useState('');
  useEffect(() => { call('graph:history').then((h) => setHead(h.at(-1)?.sha?.slice(0, 7) || '')).catch(() => {}); }, [project?.nodes, project?.edges]);
  const active = agents.filter((a) => ['running', 'verifying', 'preparing'].includes(a.status) || a.active).length;
  const attached = agents.filter((a) => a.origin === 'attached').length;
  const i = integrations || {};

  return (
    <div className="status">
      <span className="brand">benana</span>
      <span className="seg">▸ <b>{project.repo}</b></span>
      <span className="sep" />
      <span className="seg">harness <b className="bee">v{project.harness?.version}</b></span>
      <span className="seg">intent@<b>{head || '—'}</b> <span className="faint">{project.nodes}n · {project.edges}e</span></span>
      <span className="sep" />
      <span className="seg"><span className={`dot ${active ? 'on' : ''}`} /> <b>{active}</b> active · {attached} attached</span>
      <span className="seg"><b>{fmtTokens(tokens)}</b> tok</span>
      <span className={`seg ${conflicts ? 'bad' : ''}`}>⚠ <b className={conflicts ? 'bad' : ''}>{conflicts}</b> intent conflicts</span>
      {busy && <span className="seg bee"><span className="spin" /> {busy}</span>}
      <span className="spacer" />
      <span className="seg" title={i.artifacts?.configured ? `${i.artifacts.namespace}/${i.artifacts.repo}` : 'CLOUDFLARE_API_TOKEN not set'}>
        <span className={`dot ${i.artifacts?.configured ? 'ok' : 'bad'}`} /> artifacts
      </span>
      <span className="seg" title={i.neatlogs?.error || [
        i.neatlogs?.tracing ? 'tracing on' : 'tracing off (set NEATLOGS_API_KEY)',
        i.neatlogs?.configured ? 'trace read API on' : 'trace read off (set NEATLOGS_TOKEN + NEATLOGS_PROJECT_ID)',
      ].join(' · ')}>
        <span className={`dot ${i.neatlogs?.ok ? 'ok' : i.neatlogs?.error ? 'bad' : ''}`} /> neatlogs
      </span>
      <span className="seg" title={i.entire?.installed ? i.entire.version : 'entire CLI not installed'}>
        <span className={`dot ${i.entire?.installed ? 'ok' : ''}`} /> entire
      </span>
    </div>
  );
}

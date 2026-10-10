import React, { useState } from 'react';
import { call, ago, fmtTokens } from '../api.js';
import ImprovePanel from './ImprovePanel.jsx';

const TABS = ['all', 'inbox', 'runs', 'verify', 'improve'];

const tokensOf = (u = {}) => (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);

export default function LoopConsole({ inbox, runs, proposals, overview, budgetStatus, project, selected, onSelect, notify, setBusy, onFocusNodes, onRefresh }) {
  const [tab, setTab] = useState('all');
  const runList = Object.values(runs).sort((a, b) => b.startedAt - a.startedAt);
  const show = (t) => tab === 'all' || tab === t;
  const counts = { inbox: inbox.filter((i) => i.state === 'new').length, runs: runList.length, verify: runList.filter((r) => r.verify?.length).length, improve: proposals.filter((p) => p.status === 'open' || p.status === 'trial').length };

  const start = async (issue) => {
    try {
      const r = await call('run:start', { task: `Resolve issue #${issue.number}: ${issue.title}`, issueNumber: issue.number });
      onSelect({ origin: 'native', id: r.id });
    } catch (e) { notify(e.message, 'error'); }
  };

  return (
    <div className="loopwrap">
      <div className="tabs">
        <span className="mono faint" style={{ marginRight: 8, fontSize: 11 }}>LOOP CONSOLE</span>
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t}{counts[t] ? <span className="n">{counts[t]}</span> : null}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={async () => { setBusy('Re-extracting intent…'); try { await call('graph:ingest', {}); } catch (e) { notify(e.message, 'error'); } setBusy(''); }}>re-ingest</button>
        <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={onRefresh}>⟳</button>
      </div>
      <div className="loops">
        {show('inbox') && (
          <div className="section">
            <h3><span className="tag">L3</span> inbox <span className="right">GitHub · polls every 2m · label <span className="bee">benana:auto</span> to auto-start</span></h3>
            {inbox.slice(0, tab === 'inbox' ? 30 : 4).map((i) => (
              <div className="row" key={i.number}>
                <span className="mono bee">#{i.number}</span>
                <div style={{ minWidth: 0 }}><div className="t">{i.title}</div><div className="s">{i.labels.join(' · ') || 'no labels'} · {ago(i.at)} ago</div></div>
                {i.state === 'new'
                  ? <button className="btn sm" disabled={!project.repoPath} title={project.repoPath ? '' : 'set a local checkout to run agents'} onClick={() => start(i)}>start ▸</button>
                  : <span className={`pill ${i.state === 'error' ? 'bad' : 'bee'}`} title={i.waiting || ''}>{i.state}</span>}
              </div>
            ))}
            {!inbox.length && <div className="empty">No open issues fetched yet.</div>}
          </div>
        )}

        {show('runs') && (
          <div className="section">
            <h3><span className="tag">L1</span> runs <span className="right">worktree + intent fork per attempt</span></h3>
            {runList.map((r) => (
              <div className={`row ${selected?.id === r.id ? 'sel' : ''}`} key={r.id} onClick={() => onSelect({ origin: 'native', id: r.id })} style={{ cursor: 'pointer' }}>
                <span className={`dot ${['running', 'verifying', 'preparing'].includes(r.status) ? 'on' : r.status === 'passed' ? 'ok' : r.status === 'failed' ? 'bad' : ''}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="t"><span className="mono">{r.id}</span> · {r.kind} · {r.task}</div>
                  <div className="s">
                    {r.origin} · attempt {r.attempt} · step {r.step} · harness v{r.harnessVersion}{r.arm === 'candidate' ? <span className="warn"> trial</span> : null}
                    {tokensOf(r.usage) ? <> · {fmtTokens(tokensOf(r.usage))} tok</> : null}
                    {r.compactions ? <> · {r.compactions} compaction{r.compactions > 1 ? 's' : ''}</> : null}
                    {r.pr?.url ? <> · <a className="bee" onClick={(e) => { e.stopPropagation(); window.benana.openExternal(r.pr.url); }}>PR #{r.pr.number}</a></> : null}
                    {r.context?.length ? <> · intent.context → <a className="bee" onClick={(e) => { e.stopPropagation(); onFocusNodes(r.context.map((c) => c.id)); }}>{r.context.length} nodes</a></> : null}
                    {r.artifactsFork ? <> · fork <span className="mono">{r.artifactsFork}</span></> : null}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`pill ${r.status === 'passed' ? 'ok' : r.status === 'failed' ? 'bad' : 'bee'}`}>{r.status}</span>
                  {['running', 'preparing'].includes(r.status) && <button className="btn danger sm" onClick={(e) => { e.stopPropagation(); call('run:stop', { id: r.id }); }}>stop</button>}
                  {r.status === 'passed' && r.origin === 'native' && !r.pr && <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setBusy('Opening draft PR…'); call('run:pr', { id: r.id }).then((p) => notify(`draft PR #${p.number} opened`)).catch((err) => notify(err.message, 'error')).finally(() => setBusy('')); }}>PR ▸</button>}
                </div>
              </div>
            ))}
            {!runList.length && <div className="empty">No runs. Type a task in the brief box below, or start an inbox issue.</div>}
          </div>
        )}

        {show('verify') && (
          <div className="section">
            <h3><span className="tag">L2</span> verify <span className="right">graders: changes · diff scope · tests · intent.check</span></h3>
            {runList.filter((r) => r.verify?.length).map((r) => {
              const last = r.verify.at(-1);
              return (
                <div className="row" key={r.id} style={{ gridTemplateColumns: '1fr' }}>
                  <div>
                    <div className="s mono">{r.id} · attempt {last.attempt}/{project.harness?.graders?.maxAttempts}</div>
                    <div style={{ marginTop: 4 }}>
                      {last.results.map((x) => <span className="grader" key={x.grader} title={x.detail}><span className={x.pass ? 'ok' : 'bad'}>{x.pass ? '✔' : '✖'}</span>{x.grader}</span>)}
                    </div>
                    {last.results.filter((x) => x.conflicts?.length).flatMap((x) => x.conflicts).map((c) => (
                      <div className="conflict" key={c.node}>
                        <span className="bad">✖ {c.kind.replace(/_/g, ' ')}</span> · <a onClick={() => onFocusNodes([c.node])}>{c.node}</a> {c.title}
                        {c.reason ? <div className="muted">{c.reason}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!runList.some((r) => r.verify?.length) && <div className="empty">Grader results appear here when an attempt finishes. Failures are sent back to the agent automatically.</div>}
          </div>
        )}

        {show('improve') && <ImprovePanel project={project} proposals={proposals} overview={overview} budgetStatus={budgetStatus} notify={notify} setBusy={setBusy} />}
      </div>
    </div>
  );
}

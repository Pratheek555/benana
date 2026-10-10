import React, { useState } from 'react';
import { call, ago } from '../api.js';

const TABS = ['all', 'inbox', 'runs', 'verify', 'improve'];

export default function LoopConsole({ inbox, runs, proposals, project, selected, onSelect, notify, setBusy, onFocusNodes, onRefresh }) {
  const [tab, setTab] = useState('all');
  const runList = Object.values(runs).sort((a, b) => b.startedAt - a.startedAt);
  const show = (t) => tab === 'all' || tab === t;
  const counts = { inbox: inbox.filter((i) => i.state === 'new').length, runs: runList.length, verify: runList.filter((r) => r.verify?.length).length, improve: proposals.filter((p) => p.status === 'open').length };

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
                  : <span className="pill bee">{i.state}</span>}
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
                    {r.origin} · attempt {r.attempt} · step {r.step} · harness v{r.harnessVersion}
                    {r.context?.length ? <> · intent.context → <a className="bee" onClick={(e) => { e.stopPropagation(); onFocusNodes(r.context.map((c) => c.id)); }}>{r.context.length} nodes</a></> : null}
                    {r.artifactsFork ? <> · fork <span className="mono">{r.artifactsFork}</span></> : null}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`pill ${r.status === 'passed' ? 'ok' : r.status === 'failed' ? 'bad' : 'bee'}`}>{r.status}</span>
                  {['running', 'preparing'].includes(r.status) && <button className="btn danger sm" onClick={(e) => { e.stopPropagation(); call('run:stop', { id: r.id }); }}>stop</button>}
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

        {show('improve') && (
          <div className="section">
            <h3><span className="tag">L4</span> improve <span className="right">analyst reads runs (+ Neatlogs) → proposes harness PRs</span></h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className="btn sm" onClick={async () => {
                setBusy('Analyst reading runs…');
                try { const r = await call('improve:analyze', {}); notify(r.proposal ? `proposal: ${r.proposal.title}` : `no change proposed (${r.stats.runs} runs analysed)`); }
                catch (e) { notify(e.message, 'error'); }
                setBusy('');
              }}>run analyst</button>
              <span className="s muted mono" style={{ alignSelf: 'center' }}>harness v{project.harness?.version} · {project.harness?.rules?.length || 0} learned rules</span>
            </div>
            {proposals.map((p) => (
              <div className="row" key={p.id} style={{ gridTemplateColumns: '1fr auto' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="t">harness PR <span className="mono bee">{p.id}</span> “{p.title}”</div>
                  <div className="s">{p.rationale}</div>
                  <div className="s mono">evidence: {p.evidence?.runs} runs · {p.evidence?.retries} retries · {p.evidence?.neatlogsTraces} neatlogs traces{p.touchesGraders ? <span className="warn"> · changes graders</span> : null}</div>
                  {p.patch?.addRules?.map((r) => <div className="s mono" key={r}><span className="ok">+ rule</span> {r}</div>)}
                  {p.patch?.graders && Object.entries(p.patch.graders).map(([k, v]) => <div className="s mono" key={k}><span className="warn">~ grader</span> {k} = {JSON.stringify(v)}</div>)}
                </div>
                {p.status === 'open' ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn sm" onClick={() => call('improve:decide', { id: p.id, approve: true }).then(() => notify(`harness updated`)).catch((e) => notify(e.message, 'error'))}>approve</button>
                    <button className="btn ghost sm" onClick={() => call('improve:decide', { id: p.id, approve: false })}>reject</button>
                  </div>
                ) : <span className={`pill ${p.status === 'approved' ? 'ok' : ''}`}>{p.status}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

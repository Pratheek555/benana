import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call, on } from './api.js';
import Setup from './components/Setup.jsx';
import StatusBar from './components/StatusBar.jsx';
import AgentBar from './components/AgentBar.jsx';
import LoopConsole from './components/LoopConsole.jsx';
import Transcript from './components/Transcript.jsx';
import Brief from './components/Brief.jsx';
import GraphPanel from './components/GraphPanel.jsx';
import ConnectModal from './components/ConnectModal.jsx';

export default function App() {
  const [config, setConfig] = useState(null);
  const [project, setProject] = useState(null);
  const [runs, setRuns] = useState({});
  const [sessions, setSessions] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [overview, setOverview] = useState(null);
  const [budgetStatus, setBudgetStatus] = useState(null);
  const [selected, setSelected] = useState(null); // { origin: 'native'|'attached', id, kind }
  const [focusNodes, setFocusNodes] = useState([]);
  const [graphTick, setGraphTick] = useState(0);
  const [toast, setToast] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [integrations, setIntegrations] = useState(null);
  const [busy, setBusy] = useState('');

  const notify = useCallback((text, level = 'info') => {
    setToast({ text, level });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), level === 'error' ? 6000 : 3500);
  }, []);

  useEffect(() => {
    call('config:get').then((c) => {
      setConfig(c);
      if (c.autoOpen && c.last?.repo) open(c.last);
    }).catch(() => setConfig({}));
  }, []);

  useEffect(() => {
    const offs = [
      on('run', (r) => {
        setRuns((m) => ({ ...m, [r.id]: { ...m[r.id], ...r } }));
        if (['passed', 'failed', 'stopped'].includes(r.status)) call('budget:status').then(setBudgetStatus).catch(() => {});
      }),
      on('inbox', setInbox),
      on('proposals', setProposals),
      on('improve', setOverview),
      on('project', setProject),
      on('graph-changed', () => { setGraphTick((t) => t + 1); call('project:summary').then(setProject).catch(() => {}); }),
      on('log', (l) => (l.level !== 'info' || /pushed|synced|committed/.test(l.text)) && notify(l.text, l.level)),
    ];
    return () => offs.forEach((off) => off());
  }, [notify]);

  const refresh = useCallback(async () => {
    const [r, s, i, p, st, ov, b] = await Promise.all([
      call('run:list'), call('sessions:detect'), call('inbox:list'),
      call('improve:list').catch(() => []), call('status:integrations').catch(() => null),
      call('improve:overview').catch(() => null), call('budget:status').catch(() => null),
    ]);
    setOverview(ov);
    setBudgetStatus(b);
    setRuns(Object.fromEntries(r.map((x) => [x.id, x])));
    setSessions(s);
    setInbox(i);
    setProposals(p);
    setIntegrations(st);
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    refresh();
    const t = setInterval(() => call('sessions:detect').then(setSessions).catch(() => {}), 5000);
    // Integrations and budget change slowly; a minute is plenty and keeps API traffic low.
    const slow = setInterval(() => {
      call('status:integrations').then(setIntegrations).catch(() => {});
      call('budget:status').then(setBudgetStatus).catch(() => {});
    }, 60000);
    return () => { clearInterval(t); clearInterval(slow); };
  }, [project?.repo, refresh]);

  const open = async (args) => {
    setBusy('Opening project…');
    try {
      const p = await call('project:open', args);
      setProject(p);
      if (!p.nodes) {
        setBusy('Building intent graph from GitHub history…');
        setProject(await call('graph:ingest', { deep: args.deep }));
      }
    } catch (e) { notify(e.message, 'error'); }
    setBusy('');
  };

  const selectedRun = selected?.origin !== 'attached' ? runs[selected?.id] : null;
  const selectedSession = selected?.origin === 'attached' ? sessions.find((s) => s.id === selected.id) : null;

  useEffect(() => {
    if (selectedRun?.context) setFocusNodes(selectedRun.context.map((c) => c.id).concat((selectedRun.conflicts || []).map((c) => c.node), selectedRun.issue ? [`issue_${selectedRun.issue.number}`] : []));
  }, [selectedRun?.id, selectedRun?.context, selectedRun?.conflicts]);

  const agents = useMemo(() => [
    ...Object.values(runs).sort((a, b) => b.startedAt - a.startedAt).map((r) => ({ ...r, origin: r.origin || 'native' })),
    ...sessions.map((s) => ({ ...s, origin: 'attached' })),
  ], [runs, sessions]);

  const tokens = budgetStatus?.today ?? Object.values(runs).reduce((n, r) => n + (r.usage?.inputTokens || 0) + (r.usage?.outputTokens || 0), 0);
  const conflicts = Object.values(runs).reduce((n, r) => n + (r.conflicts?.length || 0), 0);

  if (!project) return <Setup config={config} onOpen={open} busy={busy} toast={toast} />;

  return (
    <div className="app">
      <StatusBar project={project} agents={agents} tokens={tokens} conflicts={conflicts} integrations={integrations} busy={busy} />
      <div className="body">
        <AgentBar agents={agents} selected={selected} onSelect={setSelected}
          onSpawn={() => { setSelected(null); document.getElementById('brief-input')?.focus(); }}
          onConnect={() => setConnectOpen(true)} />
        <div className="console">
          <LoopConsole
            inbox={inbox} runs={runs} proposals={proposals} overview={overview} budgetStatus={budgetStatus} sessions={sessions} project={project}
            selected={selected} onSelect={setSelected} notify={notify} setBusy={setBusy}
            onFocusNodes={setFocusNodes} onRefresh={refresh}
          />
          <Transcript run={selectedRun} session={selectedSession} />
          <Brief run={selectedRun} session={selectedSession} project={project} notify={notify}
            onStarted={(r) => setSelected({ origin: 'native', id: r.id })} />
        </div>
        <GraphPanel tick={graphTick} focus={focusNodes} onClearFocus={() => setFocusNodes([])} project={project} />
      </div>
      {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} notify={notify} />}
      {toast && <div className={`toast ${toast.level}`}>{toast.text}</div>}
    </div>
  );
}

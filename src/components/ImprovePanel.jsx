import React from 'react';
import { call, fmtTokens } from '../api.js';

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const tok = (x) => (x == null || !Number.isFinite(x) ? '—' : fmtTokens(Math.round(x)));

// Per-harness-version pass rate and tokens/run. Bars share one scale per metric.
function Timeline({ rows }) {
  if (!rows?.length) return <div className="empty">Per-version metrics appear once runs finish.</div>;
  const maxTok = Math.max(...rows.map((r) => r.tokensPerRun || 0), 1);
  return (
    <div className="tl">
      <div className="tl-head mono"><span>harness</span><span>pass rate</span><span>tokens / run</span><span>runs</span></div>
      {rows.map((r) => (
        <div className="tl-row mono" key={r.version}>
          <span>v{r.version.replace('*', '')}{r.version.endsWith('*') ? <span className="warn"> trial</span> : null}</span>
          <span className="bar"><i className="ok-bg" style={{ width: pct(r.passRate) }} /><em>{pct(r.passRate)}</em></span>
          <span className="bar"><i className="bee-bg" style={{ width: `${(100 * (r.tokensPerRun || 0)) / maxTok}%` }} /><em>{tok(r.tokensPerRun)}</em></span>
          <span className="muted">{r.runs}</span>
        </div>
      ))}
    </div>
  );
}

function Trial({ overview, proposals, notify }) {
  const trial = overview?.state?.trial;
  if (!trial) return null;
  const p = proposals.find((x) => x.id === trial.proposal);
  const ev = overview.evaluation;
  const act = (ch, msg) => call(ch).then(() => notify(msg)).catch((e) => notify(e.message, 'error'));
  return (
    <div className="trial">
      <div className="t">on trial · candidate <span className="bee mono">v{trial.version}</span> · {p?.title}</div>
      <div className="s mono">
        held-out runs: baseline {ev?.counts?.baseline ?? 0}/{ev?.counts?.needed} · candidate {ev?.counts?.candidate ?? 0}/{ev?.counts?.needed}
        {' · '}{Math.round((overview.acceptance?.trialShare || 0) * 100)}% of new runs use the candidate
      </div>
      {ev && ev.verdict !== 'pending' && (
        <div className="gates mono">
          <span className={ev.gates.capability ? 'ok' : 'bad'}>{ev.gates.capability ? '✔' : '✖'} capability</span> pass {pct(ev.baseline.passRate)} → {pct(ev.candidate.passRate)} (tol {pct(overview.acceptance.capabilityTolerance)})
          <br />
          <span className={ev.gates.efficiency ? 'ok' : 'bad'}>{ev.gates.efficiency ? '✔' : '✖'} efficiency</span>{' '}
          {Object.entries(ev.gates.gains).map(([k, g]) => <span key={k} className={g >= overview.acceptance.minEfficiencyGain ? 'ok' : 'muted'}>{k} {g >= 0 ? '−' : '+'}{pct(Math.abs(g))} </span>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button className="btn sm" disabled={ev?.verdict !== 'pass'} title={ev?.verdict === 'pass' ? '' : 'needs a passing held-out verdict'} onClick={() => act('improve:promote', 'candidate promoted')}>promote</button>
        <button className="btn ghost sm" onClick={() => act('improve:rollback', 'trial rolled back')}>roll back</button>
      </div>
    </div>
  );
}

function Settings({ harness, budgetStatus, notify }) {
  if (!harness) return null;
  const set = (patch) => call('harness:update', patch).catch((e) => notify(e.message, 'error'));
  const a = harness.auto || {};
  const m = harness.mechanisms || {};
  const b = budgetStatus;
  const used = b ? Math.min(1, b.today / b.limits.dailyTokens) : 0;
  return (
    <div className="settings">
      {b && (
        <div className="budget mono" title="tokens spent today by runs, analyst and extraction">
          <span>today</span>
          <span className="bar"><i className={used > 0.9 ? 'bad-bg' : 'bee-bg'} style={{ width: pct(used) }} /><em>{fmtTokens(b.today)} / {fmtTokens(b.limits.dailyTokens)}</em></span>
          <span className="muted">{b.live}/{b.limits.maxConcurrent} live · run cap {fmtTokens(b.limits.maxRunTokens)}</span>
        </div>
      )}
      <div className="toggles mono">
        <span className="muted">auto:</span>
        <label><input type="checkbox" checked={a.trialRules} onChange={(e) => set({ auto: { trialRules: e.target.checked } })} /> trial new rules</label>
        <label><input type="checkbox" checked={a.promote} onChange={(e) => set({ auto: { promote: e.target.checked } })} /> promote on pass</label>
        <label><input type="checkbox" checked={a.openPRs} onChange={(e) => set({ auto: { openPRs: e.target.checked } })} /> open draft PRs</label>
        <label>analyse every <input className="num" type="number" min={0} value={a.analyzeEvery} onChange={(e) => set({ auto: { analyzeEvery: Number(e.target.value) } })} /> runs</label>
      </div>
      <div className="toggles mono">
        <span className="muted">mechanisms:</span>
        {[['actionFusion', 'action fusion'], ['observationPack', 'observation pack'], ['evidenceReducer', 'evidence reducer'], ['compactGate', 'compact gate']].map(([k, label]) => (
          <label key={k}><input type="checkbox" checked={Boolean(m[k])} onChange={(e) => set({ mechanisms: { [k]: e.target.checked } })} /> {label}</label>
        ))}
      </div>
    </div>
  );
}

const STATUS_PILL = { open: 'bee', trial: 'bee', promoted: 'ok', rolled_back: 'bad', rejected: '' };

export default function ImprovePanel({ project, proposals, overview, budgetStatus, notify, setBusy }) {
  const decide = (id, approve, direct = false) => call('improve:decide', { id, approve, direct })
    .then((p) => notify(p.status === 'trial' ? 'on trial: new runs will compare it against the current harness' : p.status))
    .catch((e) => notify(e.message, 'error'));
  const trialActive = Boolean(overview?.state?.trial);
  return (
    <div className="section">
      <h3><span className="tag">L4</span> improve <span className="right">dev runs → ideas → trial → held-out gates → promote</span></h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button className="btn sm" onClick={async () => {
          setBusy('Analyst reading dev runs…');
          try {
            const r = await call('improve:analyze', {});
            notify(r.created?.length ? `${r.created.length} new idea(s)` : r.skipped || `no new ideas (${r.stats.runs} dev runs)`);
          } catch (e) { notify(e.message, 'error'); }
          setBusy('');
        }}>run analyst</button>
        <span className="s muted mono">harness v{project.harness?.version} · {project.harness?.rules?.length || 0} learned rules · held-out {pct(overview?.acceptance?.holdoutFraction)} of tasks</span>
      </div>
      <Settings harness={project.harness} budgetStatus={budgetStatus} notify={notify} />
      <Trial overview={overview} proposals={proposals} notify={notify} />
      <Timeline rows={overview?.timeline} />
      {proposals.map((p) => (
        <div className="row" key={p.id} style={{ gridTemplateColumns: '1fr auto' }}>
          <div style={{ minWidth: 0 }}>
            <div className="t"><span className="mono faint">{p.family || 'policy'}</span> <span className="mono bee">{p.id}</span> “{p.title}”</div>
            <div className="s">{p.rationale}</div>
            <div className="s mono">evidence: {p.evidence?.runs} dev runs · pass {pct(p.evidence?.passRate)} · {p.evidence?.retries} retries{p.evidence?.tokensPerRun ? ` · ${fmtTokens(p.evidence.tokensPerRun)} tok/run` : ''}{p.touchesGraders ? <span className="warn"> · changes graders</span> : null}{p.loosens ? <span className="bad"> · loosens a grader</span> : null}</div>
            {p.patch?.addRules?.map((r) => <div className="s mono" key={r}><span className="ok">+ rule</span> {r}</div>)}
            {p.patch?.graders && Object.entries(p.patch.graders).map(([k, v]) => <div className="s mono" key={k}><span className="warn">~ grader</span> {k} = {JSON.stringify(v)}</div>)}
            {p.patch?.mechanisms && Object.entries(p.patch.mechanisms).map(([k, v]) => <div className="s mono" key={k}><span className="warn">~ mechanism</span> {k} = {JSON.stringify(v)}</div>)}
            {p.evaluation && p.status !== 'trial' && <div className="s mono muted">held-out verdict: {p.evaluation.verdict}</div>}
          </div>
          {p.status === 'open' ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm" disabled={trialActive} title={trialActive ? 'another proposal is on trial' : 'A/B it on held-out tasks'} onClick={() => decide(p.id, true)}>trial</button>
              <button className="btn ghost sm" title="skip the trial and apply now" onClick={() => decide(p.id, true, true)}>apply</button>
              <button className="btn ghost sm" onClick={() => decide(p.id, false)}>reject</button>
            </div>
          ) : <span className={`pill ${STATUS_PILL[p.status] || ''}`}>{p.status.replace('_', ' ')}</span>}
        </div>
      ))}
    </div>
  );
}

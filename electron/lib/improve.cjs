// Loop 4: harness auto-research, following SoL-Pi (arXiv:2609.20519) §2:
//
//   trajectories → map (per-run overhead signals, deterministic, no tokens)
//                → reduce (one summary) → idea pool (heuristics + at most one cheap LLM call)
//                → trial (candidate harness serves a share of new runs)
//                → held-out evaluation with two frozen gates → promote or roll back
//
// Isolation rules from the paper:
//  - Tasks are split once, by hash, into dev and held-out. The analyst only sees dev runs.
//  - The acceptance rule (tolerances, metrics, sample sizes) is frozen in acceptance.json
//    before any search and is never written by this module.
//  - Held-out results decide a candidate but never feed back into proposals. A rolled-back
//    idea stays in the pool only so it is not proposed again.
const crypto = require('node:crypto');
const harnessLib = require('./harness.cjs');
const budget = require('./budget.cjs');
const { askClaude } = require('./llm.cjs');
const neatlogs = require('./neatlogs.cjs');

const DONE = new Set(['passed', 'failed']);
const hash01 = (s) => parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;
const taskKey = (r) => (r.issue?.number ? `issue#${r.issue.number}` : String(r.task || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200));
const split = (r, holdoutFraction) => (hash01(taskKey(r)) < holdoutFraction ? 'holdout' : 'dev');

// ---- map: one run → overhead signals ---------------------------------------------------
function mapRun(r) {
  const tools = (r.transcript || []).filter((l) => l.role === 'tool').map((l) => l.text);
  const seen = new Map();
  for (const t of tools) seen.set(t, (seen.get(t) || 0) + 1);
  const repeated = [...seen.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0);
  // An edit immediately followed by a separate run is a round trip Action Fusion would save.
  let unfused = 0;
  for (let i = 1; i < tools.length; i++) if (/^(Edit|Write|file_change)/.test(tools[i - 1]) && /^(Bash|command_execution|mcp__benana-intent__bench_run)/.test(tools[i])) unfused++;
  const failed = (r.verify || []).flatMap((v) => v.results.filter((x) => !x.pass).map((x) => x.grader));
  return {
    id: r.id, passed: r.status === 'passed', attempts: r.verify?.length || 0, tokens: budget.runTokens(r),
    steps: r.step || 0, toolCalls: tools.length, repeated, unfused, failed,
    bigObservations: r.observations?.reduced || 0, packed: r.observations?.packed || 0,
    compacted: r.compactions || 0, harnessVersion: r.harnessVersion, arm: r.arm || 'baseline',
  };
}

// ---- reduce: many runs → one summary ----------------------------------------------------
function metrics(signals) {
  const n = signals.length;
  const passed = signals.filter((s) => s.passed);
  const sum = (k, xs = signals) => xs.reduce((a, s) => a + (s[k] || 0), 0);
  return {
    runs: n,
    passed: passed.length,
    passRate: n ? passed.length / n : 0,
    tokensPerRun: n ? sum('tokens') / n : 0,
    tokensPerPass: passed.length ? sum('tokens') / passed.length : Infinity,
    attemptsPerRun: n ? sum('attempts') / n : 0,
  };
}

function reduceSignals(signals) {
  const failByGrader = {};
  for (const s of signals) for (const g of s.failed) failByGrader[g] = (failByGrader[g] || 0) + 1;
  const n = signals.length || 1;
  const sum = (k) => signals.reduce((a, s) => a + (s[k] || 0), 0);
  return {
    ...metrics(signals),
    retries: signals.filter((s) => s.attempts > 1).length,
    failByGrader,
    repeatedToolCallsPerRun: sum('repeated') / n,
    unfusedEditRunPerRun: sum('unfused') / n,
    stepsPerRun: sum('steps') / n,
  };
}

// Kept for callers that only want the old stats shape.
function stats(runs) {
  const s = reduceSignals(runs.filter((r) => r.verify?.length).map(mapRun));
  return { runs: s.runs, passed: s.passed, retries: s.retries, fails: s.failByGrader };
}

// ---- idea pool --------------------------------------------------------------------------
const signature = (p) => crypto.createHash('sha1').update(JSON.stringify([p.family, (p.patch?.addRules || []).map((r) => r.toLowerCase().trim()).sort(), p.patch?.graders || {}, p.patch?.mechanisms || {}])).digest('hex').slice(0, 12);

function heuristicIdeas(s) {
  const ideas = [];
  const f = s.failByGrader;
  if (f['intent.check']) ideas.push({ family: 'context', title: 'Require an explicit intent_check before the first edit', rationale: `${f['intent.check']} attempt(s) repeated a known dead end or overrode a decision.`, patch: { addRules: ['Call intent_check before your first Edit/Write, and quote any conflict ids in your plan.'] } });
  if (f['diff scope']) ideas.push({ family: 'policy', title: 'Keep diffs scoped to the task', rationale: `${f['diff scope']} attempt(s) exceeded the file budget.`, patch: { addRules: ['Change only files required by the task; list any extra file you touch and why.'] } });
  if (f.changes) ideas.push({ family: 'progress', title: 'Make agents finish with a concrete change', rationale: `${f.changes} attempt(s) ended without editing anything.`, patch: { addRules: ['Do not end your turn with only a plan; make the smallest correct change.'] } });
  if (f.tests) ideas.push({ family: 'verification', title: 'Run the test command before finishing', rationale: `${f.tests} attempt(s) failed the test grader after the agent stopped.`, patch: { addRules: ['Before you finish, run the project test command with bench_run and fix failures.'] } });
  if (s.unfusedEditRunPerRun >= 1) ideas.push({ family: 'tools', title: 'Fuse edits with their check command', rationale: `${s.unfusedEditRunPerRun.toFixed(1)} edit→run round trips per run; each costs a full model request.`, patch: { addRules: ['When an edit is followed by a build/test/run, use bench_edit_run so both happen in one call.'], mechanisms: { actionFusion: true } } });
  if (s.repeatedToolCallsPerRun >= 2) ideas.push({ family: 'context', title: 'Stop re-reading the same files', rationale: `${s.repeatedToolCallsPerRun.toFixed(1)} identical tool calls per run.`, patch: { addRules: ['Do not repeat an identical tool call; reuse what you already read unless the file changed.'] } });
  return ideas;
}

async function llmIdeas(h, summary, pool, model) {
  const known = pool.slice(0, 30).map((p) => `- [${p.status}] ${p.title}`).join('\n') || '(none)';
  const prompt = `You improve a coding-agent harness for capability AND token efficiency.
Current learned rules:\n${h.rules.map((r) => `- ${r}`).join('\n') || '(none)'}
Graders: ${JSON.stringify(h.graders)}
Mechanisms: ${JSON.stringify(h.mechanisms)}
Dev-set summary (held-out runs excluded): ${JSON.stringify(summary)}
Ideas already in the pool (do not repeat them):\n${known}

Propose up to 2 small, independent changes, each targeting one concrete source of failure or overhead in the summary.
Families: context, progress, tools, policy, verification, observation.
Reply with a JSON array only:
[{"family":"...","title":"...","rationale":"cite the numbers","patch":{"addRules":["..."],"graders":{},"mechanisms":{}}}]
Never loosen a grader to make runs pass.`;
  const out = await askClaude(prompt, { json: true, model, kind: 'analyst', timeoutMs: 120000 }).catch(() => null);
  return (Array.isArray(out) ? out : out ? [out] : []).filter((x) => x && typeof x.title === 'string' && x.patch);
}

// A patch that makes a grader easier to pass. Allowed only by a human.
function loosens(h, patch = {}) {
  const g = patch.graders || {};
  return ('intentCheck' in g && !g.intentCheck && h.graders.intentCheck)
    || ('testCommand' in g && !g.testCommand && h.graders.testCommand)
    || ('maxFilesChanged' in g && g.maxFilesChanged > h.graders.maxFilesChanged)
    || ('maxAttempts' in g && g.maxAttempts > h.graders.maxAttempts);
}

// ---- state ------------------------------------------------------------------------------
const readJSON = (store, f, d) => { try { return JSON.parse(store.read(f)) ?? d; } catch { return d; } };
const state = (store) => readJSON(store, 'state.json', { lastAnalyzedAt: 0, trial: null });
const saveState = (store, s) => store.write('state.json', s);

function proposals(store) {
  return store.list('proposals').filter((f) => f.endsWith('.json')).map((f) => readJSON(store, f, null)).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
const saveProposal = (store, p) => store.write(`proposals/${p.id}.json`, p);
const getProposal = (store, id) => { const p = readJSON(store, `proposals/${id}.json`, null); if (!p) throw new Error('proposal not found'); return p; };

// ---- analyze ----------------------------------------------------------------------------
async function analyze({ harnessStore, runs, useLLM = true, force = false, minNewRuns = 3 }) {
  const h = harnessLib.load(harnessStore);
  const acc = harnessLib.acceptance(harnessStore);
  const st = state(harnessStore);
  const finished = runs.filter((r) => DONE.has(r.status) && r.verify?.length);
  const dev = finished.filter((r) => split(r, acc.holdoutFraction) === 'dev');
  const fresh = dev.filter((r) => (r.endedAt || r.startedAt) > st.lastAnalyzedAt);
  const summary = reduceSignals(dev.slice(0, 40).map(mapRun));
  const base = { stats: { ...summary, heldOut: finished.length - dev.length, newSinceLast: fresh.length } };

  if (!force && fresh.length < minNewRuns) return { ...base, proposal: null, skipped: `waiting for ${minNewRuns - fresh.length} more dev run(s)` };
  if (!dev.length) return { ...base, proposal: null, skipped: 'no finished dev runs yet' };

  const pool = proposals(harnessStore);
  const known = new Set(pool.map((p) => p.signature));
  let ideas = heuristicIdeas(summary);
  // Spend tokens only when the free heuristics found nothing new.
  if (useLLM && !ideas.some((i) => !known.has(signature(i)))) {
    const traces = await neatlogs.recentTraces(20).catch(() => []);
    const withTraces = { ...summary, neatlogsTraces: traces.length };
    ideas = ideas.concat(await llmIdeas(h, withTraces, pool, h.budget.analystModel));
  }
  st.lastAnalyzedAt = Date.now();
  saveState(harnessStore, st);

  const created = [];
  for (const idea of ideas) {
    const sig = signature(idea);
    if (known.has(sig)) continue;
    known.add(sig);
    const p = {
      id: `hp_${Date.now().toString(36)}${created.length}`, createdAt: Date.now(), fromVersion: h.version, status: 'open',
      family: idea.family || 'policy', title: String(idea.title).slice(0, 160), rationale: String(idea.rationale || '').slice(0, 600),
      patch: { addRules: (idea.patch.addRules || []).map(String).slice(0, 3), graders: idea.patch.graders || {}, mechanisms: idea.patch.mechanisms || {} },
      evidence: { runs: summary.runs, passRate: summary.passRate, retries: summary.retries, tokensPerRun: Math.round(summary.tokensPerRun) },
      signature: sig,
    };
    p.touchesGraders = Object.keys(p.patch.graders).length > 0;
    p.loosens = Boolean(loosens(h, p.patch));
    saveProposal(harnessStore, p);
    created.push(p);
  }
  await harnessStore.commit(created.length ? `analyst: ${created.length} idea(s) — ${created.map((p) => p.title).join('; ')}` : 'analyst: no new ideas', 'analyst');

  // Unattended mode: put the first rule-only idea on trial if nothing else is.
  if (h.auto.trialRules && !st.trial) {
    const p = created.find((x) => !x.touchesGraders && !x.loosens);
    if (p) await startTrial(harnessStore, p.id, 'auto');
  }
  return { ...base, proposal: created[0] || null, created };
}

// ---- trial / evaluation -----------------------------------------------------------------
async function startTrial(store, id, actor = 'human') {
  const st = state(store);
  if (st.trial) throw new Error(`proposal ${st.trial.proposal} is already on trial; promote or roll it back first`);
  const p = getProposal(store, id);
  if (p.status !== 'open') throw new Error(`proposal is ${p.status}`);
  if ((p.touchesGraders || p.loosens) && actor !== 'human') throw new Error('grader changes need a human');
  const h = harnessLib.load(store);
  const cand = harnessLib.applyPatch(h, p.patch);
  store.write('candidate.json', cand);
  Object.assign(p, { status: 'trial', trialStartedAt: Date.now(), candidateVersion: cand.version, approvedBy: actor });
  saveProposal(store, p);
  saveState(store, { ...st, trial: { proposal: id, version: cand.version, startedAt: p.trialStartedAt } });
  await store.commit(`trial harness v${cand.version}: ${p.title}`, actor);
  return p;
}

// Which harness a new run uses. While a trial runs, a share of runs gets the candidate.
function pickHarness(store, rand = Math.random) {
  const h = harnessLib.load(store);
  const st = state(store);
  const cand = st.trial ? harnessLib.loadCandidate(store) : null;
  if (cand && rand() < harnessLib.acceptance(store).trialShare) return { harness: cand, arm: 'candidate', trial: st.trial.proposal };
  return { harness: h, arm: 'baseline', trial: st.trial?.proposal || null };
}

// Two sequential gates on held-out runs only (paper §2.1):
//  1. capability: candidate pass rate within tolerance of baseline
//  2. efficiency: at least one declared metric improves by minEfficiencyGain
function gate(acc, base, cand) {
  const capability = cand.passRate >= base.passRate - acc.capabilityTolerance;
  const gains = {};
  for (const m of acc.efficiencyMetrics) {
    const b = base[m]; const c = cand[m];
    gains[m] = Number.isFinite(b) && b > 0 && Number.isFinite(c) ? (b - c) / b : (Number.isFinite(c) && !Number.isFinite(b) ? 1 : 0);
  }
  const efficiency = Object.values(gains).some((g) => g >= acc.minEfficiencyGain);
  return { capability, efficiency, gains, pass: capability && efficiency };
}

function evaluate(store, runs) {
  const st = state(store);
  if (!st.trial) return null;
  const acc = harnessLib.acceptance(store);
  const h = harnessLib.load(store);
  const held = runs.filter((r) => DONE.has(r.status) && r.verify?.length && split(r, acc.holdoutFraction) === 'holdout');
  const cand = held.filter((r) => r.arm === 'candidate' && r.trial === st.trial.proposal);
  let base = held.filter((r) => r.arm !== 'candidate' && r.harnessVersion === h.version && r.startedAt >= st.trial.startedAt);
  // Too few concurrent baseline runs: fall back to earlier held-out runs of the same harness.
  if (base.length < acc.minSamples) base = held.filter((r) => r.arm !== 'candidate' && r.harnessVersion === h.version).slice(0, acc.minSamples * 3);
  const mb = metrics(base.map(mapRun));
  const mc = metrics(cand.map(mapRun));
  const counts = { baseline: base.length, candidate: cand.length, needed: acc.minSamples };
  if (base.length < acc.minSamples || cand.length < acc.minSamples) return { proposal: st.trial.proposal, verdict: 'pending', counts, baseline: mb, candidate: mc };
  const g = gate(acc, mb, mc);
  return { proposal: st.trial.proposal, verdict: g.pass ? 'pass' : 'fail', counts, baseline: mb, candidate: mc, gates: g };
}

async function promote(store, actor = 'human') {
  const st = state(store);
  if (!st.trial) throw new Error('nothing on trial');
  const cand = harnessLib.loadCandidate(store);
  const p = getProposal(store, st.trial.proposal);
  store.write('harness.json', cand);
  store.remove('candidate.json');
  Object.assign(p, { status: 'promoted', decidedAt: Date.now(), decidedBy: actor });
  saveProposal(store, p);
  saveState(store, { ...st, trial: null });
  await store.commit(`harness v${cand.version}: promote ${p.title}`, actor);
  return p;
}

async function rollback(store, actor = 'human', reason = 'rolled back') {
  const st = state(store);
  if (!st.trial) throw new Error('nothing on trial');
  const p = getProposal(store, st.trial.proposal);
  store.remove('candidate.json');
  Object.assign(p, { status: 'rolled_back', decidedAt: Date.now(), decidedBy: actor, outcome: reason });
  saveProposal(store, p);
  saveState(store, { ...st, trial: null });
  await store.commit(`roll back trial ${p.id}: ${reason}`, actor);
  return p;
}

// Called after every finished run. Records the verdict on the proposal and, in unattended
// mode, applies it.
async function tick(store, runs) {
  const ev = evaluate(store, runs);
  if (!ev) return null;
  const p = getProposal(store, ev.proposal);
  p.evaluation = { ...ev, at: Date.now() };
  saveProposal(store, p);
  const h = harnessLib.load(store);
  if (ev.verdict === 'fail') return { ev, applied: await rollback(store, 'evaluator', 'failed held-out gates') };
  if (ev.verdict === 'pass' && h.auto.promote && !p.touchesGraders) return { ev, applied: await promote(store, 'evaluator') };
  await store.commit(`evaluate ${p.id}: ${ev.verdict}`, 'evaluator');
  return { ev };
}

// Human decision on an open proposal. approve → trial (or direct promotion when asked).
async function decide({ harnessStore, id, approve, direct = false }) {
  const p = getProposal(harnessStore, id);
  if (p.status !== 'open') return p;
  if (!approve) {
    Object.assign(p, { status: 'rejected', decidedAt: Date.now() });
    saveProposal(harnessStore, p);
    await harnessStore.commit(`reject ${id}`, 'human');
    return p;
  }
  if (!direct) return startTrial(harnessStore, id, 'human');
  const h = harnessLib.load(harnessStore);
  const next = harnessLib.applyPatch(h, p.patch);
  harnessStore.write('harness.json', next);
  Object.assign(p, { status: 'promoted', decidedAt: Date.now(), decidedBy: 'human (no trial)' });
  saveProposal(harnessStore, p);
  await harnessStore.commit(`harness v${next.version}: ${p.title} (promoted without trial)`, 'human');
  return p;
}

// Per-harness-version metrics for the improve chart.
function timeline(runs) {
  const by = new Map();
  for (const r of runs.filter((x) => DONE.has(x.status) && x.verify?.length)) {
    const k = `${r.harnessVersion}${r.arm === 'candidate' ? '*' : ''}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(mapRun(r));
  }
  return [...by.entries()].map(([k, s]) => ({ version: k, ...metrics(s), tokensPerPass: Number.isFinite(metrics(s).tokensPerPass) ? metrics(s).tokensPerPass : null }))
    .sort((a, b) => parseFloat(a.version) - parseFloat(b.version) || a.version.localeCompare(b.version));
}

function overview(store, runs) {
  return { state: state(store), acceptance: harnessLib.acceptance(store), candidate: harnessLib.loadCandidate(store), evaluation: evaluate(store, runs), timeline: timeline(runs) };
}

module.exports = {
  analyze, decide, proposals, stats, startTrial, pickHarness, evaluate, promote, rollback, tick, timeline, overview,
  // exported for tests
  mapRun, reduceSignals, metrics, gate, split, signature, heuristicIdeas, loosens,
};

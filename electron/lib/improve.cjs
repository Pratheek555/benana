// Loop 4: hill climbing. An analyst reads run records (+ Neatlogs traces when configured),
// finds recurring failures and proposes a harness change. Nothing applies without approval.
const harnessLib = require('./harness.cjs');
const { askClaude } = require('./llm.cjs');
const neatlogs = require('./neatlogs.cjs');

function stats(runs) {
  const done = runs.filter((r) => r.verify?.length);
  const fails = {};
  for (const r of done) for (const v of r.verify) for (const x of v.results) if (!x.pass) fails[x.grader] = (fails[x.grader] || 0) + 1;
  return {
    runs: done.length,
    passed: done.filter((r) => r.status === 'passed').length,
    retries: done.filter((r) => r.verify.length > 1).length,
    fails,
  };
}

async function analyze({ harnessStore, runs, useLLM = true }) {
  const h = harnessLib.load(harnessStore);
  const s = stats(runs);
  const traces = await neatlogs.recentTraces(20).catch(() => []);
  let proposal = null;

  if (useLLM && s.runs > 0) {
    const sample = runs.filter((r) => r.verify?.length).slice(0, 8).map((r) => ({
      task: r.task.slice(0, 200), status: r.status, attempts: r.verify.length,
      failures: r.verify.flatMap((v) => v.results.filter((x) => !x.pass).map((x) => `${x.grader}: ${String(x.detail).slice(0, 160)}`)),
    }));
    proposal = await askClaude(`You improve a coding-agent harness. Current harness:\n${JSON.stringify(h, null, 2)}\n\nRun stats: ${JSON.stringify(s)}\nRecent runs: ${JSON.stringify(sample, null, 2)}\nNeatlogs traces available: ${traces.length}\n\nPropose ONE small change that would most reduce failures. Reply JSON only:\n{"title": "...", "rationale": "...", "patch": {"addRules": ["..."], "graders": {}}}\nOnly include grader keys you want to change. Never loosen a grader just to make runs pass.`, { json: true }).catch(() => null);
  }
  if (!proposal) proposal = heuristic(h, s);
  if (!proposal) return { stats: s, proposal: null, traces: traces.length };

  const touchesGraders = proposal.patch?.graders && Object.keys(proposal.patch.graders).length > 0;
  const p = {
    id: `hp_${Date.now().toString(36)}`, createdAt: Date.now(), fromVersion: h.version, status: 'open',
    evidence: { ...s, neatlogsTraces: traces.length }, touchesGraders, ...proposal,
  };
  harnessStore.write(`proposals/${p.id}.json`, p);
  await harnessStore.commit(`proposal ${p.id}: ${p.title}`, 'analyst');
  return { stats: s, proposal: p };
}

function heuristic(h, s) {
  if ((s.fails['intent.check'] || 0) >= 1) {
    return { title: 'Require an explicit intent_check before the first edit', rationale: `${s.fails['intent.check']} attempt(s) repeated a known dead end or overrode a decision.`, patch: { addRules: ['Call intent_check before your first Edit/Write, and quote any conflict ids in your plan.'] } };
  }
  if ((s.fails['diff scope'] || 0) >= 1) {
    return { title: 'Keep diffs scoped to the task', rationale: `${s.fails['diff scope']} attempt(s) exceeded the file budget.`, patch: { addRules: ['Change only files required by the task; list any extra file you touch and why.'] } };
  }
  if ((s.fails.changes || 0) >= 1) {
    return { title: 'Make agents finish with a concrete change', rationale: `${s.fails.changes} attempt(s) ended without editing anything.`, patch: { addRules: ['Do not end your turn with only a plan; make the smallest correct change.'] } };
  }
  return null;
}

async function decide({ harnessStore, id, approve }) {
  const raw = harnessStore.read(`proposals/${id}.json`);
  if (!raw) throw new Error('proposal not found');
  const p = JSON.parse(raw);
  if (p.status !== 'open') return p;
  p.status = approve ? 'approved' : 'rejected';
  p.decidedAt = Date.now();
  harnessStore.write(`proposals/${id}.json`, p);
  if (approve) {
    const h = harnessLib.load(harnessStore);
    const next = {
      ...h, version: h.version + 1,
      rules: [...h.rules, ...((p.patch?.addRules) || []).filter((r) => !h.rules.includes(r))],
      graders: { ...h.graders, ...(p.patch?.graders || {}) },
    };
    harnessStore.write('harness.json', next);
    await harnessStore.commit(`harness v${next.version}: ${p.title}`, 'human-approved');
  } else {
    await harnessStore.commit(`reject ${id}`, 'human');
  }
  return p;
}

function proposals(harnessStore) {
  return harnessStore.list('proposals').map((f) => JSON.parse(harnessStore.read(f))).sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { analyze, decide, proposals, stats };

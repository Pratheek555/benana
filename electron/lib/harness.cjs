// The harness itself is versioned data (Loop 4 edits it). Stored in the harness repo.
//   harness.json    the promoted harness every run uses by default
//   candidate.json  a proposed next version under evaluation (see improve.cjs)
//   acceptance.json the frozen acceptance rule; written once, never edited by the analyst
const budget = require('./budget.cjs');

const DEFAULT = {
  version: 1,
  agent: 'claude',
  systemPrompt: [
    'You are working inside the Benana harness.',
    'Before planning, call intent_context with the task. Before editing, call intent_check with your plan and files.',
    'If intent_check reports a conflict, change approach or explain why the past reason no longer applies.',
    'When you make a meaningful choice, call intent_record (Decision). When an approach fails, record a DeadEnd.',
    'Run commands with bench_run, and use bench_edit_run to make an edit and run its check in one call.',
    'Large outputs come back as a receipt or a handle; call bench_page only when you need the exact text.',
  ].join('\n'),
  rules: [],
  graders: { testCommand: '', testTimeoutSec: 600, maxAttempts: 2, intentCheck: true, maxFilesChanged: 15 },
  // Mechanism switches (SoL-Pi). Each can be turned off to measure its effect.
  mechanisms: { actionFusion: true, observationPack: true, evidenceReducer: true, compactGate: true },
  budget: { ...budget.DEFAULTS },
  // What the loops may do without a human. Grader changes always need a human.
  auto: { analyzeEvery: 5, trialRules: false, promote: false, openPRs: false },
};

const ACCEPTANCE = {
  frozenAt: null,
  // Capability gate: candidate pass rate may drop at most this much vs baseline.
  capabilityTolerance: 0.05,
  // Efficiency gate: at least one metric must improve by this fraction.
  minEfficiencyGain: 0.1,
  efficiencyMetrics: ['tokensPerPass', 'attemptsPerRun', 'tokensPerRun'],
  // Runs needed in each arm, on held-out tasks only, before a verdict.
  minSamples: 4,
  // Share of tasks reserved for evaluation; the analyst never sees them.
  holdoutFraction: 0.3,
  // Share of new runs that use the candidate while one is on trial.
  trialShare: 0.5,
};

function parse(raw) { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }

function normalize(h) {
  return {
    ...DEFAULT, ...h,
    rules: Array.isArray(h.rules) ? h.rules.filter((r) => typeof r === 'string') : [],
    graders: { ...DEFAULT.graders, ...(h.graders || {}) },
    mechanisms: { ...DEFAULT.mechanisms, ...(h.mechanisms || {}) },
    budget: { ...DEFAULT.budget, ...(h.budget || {}) },
    auto: { ...DEFAULT.auto, ...(h.auto || {}) },
  };
}

function load(store) {
  const h = parse(store.read('harness.json'));
  return h ? normalize(h) : normalize({});
}

function loadCandidate(store) {
  const c = parse(store.read('candidate.json'));
  return c ? normalize(c) : null;
}

function acceptance(store) {
  return { ...ACCEPTANCE, ...(parse(store.read('acceptance.json')) || {}) };
}

async function ensure(store) {
  let dirty = false;
  if (!store.read('harness.json')) { store.write('harness.json', DEFAULT); dirty = true; }
  if (!store.read('acceptance.json')) { store.write('acceptance.json', { ...ACCEPTANCE, frozenAt: Date.now() }); dirty = true; }
  if (dirty) await store.commit('harness v1 (default) + frozen acceptance rule', 'system');
  return load(store);
}

function systemPrompt(h) {
  return [h.systemPrompt, ...h.rules.map((r) => `- ${r}`)].join('\n');
}

// Applies a proposal patch. Only additive rule changes and declared grader keys.
function applyPatch(h, patch = {}) {
  const graders = { ...h.graders };
  for (const [k, v] of Object.entries(patch.graders || {})) if (k in DEFAULT.graders) graders[k] = v;
  return {
    ...h,
    version: h.version + 1,
    rules: [...h.rules, ...(patch.addRules || []).filter((r) => typeof r === 'string' && !h.rules.includes(r))]
      .filter((r) => !(patch.removeRules || []).includes(r)),
    graders,
    mechanisms: { ...h.mechanisms, ...(patch.mechanisms || {}) },
  };
}

module.exports = { load, loadCandidate, acceptance, ensure, systemPrompt, applyPatch, normalize, DEFAULT, ACCEPTANCE };

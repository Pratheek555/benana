const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BENANA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'benana-'));
const { RepoStore } = require('../electron/lib/store.cjs');
const harnessLib = require('../electron/lib/harness.cjs');
const improve = require('../electron/lib/improve.cjs');

const ACC = harnessLib.ACCEPTANCE;
const run = (id, { passed = true, tokens = 1000, attempts = 1, arm = 'baseline', v = 1, trial = null, task } = {}) => ({
  id, task: task || `task ${id}`, status: passed ? 'passed' : 'failed', startedAt: Date.now(), endedAt: Date.now(), harnessVersion: v, arm, trial,
  usage: { inputTokens: tokens }, verify: Array.from({ length: attempts }, (_, i) => ({ attempt: i + 1, results: [{ grader: 'changes', pass: passed || i < attempts - 1 }] })),
  transcript: [],
});
// Tasks whose hash lands in the held-out bucket.
const heldOutTasks = (n) => { const out = []; for (let i = 0; out.length < n; i++) if (improve.split({ task: `t${i}` }, ACC.holdoutFraction) === 'holdout') out.push(`t${i}`); return out; };

test('split is deterministic and roughly matches the held-out fraction', () => {
  const tasks = Array.from({ length: 2000 }, (_, i) => ({ task: `task number ${i}` }));
  const held = tasks.filter((t) => improve.split(t, 0.3) === 'holdout').length / tasks.length;
  assert.ok(held > 0.25 && held < 0.35, String(held));
  assert.strictEqual(improve.split(tasks[7], 0.3), improve.split({ ...tasks[7] }, 0.3));
});

test('capability gate blocks a cheaper but worse candidate', () => {
  const base = improve.metrics([1, 2, 3, 4].map((i) => improve.mapRun(run(`b${i}`, { tokens: 1000 }))));
  const cand = improve.metrics([1, 2, 3, 4].map((i) => improve.mapRun(run(`c${i}`, { tokens: 300, passed: i > 2 }))));
  const g = improve.gate(ACC, base, cand);
  assert.strictEqual(g.capability, false);
  assert.strictEqual(g.pass, false);
});

test('efficiency gate needs a real gain', () => {
  const base = improve.metrics([1, 2, 3, 4].map((i) => improve.mapRun(run(`b${i}`, { tokens: 1000 }))));
  const same = improve.metrics([1, 2, 3, 4].map((i) => improve.mapRun(run(`c${i}`, { tokens: 980 }))));
  const better = improve.metrics([1, 2, 3, 4].map((i) => improve.mapRun(run(`c${i}`, { tokens: 700 }))));
  assert.strictEqual(improve.gate(ACC, base, same).pass, false);
  assert.strictEqual(improve.gate(ACC, base, better).pass, true);
});

test('loosening grader patches are detected', () => {
  const h = harnessLib.normalize({ graders: { testCommand: 'npm test' } });
  assert.ok(improve.loosens(h, { graders: { testCommand: '' } }));
  assert.ok(improve.loosens(h, { graders: { maxFilesChanged: 99 } }));
  assert.ok(!improve.loosens(h, { graders: { maxFilesChanged: 5 } }));
});

test('analyze → trial → held-out evaluation → promote', async () => {
  const store = await new RepoStore('harness', `o/r${Date.now()}`).init();
  await harnessLib.ensure(store);
  const failing = Array.from({ length: 6 }, (_, i) => run(`d${i}`, { passed: false, attempts: 2 }));
  const a = await improve.analyze({ harnessStore: store, runs: failing, useLLM: false, force: true });
  assert.ok(a.proposal, 'heuristics should propose something');
  // The analyst only sees dev runs.
  assert.strictEqual(a.stats.runs + a.stats.heldOut, failing.length);
  const again = await improve.analyze({ harnessStore: store, runs: failing, useLLM: false, force: true });
  assert.ok(!again.created.some((p) => p.signature === a.proposal.signature), 'ideas are deduplicated');

  await improve.decide({ harnessStore: store, id: a.proposal.id, approve: true });
  assert.strictEqual(harnessLib.loadCandidate(store).version, 2);
  assert.strictEqual(improve.pickHarness(store, () => 0).arm, 'candidate');
  assert.strictEqual(improve.pickHarness(store, () => 0.99).arm, 'baseline');

  const tasks = heldOutTasks(8);
  const trial = a.proposal.id;
  const runs = [
    ...tasks.slice(0, 4).map((t, i) => run(`hb${i}`, { task: t, tokens: 1000 })),
    ...tasks.slice(4).map((t, i) => run(`hc${i}`, { task: t, tokens: 600, arm: 'candidate', v: 2, trial })),
  ];
  assert.strictEqual(improve.evaluate(store, runs.slice(0, 5)).verdict, 'pending');
  const ev = improve.evaluate(store, runs);
  assert.strictEqual(ev.verdict, 'pass');
  await improve.promote(store);
  assert.strictEqual(harnessLib.load(store).version, 2);
  assert.strictEqual(harnessLib.loadCandidate(store), null);
});

test('a failing trial is rolled back automatically', async () => {
  const store = await new RepoStore('harness', `o/f${Date.now()}`).init();
  await harnessLib.ensure(store);
  const a = await improve.analyze({ harnessStore: store, runs: Array.from({ length: 6 }, (_, i) => run(`d${i}`, { passed: false })), useLLM: false, force: true });
  await improve.decide({ harnessStore: store, id: a.proposal.id, approve: true });
  const tasks = heldOutTasks(8);
  const runs = [
    ...tasks.slice(0, 4).map((t, i) => run(`hb${i}`, { task: t })),
    ...tasks.slice(4).map((t, i) => run(`hc${i}`, { task: t, passed: false, arm: 'candidate', v: 2, trial: a.proposal.id })),
  ];
  const t = await improve.tick(store, runs);
  assert.strictEqual(t.applied.status, 'rolled_back');
  assert.strictEqual(harnessLib.load(store).version, 1);
});

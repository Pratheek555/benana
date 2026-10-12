const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'benana-cfo-'));
process.env.BENANA_DATA_DIR = sandbox;

let releaseSetup;
let claudeRuns = 0;
const setup = new Promise((resolve) => { releaseSetup = resolve; });

function stub(rel, exports) {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}

stub('../electron/lib/studio/repo.cjs', { enableNeatlogs: () => setup });
stub('../electron/lib/studio/claude.cjs', {
  runClaude: () => {
    claudeRuns += 1;
    return { done: Promise.resolve({ ok: true, sessionId: 'cfo-session', final: 'answer', usage: { costUsd: 0.1 }, error: null }), stop() {} };
  },
});

const cfo = require('../electron/lib/cfo.cjs');
const usage = (costUsd) => ({ inputTokens: 10, outputTokens: 2, ...(costUsd === undefined ? {} : { costUsd }) });
const session = (role, costUsd) => ({ role, model: role === 'playtester' ? 'sonnet' : 'opus', startedAt: 1000, endedAt: 61000, usage: usage(costUsd) });

const mods = [
  {
    id: 'complete', name: 'Complete', status: 'passed', createdAt: 4, prompt: 'lightning sword', sessions: [session('spec', 0.2)], turns: [{}],
    attempts: [
      { n: 1, turn: 0, sessions: [session('builder', 0.8)] },
      { n: 2, turn: 0, sessions: [session('fixer', 0.5)] },
    ],
  },
  {
    id: 'partial', name: 'Partial', status: 'passed', createdAt: 3, prompt: 'pet dragon', sessions: [], turns: [{}],
    attempts: [{ n: 1, turn: 0, sessions: [session('spec', 0.3), session('playtester')] }],
  },
  {
    id: 'failed', name: 'Failed', status: 'failed', createdAt: 2, prompt: 'ice sword', sessions: [], turns: [{}],
    attempts: [{ n: 1, turn: 0, sessions: [session('builder', 0.4)] }],
  },
  {
    id: 'running', name: 'Running', status: 'building', running: true, createdAt: 5, sessions: [session('spec', 10)], attempts: [], turns: [{}],
  },
];

test('books keep unknown costs out of complete metrics and running sessions out of totals', () => {
  const books = cfo.books(mods);
  assert.equal(books.mods.length, 3);
  assert.equal(books.totals.spend, 2.2);
  assert.equal(books.totals.costPerVerifiedMod, null);
  assert.equal(books.totals.uncostedSessions, 1);
  assert.equal(books.totals.firstTryRate, 0.3333);
  assert.deepEqual(books.totals.byRole, { spec: 0.5, builder: 1.2, fixer: 0.5 });
  const partial = books.mods.find((m) => m.id === 'partial');
  assert.equal(partial.cost, 0.3);
  assert.equal(partial.costComplete, false);
  assert.equal(partial.breakEven[1].sales, null);
  assert.equal(books.totals.remixMedianCost, null);
});

test('quotes use only complete successful local build costs', () => {
  const quote = cfo.quote(mods, 'a sword with lightning');
  assert.equal(quote.ok, true);
  assert.deepEqual(quote.basis.map((b) => b.name), ['Complete']);
  assert.equal(quote.expected, 1.5);
});

test('CSV leaves an unreported session cost blank', () => {
  const out = cfo.exportCsv(mods);
  const rows = fs.readFileSync(out.file, 'utf8').trimEnd().split(/\r?\n/);
  const playtester = rows.find((row) => row.includes(',playtester,'));
  assert.ok(playtester.endsWith(','), playtester);
});

test('ask reserves setup, rejects overlap, and a setup stop prevents Claude launch', async () => {
  const events = [];
  const first = cfo.ask({ question: 'What should I charge?', mods, emit: (channel, event) => events.push([channel, event]) });
  assert.deepEqual(cfo.activeAsk(), { id: events[0][1].askId, question: 'What should I charge?', events: [] });
  await assert.rejects(() => cfo.ask({ question: 'Start another', mods }), /still answering/);
  assert.equal(cfo.stop(), true);
  releaseSetup();
  const entry = await first;
  assert.equal(claudeRuns, 0);
  assert.equal(entry.error, 'Stopped.');
  assert.equal(cfo.activeAsk(), null);
  assert.equal(events.at(-1)[1].kind, 'done');
});

test('status does not call a failed CLI lookup an added server', async () => {
  const oldPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const result = await cfo.status();
    assert.equal(result.added, false);
    assert.ok(['no-claude', 'failed'].includes(result.state));
  } finally {
    process.env.PATH = oldPath;
  }
});

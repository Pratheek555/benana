const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reduce, verifyReceipt, Pack, compactGate, observe } = require('../electron/lib/observe.cjs');

const log = [...Array(400)].map((_, i) => `  ok ${i} some passing test with padding text`).join('\n')
  + '\nFAIL src/math.test.js\n  expected 3, received 4\n    at sum (src/math.js:2:3)\nTests: 1 failed, 399 passed';

test('small outputs pass through untouched', () => {
  assert.deepStrictEqual(reduce('ok'), { reduced: false, text: 'ok' });
});

test('large logs reduce to exact evidence and verify', () => {
  const r = reduce(log, { command: 'npm test', exitCode: 1 });
  assert.ok(r.reduced);
  assert.ok(r.text.length < log.length / 5);
  assert.match(r.text, /expected 3, received 4/);
  assert.match(r.text, /Tests: 1 failed/);
  assert.deepStrictEqual(verifyReceipt(r.receipt, log), { ok: true });
});

test('verifier rejects tampered receipts', () => {
  const { receipt } = reduce(log, { exitCode: 1 });
  assert.strictEqual(verifyReceipt({ ...receipt, quotes: [{ line: 1, text: 'invented' }] }, log).ok, false);
  assert.strictEqual(verifyReceipt(receipt, `${log}x`).ok, false);
});

test('pack archives large output and pages it back exactly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
  const p = new Pack(dir);
  const big = 'x'.repeat(30000);
  const o = p.pack(big);
  assert.ok(o.packed && o.text.length < 2000);
  const pg = p.page(o.handle, { offset: 100, length: 50 });
  assert.strictEqual(pg.text, big.slice(100, 150));
  assert.throws(() => p.page('../etc/passwd'));
});

test('observe prefers a receipt over a handle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'));
  const o = observe(log + '\n'.repeat(2) + 'y'.repeat(20000), { pack: new Pack(dir), exitCode: 1 });
  assert.ok(o.reduced);
});

test('compact gate only fires when the context is large', () => {
  assert.strictEqual(compactGate({ contextTokens: 3000 }).compact, false);
  assert.strictEqual(compactGate({ contextTokens: 120000 }).compact, true);
});

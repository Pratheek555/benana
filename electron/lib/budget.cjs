// Token budgets. Every loop that spends tokens asks here first:
//   - per run: a token ceiling (the run is stopped when crossed) and a turn cap
//   - per day: total tokens across runs and the analyst
//   - concurrency: how many agent runs may be live at once (auto-started issues included)
const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./env.cjs');

const DEFAULTS = {
  maxRunTokens: 1_500_000, // input + output + cache, all turns of one run
  maxRunUsd: 3, // passed to claude --max-budget-usd; codex is held by maxRunTokens
  dailyTokens: 12_000_000,
  maxConcurrent: 2,
  analystModel: 'haiku',
};

const ledgerFile = () => path.join(dataDir, 'spend.json');
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

function readLedger() {
  try { return JSON.parse(fs.readFileSync(ledgerFile(), 'utf8')); } catch { return {}; }
}

// Records non-run spend (analyst, extraction). Runs are counted from their own records.
function charge(kind, tokens) {
  if (!tokens) return;
  const l = readLedger();
  const d = (l[day()] ||= {});
  d[kind] = (d[kind] || 0) + tokens;
  for (const k of Object.keys(l).sort().slice(0, -14)) delete l[k];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(ledgerFile(), JSON.stringify(l, null, 2));
}

const runTokens = (r) => {
  const u = r.usage || {};
  return (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
};

function status(limits, runs) {
  const b = { ...DEFAULTS, ...(limits || {}) };
  const today = day();
  const runSpend = runs.filter((r) => day(r.startedAt) === today).reduce((n, r) => n + runTokens(r), 0);
  const other = Object.values(readLedger()[today] || {}).reduce((n, v) => n + v, 0);
  const live = runs.filter((r) => ['preparing', 'running', 'verifying'].includes(r.status)).length;
  return { limits: b, today: runSpend + other, runs: runSpend, other, live, remaining: Math.max(0, b.dailyTokens - runSpend - other) };
}

function canStart(limits, runs) {
  const s = status(limits, runs);
  if (s.live >= s.limits.maxConcurrent) return { ok: false, reason: `${s.live} runs already live (limit ${s.limits.maxConcurrent})`, status: s };
  if (s.remaining <= 0) return { ok: false, reason: `daily token budget spent (${s.today.toLocaleString()} / ${s.limits.dailyTokens.toLocaleString()})`, status: s };
  return { ok: true, status: s };
}

module.exports = { DEFAULTS, status, canStart, charge, runTokens };

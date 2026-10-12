// Creator CFO: what each mod cost to make, what to charge, and what the next one will cost, backed by cfo.ai.
// The numbers come from the agents' recorded API usage (mod.json sessions). Questions go to a Claude Code session
// with the cfo.ai MCP server (https://api.cfo.ai/mcp), which reads and extends the creator's cfo.ai model.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { dataDir, env } = require('./env.cjs');
const { resolveExecutable } = require('./processes.cjs');
const { runClaude } = require('./studio/claude.cjs');
const repo = require('./studio/repo.cjs');

const CFO_URL = 'https://api.cfo.ai/mcp';
const SERVER = 'cfoai';
const PRICES = [0.99, 1.99, 4.99];
const cfoDir = path.join(dataDir, 'cfo');
const asksFile = path.join(cfoDir, 'asks.json');
const csvFile = path.join(cfoDir, 'build-costs.csv');

let active = null; // { id, stop }

const round = (n) => Math.round(n * 10000) / 10000;
const sum = (xs, f = (x) => x) => xs.reduce((n, x) => n + (f(x) || 0), 0);
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Every agent session of a mod, with whether it was rework: any attempt after the first one of its turn
// (a fix, its rebuild and its re-playtest).
function sessionsOf(mod) {
  const firstOfTurn = new Map();
  for (const a of mod.attempts || []) {
    const t = a.turn ?? 0;
    if (!firstOfTurn.has(t) || a.n < firstOfTurn.get(t)) firstOfTurn.set(t, a.n);
  }
  return [
    ...(mod.sessions || []).map((s) => ({ ...s, attempt: null, rework: false })),
    ...(mod.attempts || []).flatMap((a) => (a.sessions || []).map((s) => ({ ...s, attempt: a.n, turn: a.turn ?? 0, rework: a.n !== firstOfTurn.get(a.turn ?? 0) }))),
  ];
}

const latestTurnAttempts = (mod) => {
  const t = Math.max(0, (mod.turns?.length || 1) - 1);
  return (mod.attempts || []).filter((a) => (a.turn ?? 0) === t).length;
};

function rowOf(mod) {
  const ss = sessionsOf(mod);
  const priced = ss.filter((s) => Number.isFinite(s.usage?.costUsd));
  const cost = sum(priced, (s) => s.usage.costUsd);
  const costComplete = ss.length > 0 && priced.length === ss.length;
  const byRole = {};
  for (const s of ss) byRole[s.role] = round((byRole[s.role] || 0) + (s.usage?.costUsd || 0));
  return {
    id: mod.id, name: mod.name, status: mod.status, remix: Boolean(mod.origin), remixOf: mod.origin?.name || mod.origin?.marketplace || null,
    createdAt: mod.createdAt, prompt: String(mod.prompt || '').slice(0, 300), summary: String(mod.spec?.summary || '').slice(0, 300),
    turns: mod.turns?.length || 1, attempts: (mod.attempts || []).length, attemptsLatestTurn: latestTurnAttempts(mod), sessions: ss.length,
    cost: priced.length ? round(cost) : null, costComplete, costedSessions: priced.length, uncostedSessions: ss.length - priced.length,
    rework: priced.length ? round(sum(priced.filter((s) => s.rework), (s) => s.usage.costUsd)) : null,
    minutes: round(sum(ss, (s) => (s.endedAt && s.startedAt ? (s.endedAt - s.startedAt) / 60000 : 0))),
    tokens: sum(ss, (s) => (s.usage?.inputTokens || 0) + (s.usage?.outputTokens || 0) + (s.usage?.cacheReadInputTokens || 0) + (s.usage?.cacheCreationInputTokens || 0)),
    byRole,
    breakEven: PRICES.map((price) => ({ price, sales: costComplete ? Math.ceil(cost / price) : null })),
  };
}

// The creator's books: one row per mod plus the totals a CFO would ask for first.
function books(mods) {
  const rows = mods.filter((m) => !m.running).map(rowOf).sort((a, b) => b.createdAt - a.createdAt);
  const costed = rows.filter((r) => r.cost != null);
  const complete = rows.filter((r) => r.costComplete);
  const passed = rows.filter((r) => r.status === 'passed');
  const failed = rows.filter((r) => r.status !== 'passed');
  const spend = sum(costed, (r) => r.cost);
  const byRole = {};
  const byModel = {};
  for (const m of mods.filter((m) => !m.running)) {
    for (const s of sessionsOf(m)) {
      if (!Number.isFinite(s.usage?.costUsd)) continue;
      byRole[s.role] = round((byRole[s.role] || 0) + s.usage.costUsd);
      byModel[s.model || 'unknown'] = round((byModel[s.model || 'unknown'] || 0) + s.usage.costUsd);
    }
  }
  const scratch = complete.filter((r) => !r.remix && r.status === 'passed');
  const finished = rows.filter((r) => ['passed', 'failed'].includes(r.status));
  const remixCosts = complete.filter((r) => r.remix).map((r) => r.cost);
  const scratchCosts = scratch.map((r) => r.cost);
  return {
    at: Date.now(),
    currency: 'USD',
    source: 'Recorded API cost of every Benana agent session (spec, builder, playtester, fixer), from ~/.benana/studio/*/mod.json',
    totals: {
      spend: round(spend),
      mods: rows.length,
      passed: passed.length,
      failed: failed.length,
      // True cost of a verified mod: everything spent, including mods that never passed, divided by the ones that did.
      costPerVerifiedMod: passed.length && rows.every((r) => r.costComplete) ? round(spend / passed.length) : null,
      costedSessions: sum(rows, (r) => r.costedSessions),
      uncostedSessions: sum(rows, (r) => r.uncostedSessions),
      medianPassedMod: median(passed.filter((r) => r.costComplete).map((r) => r.cost)),
      rework: round(sum(costed, (r) => r.rework)),
      reworkShare: spend ? round(sum(costed, (r) => r.rework) / spend) : 0,
      failedSpend: round(sum(failed, (r) => r.cost)),
      firstTryRate: finished.length ? round(finished.filter((r) => r.status === 'passed' && r.attemptsLatestTurn === 1).length / finished.length) : null,
      remixes: rows.filter((r) => r.remix).length,
      remixMedianCost: remixCosts.length ? round(median(remixCosts)) : null,
      scratchMedianCost: scratchCosts.length ? round(median(scratchCosts)) : null,
      byRole,
      byModel,
    },
    mods: rows,
  };
}

const STOP = new Set('the and for with that this when from into your their they them have has are was were will can make makes made mod mods plugin player players minecraft adds add like each also its it'.split(' '));
const words = (s) => new Set((String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)));

// What a new mod will probably cost, from the most similar mods already built (by the words of their requests).
function quote(mods, prompt) {
  const want = words(prompt);
  const rows = mods.filter((m) => !m.running).map((m) => ({ mod: m, row: rowOf(m) })).filter(({ row }) => row.status === 'passed' && row.costComplete && row.cost > 0 && !row.remix);
  if (!rows.length) return { ok: false, error: 'Build a mod first; quotes come from your own build history.' };
  const scored = rows.map(({ mod, row }) => {
    const have = words(`${mod.name} ${mod.prompt || ''} ${mod.spec?.summary || ''}`);
    const shared = [...want].filter((w) => have.has(w));
    return { row, shared, score: shared.length / Math.max(1, Math.min(want.size, have.size)) };
  }).sort((a, b) => b.score - a.score);
  const similar = scored.filter((s) => s.score >= 0.15).slice(0, 3);
  const basis = similar.length ? similar : scored;
  const costs = basis.map((b) => b.row.cost);
  const finished = rows.filter(({ row }) => ['passed', 'failed'].includes(row.status));
  const needingFix = finished.filter(({ row }) => row.attemptsLatestTurn > 1).length;
  const extraAttempts = sum(rows, ({ row }) => Math.max(0, row.attempts - row.turns));
  const reworkTotal = sum(rows, ({ row }) => row.rework);
  return {
    ok: true,
    expected: round(sum(costs) / costs.length),
    low: round(Math.min(...costs)),
    high: round(Math.max(...costs)),
    fixChance: finished.length ? round(needingFix / finished.length) : null,
    costPerFix: extraAttempts ? round(reworkTotal / extraAttempts) : null,
    matched: Boolean(similar.length),
    basis: basis.map((b) => ({ name: b.row.name, cost: b.row.cost, attempts: b.row.attempts, status: b.row.status, shared: b.shared.slice(0, 4) })),
  };
}

const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// One row per agent session: the file to upload to cfo.ai as a data source (Integrations → Data upload → CSV).
function exportCsv(mods) {
  const head = ['date', 'mod', 'mod_id', 'mod_status', 'remix', 'turn', 'attempt', 'rework', 'role', 'model', 'duration_s', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd'];
  const lines = [head.join(',')];
  for (const m of mods) {
    for (const s of sessionsOf(m)) {
      if (!s.usage) continue;
      lines.push([
        new Date(s.startedAt || m.createdAt).toISOString(), m.name, m.id, m.status, Boolean(m.origin), s.turn ?? 0, s.attempt ?? '', s.rework, s.role, s.model || '',
        s.endedAt && s.startedAt ? Math.round((s.endedAt - s.startedAt) / 1000) : '',
        s.usage.inputTokens || 0, s.usage.outputTokens || 0, s.usage.cacheReadInputTokens || 0, s.usage.cacheCreationInputTokens || 0,
        Number.isFinite(s.usage.costUsd) ? round(s.usage.costUsd) : '',
      ].map(csvCell).join(','));
    }
  }
  fs.mkdirSync(cfoDir, { recursive: true });
  fs.writeFileSync(csvFile, `${lines.join('\n')}\n`);
  return { file: csvFile, dir: cfoDir, rows: lines.length - 1 };
}

function claudeCli(args, { timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const bin = resolveExecutable('claude');
    const shell = /\.(cmd|bat)$/i.test(bin);
    execFile(shell ? `"${bin}"` : bin, args, { shell, timeout: timeoutMs, windowsHide: true, cwd: dataDir },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout || ''), err: String(stderr || error?.message || ''), missing: error?.code === 'ENOENT' }));
  });
}

// Whether Claude Code has the cfo.ai MCP server, and whether it is signed in.
async function status() {
  const r = await claudeCli(['mcp', 'get', SERVER]);
  const text = `${r.out}\n${r.err}`;
  if (r.missing) return { added: false, state: 'no-claude', detail: 'Claude Code is not installed.' };
  if (/No MCP server named/i.test(text)) return { added: false, state: 'not-added', url: CFO_URL };
  if (!r.ok) return { added: false, state: 'failed', detail: text.trim().slice(0, 300), url: CFO_URL };
  const line = (text.match(/Status:\s*(.+)/) || [])[1] || '';
  const state = /connected/i.test(line) ? 'connected' : /auth/i.test(line) ? 'needs-auth' : /fail/i.test(line) ? 'failed' : 'unknown';
  return { added: true, state, detail: line.replace(/^[^\w]+/, '').trim(), url: CFO_URL, org: env('CFOAI_ORG') || null };
}

// Adds cfo.ai to Claude Code for this user (the same server the docs set up), then reports its status.
async function connect() {
  const now = await status();
  if (!now.added) {
    const r = await claudeCli(['mcp', 'add', '--transport', 'http', '--scope', 'user', SERVER, CFO_URL]);
    if (!r.ok) throw new Error(`Could not add cfo.ai to Claude Code: ${(r.err || r.out).trim().slice(0, 300)}`);
  }
  return status();
}

// Claude Code runs the remote server's OAuth flow in a terminal and opens the browser.
function signIn() {
  fs.mkdirSync(cfoDir, { recursive: true });
  const opts = { cwd: cfoDir, detached: true, stdio: 'ignore' };
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', `claude mcp login ${SERVER}`], { ...opts, windowsHide: false }).unref();
  else if (process.platform === 'darwin') spawn('osascript', ['-e', `tell application "Terminal" to do script "cd '${cfoDir}' && claude mcp login ${SERVER}"`, '-e', 'tell application "Terminal" to activate'], opts).unref();
  else spawn('x-terminal-emulator', ['-e', 'claude', 'mcp', 'login', SERVER], opts).unref();
  return { opened: true, steps: ['Approve cfo.ai access in the browser.', 'Return to Benana and press Check.'] };
}

function history() {
  try { return JSON.parse(fs.readFileSync(asksFile, 'utf8')); } catch { return []; }
}

function system(org) {
  return [
    'You are the creator\'s CFO inside Benana Mod Studio, a desktop app where AI agents build, playtest and fix Minecraft mods that creators publish on a marketplace.',
    'You work through cfo.ai, the creator\'s financial modeling workspace, using its MCP tools (mcp__cfoai__*). Benana\'s real build data is in the current folder:',
    '- books.json: per-mod build cost, rework (fix attempts), attempts, break-even sales at sample prices, and totals, from the agents\' recorded API usage.',
    '- build-costs.csv: one row per agent session.',
    '',
    'How to work:',
    `1. Call mcp__cfoai__list_orgs first. Use ${org ? `the workspace "${org}"` : 'the user\'s workspace (if there are several, the first one, and say which)'} and pass its id as org_id on every later call.`,
    '2. Discover and use the available cfo.ai read tools to inspect the existing model before answering. Follow their current schemas instead of assuming a fixed tool list.',
    '3. Take build costs from books.json. Never invent figures; label assumptions as assumptions.',
    '4. Change cfo.ai only when the question asks you to record, sync, model, plan or alert. Then add new items whose names start with "Benana". Never delete or overwrite existing pages, scenarios, table blocks or triggers.',
    '5. If a cfo.ai tool fails or needs sign-in, say so plainly and answer from books.json, labelled as Benana\'s numbers only.',
    '',
    'Reply in under 180 words of plain markdown: short paragraphs, "-" bullets, **bold** for the key numbers, no tables or headings.',
    'End with one line starting "In cfo.ai:" that says what you read or changed there, or "nothing" if you could not reach it.',
  ].join('\n');
}

// Asks the creator's CFO one question. Streams tool calls and text as cfo:event; resolves with the answer.
async function ask({ question, mods, emit = () => {} }) {
  question = String(question || '').trim();
  if (!question) throw new Error('Ask a question first.');
  if (active) throw new Error('Your CFO is still answering the last question.');
  const id = `ask_${Date.now().toString(36)}`;
  const entry = { id, question, at: Date.now(), tools: [], answer: '', sessionId: null, usage: null, error: null };
  active = { id, question, events: [], stopped: false, stop: () => { active.stopped = true; } };
  const publish = (event) => {
    active?.events.push(event);
    emit('cfo:event', event);
  };
  publish({ askId: id, kind: 'start', question });
  try {
    fs.mkdirSync(cfoDir, { recursive: true });
    fs.writeFileSync(path.join(cfoDir, 'books.json'), JSON.stringify(books(mods), null, 2));
    exportCsv(mods);
    if (!fs.existsSync(path.join(cfoDir, '.claude', 'settings.json'))) await repo.enableNeatlogs(cfoDir).catch(() => {});
    if (active.stopped) throw new Error('Stopped.');
    const handle = runClaude({
      cwd: cfoDir, prompt: question, model: 'sonnet', tools: ['Read'],
      allowedTools: ['Read', `mcp__${SERVER}__*`], appendSystemPrompt: system(env('CFOAI_ORG')),
      settingSources: 'user,project,local', timeoutMs: 6 * 60 * 1000,
      onEvent: (ev) => {
        if (ev.kind === 'session') { entry.sessionId = ev.sessionId; return; }
        const isCfo = ev.rawName?.startsWith(`mcp__${SERVER}__`) || false;
        if (ev.kind === 'tool') entry.tools.push({ name: ev.name, cfo: isCfo });
        publish({ askId: id, kind: ev.kind, name: ev.name, text: ev.kind === 'tool' ? ev.summary : ev.text, isError: ev.isError, cfo: isCfo });
      },
    });
    active.stop = () => { active.stopped = true; handle.stop(); };
    const res = await handle.done;
    Object.assign(entry, { answer: res.final || '', sessionId: res.sessionId || entry.sessionId, usage: res.usage, error: res.error });
  } catch (error) {
    entry.error = error.message;
  }
  active.entry = entry;
  try {
    fs.writeFileSync(asksFile, JSON.stringify([entry, ...history()].slice(0, 30), null, 2));
  } catch (error) {
    entry.error ||= `Could not save CFO history: ${error.message}`;
  }
  emit('cfo:event', { askId: id, kind: 'done', entry });
  active = null;
  return entry;
}

function activeAsk() {
  if (!active) return null;
  return { id: active.id, question: active.question, events: active.events.filter((event) => event.kind !== 'start').slice(-40), ...(active.entry ? { entry: active.entry } : {}) };
}

function stop() {
  if (!active) return false;
  active.stop();
  return true;
}

module.exports = { books, quote, exportCsv, status, connect, signIn, ask, activeAsk, stop, history, CFO_URL };

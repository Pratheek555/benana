#!/usr/bin/env node
// Benana minecraft MCP server (stdio, newline-delimited JSON-RPC). Owner: Track A.
// Gives a Claude Code playtester control of the in-game bot through Benana's local control API,
// and records the verdict file the studio pipeline reads (docs/hackathon/CONTRACTS.md).
// Env: BENANA_GAME_URL, BENANA_VERDICT_FILE, BENANA_TEST_PLAN, BENANA_RUN_ID.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const gameUrl = process.env.BENANA_GAME_URL;
const verdictFile = process.env.BENANA_VERDICT_FILE;
const runId = process.env.BENANA_RUN_ID || 'manual';
const startedAt = Date.now();

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const entityId = { type: 'number', description: 'Entity id from nearby_entities' };
const position = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z]' };
const trackTicks = { type: 'number', description: 'Record the target for this many ticks right after the action (20 ticks = 1s). Use it whenever the expected effect is movement.' };

const tools = [
  { name: 'game_setup', description: 'Run server console commands as the bot (no leading slash). `@bot` is the bot; ^ and ~ coordinates are relative to it. Use for the test plan setup: give items, summon mobs, set time.', inputSchema: obj({ commands: { type: 'array', items: { type: 'string' } } }, ['commands']) },
  { name: 'bot_state', description: 'Bot position, health, held item and inventory.', inputSchema: obj({}) },
  { name: 'nearby_entities', description: 'Entities near the bot with id, type, position, velocity and distance, nearest first.', inputSchema: obj({ radius: { type: 'number' } }) },
  { name: 'equip', description: 'Hold an inventory item, e.g. golden_sword.', inputSchema: obj({ item: { type: 'string' } }, ['item']) },
  { name: 'look_at', description: 'Aim at an entity or position.', inputSchema: obj({ entityId, position }) },
  { name: 'move_to', description: 'Walk to an entity or position.', inputSchema: obj({ entityId, position, range: { type: 'number' } }) },
  { name: 'attack', description: 'Left-click (hit) an entity with the held item. Walks into reach first if needed.', inputSchema: obj({ entityId, trackTicks }, ['entityId']) },
  { name: 'attack_sequence', description: 'Hit several entities back to back, intervalTicks apart (default 4), in ONE call, and track each. Use for cooldowns and combos; separate attack calls are seconds apart.', inputSchema: obj({ entityIds: { type: 'array', items: { type: 'number' } }, intervalTicks: { type: 'number' }, trackTicks }, ['entityIds']) },
  { name: 'use_item', description: 'Right-click with the held item, on an entity if entityId is given.', inputSchema: obj({ entityId, trackTicks }) },
  { name: 'track_entity', description: 'Sample an entity every tick: position, velocity, and position delta, plus maxUpwardVelocity and maxHeightGain.', inputSchema: obj({ entityId, ticks: { type: 'number' } }, ['entityId']) },
  { name: 'wait_ticks', description: 'Let the game run (20 ticks = 1 second).', inputSchema: obj({ ticks: { type: 'number' } }, ['ticks']) },
  { name: 'chat', description: 'Say something or run a player command like /launch.', inputSchema: obj({ message: { type: 'string' } }, ['message']) },
  { name: 'read_chat', description: 'Chat messages the bot has seen, optionally since a unix ms timestamp.', inputSchema: obj({ sinceMs: { type: 'number' } }) },
  { name: 'server_log', description: 'Server console lines since a unix ms timestamp (default: since this playtest started). level "error" shows plugin exceptions.', inputSchema: obj({ sinceMs: { type: 'number' }, level: { type: 'string', enum: ['error', 'warn'] } }) },
  {
    name: 'report_check',
    description: 'Record the result of one test plan check. Call once per check id.',
    inputSchema: obj({
      id: { type: 'string' },
      status: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
      expected: { type: 'string' },
      observed: { type: 'string', description: 'What actually happened, with numbers' },
      evidence: { type: 'object', description: 'Measurements, samples, or log lines supporting the result' },
      suspectedCause: { type: 'string', description: 'For failures: your best guess at the plugin bug' },
    }, ['id', 'status', 'expected', 'observed']),
  },
  { name: 'finish', description: 'Finalize the playtest after every check is reported.', inputSchema: obj({ summary: { type: 'string' } }, ['summary']) },
];

async function game(tool, args) {
  if (!gameUrl) throw new Error('BENANA_GAME_URL is not set; start the game in Benana first.');
  const res = await fetch(`${gameUrl}/tool/${tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error);
  return out.result;
}

function readVerdict() {
  try { return JSON.parse(fs.readFileSync(verdictFile, 'utf8')); }
  catch { return { version: 1, runId, finished: false, passed: false, summary: '', checks: [], serverErrors: [] }; }
}

function writeVerdict(v) {
  if (!verdictFile) throw new Error('BENANA_VERDICT_FILE is not set.');
  fs.mkdirSync(path.dirname(verdictFile), { recursive: true });
  fs.writeFileSync(verdictFile, JSON.stringify(v, null, 2));
}

// Group console error lines and their stack frames into one entry per exception.
function groupErrors(lines) {
  const out = [];
  for (const l of lines) {
    const frame = /^\s*(at |Caused by|\.\.\. \d+ more)/.test(l.line);
    if (frame && out.length) out[out.length - 1].stack += `${l.line}\n`;
    else out.push({ at: l.at, message: l.line, stack: '' });
  }
  return out;
}

async function call(name, a) {
  if (name === 'server_log') return game('server_log', { sinceMs: a.sinceMs ?? startedAt, level: a.level });
  if (name === 'report_check') {
    const v = readVerdict();
    const check = { id: a.id, status: a.status, expected: a.expected, observed: a.observed, evidence: a.evidence || {}, ...(a.suspectedCause ? { suspectedCause: a.suspectedCause } : {}) };
    v.checks = [...v.checks.filter((c) => c.id !== a.id), check];
    writeVerdict(v);
    return { recorded: a.id, checks: v.checks.length };
  }
  if (name === 'finish') {
    const v = readVerdict();
    v.serverErrors = groupErrors(await game('server_log', { sinceMs: startedAt, level: 'error' }));
    v.finished = true;
    v.summary = a.summary;
    v.passed = v.checks.length > 0 && v.checks.every((c) => c.status === 'pass') && v.serverErrors.length === 0;
    writeVerdict(v);
    return { passed: v.passed, checks: v.checks.map((c) => `${c.id}: ${c.status}`), serverErrors: v.serverErrors.length };
  }
  return game(name, a);
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = req;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'benana-minecraft', version: '0.1.0' } } });
    } else if (method === 'tools/list') {
      send({ id, result: { tools } });
    } else if (method === 'tools/call') {
      const out = await call(params.name, params.arguments || {});
      send({ id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
    } else if (method === 'ping') {
      send({ id, result: {} });
    } else {
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
  }
});

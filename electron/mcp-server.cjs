#!/usr/bin/env node
// Benana intent MCP server (stdio, newline-delimited JSON-RPC).
// Gives any Claude Code / Codex session tools over the local intent graph:
//   intent_context, intent_check, intent_record
// and, inside a Benana run (BENANA_WORKTREE set), token-efficient execution tools (SoL-Pi):
//   bench_run       run a command; large logs come back as a verified receipt or a handle
//   bench_edit_run  Action Fusion: apply an edit and run its check in one request
//   bench_page      ObservationPack: read the exact archived text behind a handle
// Env: BENANA_INTENT_DIR (intent repo on disk), BENANA_ATTEMPT (optional attempt id),
//      BENANA_WORKTREE, BENANA_OBS_DIR, BENANA_MECH (comma list of enabled mechanisms).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { RepoStore } = require('./lib/store.cjs');
const graph = require('./lib/graph.cjs');
const { observe, Pack } = require('./lib/observe.cjs');

const dir = process.env.BENANA_INTENT_DIR;
const attempt = process.env.BENANA_ATTEMPT || 'external';
const worktree = process.env.BENANA_WORKTREE ? path.resolve(process.env.BENANA_WORKTREE) : '';
const obsDir = process.env.BENANA_OBS_DIR || '';
const mech = new Set((process.env.BENANA_MECH || '').split(',').filter(Boolean));
const pack = obsDir && mech.has('observationPack') ? new Pack(path.join(obsDir, 'archive')) : null;
const store = Object.assign(Object.create(RepoStore.prototype), { dir, kind: 'intent', repo: 'local', name: 'local' });

// Counters the harness reads back after the run (for the analyst's map step).
function bump(key) {
  if (!obsDir) return;
  const f = path.join(obsDir, 'stats.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first write */ }
  s[key] = (s[key] || 0) + 1;
  fs.mkdirSync(obsDir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s));
}

function sh(command, timeoutSec = 300) {
  return new Promise((resolve) => {
    const p = spawn('/bin/sh', ['-c', command], { cwd: worktree, env: process.env });
    let out = '';
    const cap = 8 * 1024 * 1024;
    const onData = (d) => { if (out.length < cap) out += d; };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const t = setTimeout(() => { out += `\n[killed after ${timeoutSec}s]`; p.kill('SIGKILL'); }, timeoutSec * 1000);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
  });
}

async function runObserved(command, timeoutSec) {
  const { code, out } = await sh(command, Math.min(Number(timeoutSec) || 300, 1800));
  const o = mech.has('evidenceReducer') || pack
    ? observe(out, { pack, command, exitCode: code, label: 'output' })
    : { text: out };
  if (o.reduced) bump('reduced');
  if (o.packed) bump('packed');
  return { exitCode: code, output: o.text };
}

function inWorktree(rel) {
  const abs = path.resolve(worktree, rel);
  if (abs !== worktree && !abs.startsWith(worktree + path.sep)) throw new Error('path escapes the worktree');
  return abs;
}

function applyEdit({ path: rel, old_string: oldS = '', new_string: newS = '', content }) {
  const file = inWorktree(rel);
  if (content != null) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return `wrote ${rel}`;
  }
  const text = fs.readFileSync(file, 'utf8');
  const first = text.indexOf(oldS);
  if (!oldS || first < 0) throw new Error(`old_string not found in ${rel}`);
  if (text.indexOf(oldS, first + 1) >= 0) throw new Error(`old_string is not unique in ${rel}; include more context`);
  fs.writeFileSync(file, text.slice(0, first) + newS + text.slice(first + oldS.length));
  return `edited ${rel}`;
}

const tools = [
  {
    name: 'intent_context',
    description: 'Before planning: get past decisions, dead ends and project directions relevant to a task and/or files. Use this first.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['task'] },
  },
  {
    name: 'intent_check',
    description: 'Before editing: check a plan (and the files it touches) against past dead ends and decisions. Returns conflicts with sources.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['plan'] },
  },
  {
    name: 'intent_record',
    description: 'Record your intent so future contributors see it: a Decision you made (with reason), a DeadEnd you hit, or an Intent you are pursuing.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['Decision', 'DeadEnd', 'Intent'] },
        title: { type: 'string' }, reason: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
      },
      required: ['type', 'title', 'reason'],
    },
  },
];

if (worktree) {
  tools.push({
    name: 'bench_run',
    description: 'Run a shell command in the task worktree. Long build/test logs are returned as a receipt of exact evidence lines, and very large outputs as a handle with head/tail excerpts.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeout_sec: { type: 'number' } }, required: ['command'] },
  });
  if (mech.has('actionFusion')) tools.push({
    name: 'bench_edit_run',
    description: 'Apply one file edit (exact unique old_string → new_string, or full content) and then run a follow-up command (build/test/run), returning both outcomes in one result. Saves a model round trip. Do not use it when you need to inspect the edit before running.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, content: { type: 'string' }, then_run: { type: 'string' }, timeout_sec: { type: 'number' } },
      required: ['path', 'then_run'],
    },
  });
  if (pack) tools.push({
    name: 'bench_page',
    description: 'Read exact text behind an archived output handle (obs_…), by character offset.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string' }, offset: { type: 'number' }, length: { type: 'number' } }, required: ['handle'] },
  });
}

async function call(name, a) {
  if (name === 'bench_run') { bump('run'); return runObserved(a.command, a.timeout_sec); }
  if (name === 'bench_edit_run') {
    const edit = applyEdit(a);
    bump('fused');
    return { edit, ...(await runObserved(a.then_run, a.timeout_sec)) };
  }
  if (name === 'bench_page') { bump('page'); return pack.page(a.handle, { offset: a.offset || 0, length: a.length || 8000 }); }

  const g = graph.loadGraph(store);
  if (name === 'intent_context') return graph.context(g, { text: a.task, files: a.files || [] });
  if (name === 'intent_check') {
    const conflicts = graph.check(g, { text: a.plan, files: a.files || [], attempt });
    return { ok: conflicts.length === 0, conflicts };
  }
  if (name === 'intent_record') {
    const node = graph.record(store, { type: a.type, title: a.title, reason: a.reason, touches: a.files || [], source: `agent:${attempt}`, attempt });
    return { recorded: node.id };
  }
  throw new Error(`unknown tool ${name}`);
}

// Command results go back as plain text: JSON-escaping a log inflates it and hurts reading.
function render(out) {
  if (typeof out === 'string') return out;
  if (out && 'output' in out) return `${out.edit ? `${out.edit}\n` : ''}exit ${out.exitCode}\n${out.output}`;
  if (out && 'handle' in out && 'text' in out) return `[${out.handle} ${out.offset}-${out.offset + out.text.length} of ${out.total}${out.more ? ', more' : ''}]\n${out.text}`;
  return JSON.stringify(out, null, 2);
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = req;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'benana-intent', version: '0.2.0' } } });
    } else if (method === 'tools/list') {
      send({ id, result: { tools } });
    } else if (method === 'tools/call') {
      call(params.name, params.arguments || {})
        .then((out) => send({ id, result: { content: [{ type: 'text', text: render(out) }] } }))
        .catch((e) => send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } }));
    } else if (method === 'ping') {
      send({ id, result: {} });
    } else {
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
  }
});

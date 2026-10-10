// Loop 1 (agent) + Loop 2 (verify). Each attempt gets:
//   - its own git worktree of the user's local checkout
//   - its own fork of the intent repo (local clone + Artifacts fork when configured)
//   - the benana-intent MCP server, the harness system prompt and pre-loaded intent context
//   - a harness version: the promoted one, or the candidate while a trial is running (L4)
//   - a token budget; the run is stopped when it is crossed
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { git } = require('./git.cjs');
const { dataDir, appRoot } = require('./env.cjs');
const graph = require('./graph.cjs');
const harnessLib = require('./harness.cjs');
const improve = require('./improve.cjs');
const budget = require('./budget.cjs');
const artifacts = require('./artifacts.cjs');
const { reduce, compactGate } = require('./observe.cjs');

const MCP = path.join(appRoot, 'electron', 'mcp-server.cjs');
const LIVE = new Set(['preparing', 'running', 'verifying']);
const runs = new Map();
const BENCH_TOOLS = ['bench_run', 'bench_edit_run', 'bench_page'].map((t) => `mcp__benana-intent__${t}`);

function runsDir() { const d = path.join(dataDir, 'runs'); fs.mkdirSync(d, { recursive: true }); return d; }
function saveRun(r) {
  const { proc, emitTimer, ...rest } = r;
  fs.writeFileSync(path.join(runsDir(), `${r.id}.json`), JSON.stringify(rest, null, 2));
}
function allRuns() {
  const disk = fs.readdirSync(runsDir()).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir(), f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
  // Live runs are fresher in memory than on disk.
  const byId = new Map(disk.map((r) => [r.id, r]));
  for (const r of runs.values()) byId.set(r.id, r);
  return [...byId.values()].map((r) => (LIVE.has(r.status) && !runs.has(r.id) ? { ...r, status: 'interrupted' } : r))
    .sort((a, b) => b.startedAt - a.startedAt);
}

// Shared per-run plumbing: transcript lines and throttled state pushes to the UI.
function wire(r, emit, ctx) {
  const say = (role, text) => { r.transcript.push({ role, text: String(text).slice(0, 4000), at: Date.now() }); emit('transcript', { id: r.id, line: r.transcript.at(-1) }); };
  const update = (patch = {}) => {
    Object.assign(r, patch);
    if (r.emitTimer) return;
    r.emitTimer = setTimeout(() => { r.emitTimer = null; emit('run', publicRun(r)); }, 120);
  };
  return { say, update, emit, ctx };
}

function addUsage(r, u) {
  const t = r.usage;
  for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'turns']) t[k] = (t[k] || 0) + (u[k] || 0);
}

async function start({ ctx, task, issue, agent, force = false }, emit) {
  const { intent, harnessStore, repoPath } = ctx;
  if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) throw new Error('Set a local checkout path for this repo first.');
  const promoted = harnessLib.load(harnessStore);
  const gate = budget.canStart(promoted.budget, allRuns());
  if (!gate.ok && !force) throw new Error(`Not starting: ${gate.reason}.`);
  const { harness: h, arm, trial } = improve.pickHarness(harnessStore);
  const id = `a${Date.now().toString(36).slice(-6)}`;
  const kind = agent || h.agent;
  const r = {
    id, kind, origin: 'native', task, issue: issue || null, status: 'preparing', step: 0,
    startedAt: Date.now(), attempt: 1, harnessVersion: h.version, arm, trial, transcript: [], verify: [], usage: {},
    compactions: 0,
  };
  runs.set(id, r);
  const hooks = wire(r, emit, ctx);
  const { say, update } = hooks;
  update();
  if (arm === 'candidate') say('system', `trial: using candidate harness v${h.version}`);

  try {
    // Workspace: a dedicated worktree so the user's own checkout is never touched.
    r.worktree = path.join(dataDir, 'worktrees', id);
    fs.mkdirSync(path.dirname(r.worktree), { recursive: true });
    await git(repoPath, ['worktree', 'add', '-q', '-b', `benana/${id}`, r.worktree, 'HEAD']);
    r.baseSha = (await git(r.worktree, ['rev-parse', 'HEAD'])).trim();
    r.branch = `benana/${id}`;

    // Intent fork: local clone the agent writes to; mirrored as an Artifacts fork when configured.
    r.intentDir = path.join(dataDir, 'attempts', id, 'intent');
    fs.mkdirSync(path.dirname(r.intentDir), { recursive: true });
    await git(path.dirname(intent.dir), ['clone', '-q', intent.dir, r.intentDir]);
    await git(r.intentDir, ['config', 'user.name', `agent-${id}`]);
    await git(r.intentDir, ['config', 'user.email', `${id}@benana.local`]);
  } catch (e) {
    say('system', `workspace setup failed: ${e.message}`);
    update({ status: 'failed', endedAt: Date.now(), stopReason: 'setup' });
    saveRun(r);
    throw e;
  }
  if (artifacts.configured()) {
    r.artifactsForkPending = artifacts.fork(intent.name, `${intent.name}-${id}`)
      .then((f) => { r.artifactsFork = f?.name || `${intent.name}-${id}`; update(); })
      .catch((e) => say('system', `artifacts fork skipped: ${e.message}`));
  }

  const g = graph.loadGraph(intent);
  r.context = graph.context(g, { text: task });
  say('system', `intent.context → ${r.context.map((c) => c.id).join(', ') || 'nothing relevant yet'}`);
  update({ status: 'running' });
  r.prompt = buildPrompt(task, issue, r.context);
  runAgent(r, h, r.prompt, hooks);
  return publicRun(r);
}

function buildPrompt(task, issue, ctxNodes) {
  const lines = [];
  if (issue) lines.push(`GitHub issue #${issue.number}: ${issue.title}\n${(issue.body || '').slice(0, 2000)}`);
  lines.push(`Task: ${task}`);
  if (ctxNodes.length) {
    lines.push('\nRelevant project intent (from the Benana intent graph; cite ids when you rely on them):');
    for (const c of ctxNodes) lines.push(`- [${c.type} ${c.id}] ${c.title}${c.reason ? ` — ${c.reason}` : ''} (${c.status}, conf ${c.confidence})`);
  }
  return lines.join('\n');
}

function mcpEnv(r, h) {
  const mech = Object.entries(h.mechanisms || {}).filter(([, on]) => on).map(([k]) => k).join(',');
  return { BENANA_INTENT_DIR: r.intentDir, BENANA_ATTEMPT: r.id, BENANA_WORKTREE: r.worktree, BENANA_OBS_DIR: path.join(dataDir, 'attempts', r.id, 'obs'), BENANA_MECH: mech };
}

function agentCommand(r, h, prompt, resumeId) {
  const env = mcpEnv(r, h);
  if (r.kind === 'codex') {
    const envToml = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',');
    const args = ['exec', '--json', '--full-auto', '--skip-git-repo-check', '-C', r.worktree,
      '-c', 'mcp_servers.benana-intent.command="node"',
      '-c', `mcp_servers.benana-intent.args=[${JSON.stringify(MCP)}]`,
      '-c', `mcp_servers.benana-intent.env={${envToml}}`];
    if (resumeId) args.splice(1, 0, 'resume', resumeId);
    args.push(`${harnessLib.systemPrompt(h)}\n\n${prompt}`);
    return { cmd: 'codex', args };
  }
  const mcpFile = path.join(dataDir, 'attempts', r.id, 'mcp.json');
  fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { 'benana-intent': { command: 'node', args: [MCP], env } } }));
  const allowed = ['mcp__benana-intent__intent_context', 'mcp__benana-intent__intent_check', 'mcp__benana-intent__intent_record', ...BENCH_TOOLS, 'Read', 'Edit', 'Write', 'Glob', 'Grep'];
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', mcpFile,
    '--append-system-prompt', harnessLib.systemPrompt(h), '--permission-mode', 'acceptEdits',
    '--allowedTools', allowed.join(',')];
  const usd = h.budget?.maxRunUsd;
  if (usd > 0) args.push('--max-budget-usd', String(Math.max(0.05, usd - (r.usage.costUsd || 0)).toFixed(2)));
  if (resumeId) args.push('--resume', resumeId);
  return { cmd: 'claude', args, stdin: prompt };
}

function runAgent(r, h, prompt, hooks) {
  const { say, update } = hooks;
  return new Promise((resolve) => {
    const { cmd, args, stdin } = agentCommand(r, h, prompt, r.sessionId);
    const proc = spawn(cmd, args, { cwd: r.worktree, env: process.env });
    r.proc = proc;
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleEvent(r, h, line, say, update);
      }
    });
    proc.stderr.on('data', (d) => { const t = String(d).trim(); if (t && !/^Reading prompt/.test(t)) say('stderr', t); });
    proc.on('error', (e) => { say('system', `failed to start ${cmd}: ${e.message}`); r.stopReason = 'spawn'; });
    proc.on('close', async (code) => {
      r.proc = null;
      // Killed before its result event (budget/stop): keep the streamed estimate.
      if (r.liveTokens) { addUsage(r, { inputTokens: r.liveTokens }); r.liveTokens = 0; }
      try {
        if (r.status === 'stopped') { r.endedAt = Date.now(); saveRun(r); return; }
        say('system', `${cmd} exited (${code})${r.stopReason === 'budget' ? ' — run token budget reached' : ''}`);
        if (r.stopReason === 'spawn') { update({ status: 'failed', endedAt: Date.now() }); saveRun(r); return; }
        if (r.pendingBrief && r.sessionId && r.stopReason !== 'budget') {
          const brief = r.pendingBrief;
          r.pendingBrief = null;
          say('system', 'sending your brief');
          await runAgent(r, h, brief, hooks);
          return;
        }
        await verifyAndMaybeRetry(r, h, hooks);
      } catch (e) {
        say('system', `run error: ${e.message}`);
        update({ status: 'failed', endedAt: Date.now() });
        saveRun(r);
      } finally { resolve(); }
    });
    if (stdin != null) proc.stdin.end(stdin); else proc.stdin.end();
  });
}

// Stops the run once its token ceiling is crossed. Usage is summed across attempts.
function enforceBudget(r, h, say) {
  const limit = h.budget?.maxRunTokens;
  const used = budget.runTokens(r) + (r.liveTokens || 0);
  if (limit && used > limit && r.proc && !r.stopReason) {
    r.stopReason = 'budget';
    say('system', `run token budget reached (${used.toLocaleString()} > ${limit.toLocaleString()}); stopping`);
    r.proc.kill('SIGTERM');
  }
}

function handleEvent(r, h, line, say, update) {
  let ev;
  try { ev = JSON.parse(line); } catch { return say('agent', line); }
  // Claude Code stream-json
  if (ev.type === 'system' && ev.session_id) { r.sessionId = ev.session_id; return update(); }
  if (ev.type === 'assistant') {
    // stream-json repeats a message's usage on each of its content blocks; count it once.
    const u = ev.message?.id !== r.lastMsgId ? ev.message?.usage : null;
    r.lastMsgId = ev.message?.id;
    if (u) {
      // Context size of the latest request: what a resume would re-read.
      r.contextTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      r.liveTokens = (r.liveTokens || 0) + r.contextTokens + (u.output_tokens || 0);
      enforceBudget(r, h, say);
    }
    for (const c of ev.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) say('agent', c.text);
      if (c.type === 'tool_use') { r.step += 1; say('tool', `${c.name} ${JSON.stringify(c.input).slice(0, 220)}`); }
    }
    return update();
  }
  if (ev.type === 'result') {
    r.final = ev.result || '';
    const u = ev.usage || {};
    r.liveTokens = 0;
    addUsage(r, { costUsd: ev.total_cost_usd, inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens, cacheWriteTokens: u.cache_creation_input_tokens, turns: ev.num_turns });
    return update();
  }
  // Codex exec --json
  if (ev.type === 'thread.started' && ev.thread_id) { r.sessionId = ev.thread_id; return update(); }
  const item = ev.item || ev.msg;
  if (item) {
    if (item.type === 'agent_message' && item.text) { r.final = item.text; say('agent', item.text); }
    else if (item.type === 'command_execution' || item.type === 'mcp_tool_call' || item.type === 'file_change') {
      if (ev.type === 'item.completed') { r.step += 1; say('tool', `${item.type} ${(item.command || item.tool || JSON.stringify(item.changes || '')).toString().slice(0, 200)}`); }
    }
  }
  if (ev.type === 'turn.completed' && ev.usage) {
    const cached = ev.usage.cached_input_tokens || 0;
    r.contextTokens = ev.usage.input_tokens || 0;
    addUsage(r, { inputTokens: (ev.usage.input_tokens || 0) - cached, cacheReadTokens: cached, outputTokens: ev.usage.output_tokens, turns: 1 });
    enforceBudget(r, h, say);
  }
  update();
}

// `git status --porcelain -z` entries → paths (renames report the new path).
async function changedFiles(cwd) {
  const out = await git(cwd, ['status', '--porcelain', '-z', '-uall']);
  const parts = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    files.push(parts[i].slice(3));
    if (code[0] === 'R' || code[0] === 'C') i++; // skip the rename source
  }
  return files;
}

// Loop 2: graders. Deterministic checks + the intent grader. Failures go back to the agent.
async function verifyAndMaybeRetry(r, h, hooks) {
  const { say, update, ctx } = hooks;
  update({ status: 'verifying' });
  const ignore = new Set(r.preexisting || []);
  const files = (await changedFiles(r.worktree)).filter((f) => !ignore.has(f));
  r.filesChanged = files;
  try { r.observations = JSON.parse(fs.readFileSync(path.join(dataDir, 'attempts', r.id, 'obs', 'stats.json'), 'utf8')); } catch { /* no bench tool used */ }
  const results = [];
  results.push({ grader: 'changes', pass: files.length > 0, detail: files.length ? `${files.length} file(s)` : 'agent changed nothing' });
  results.push({ grader: 'diff scope', pass: files.length <= h.graders.maxFilesChanged, detail: `${files.length}/${h.graders.maxFilesChanged} files` });
  if (h.graders.testCommand) {
    const t = await sh(h.graders.testCommand, r.worktree, h.graders.testTimeoutSec);
    // The full log stays local; graders and feedback carry a verified receipt.
    const red = h.mechanisms.evidenceReducer ? reduce(t.out, { command: h.graders.testCommand, exitCode: t.code }) : { text: t.out };
    results.push({ grader: 'tests', pass: t.code === 0, detail: red.reduced ? red.text.slice(0, 3000) : t.out.trim().split('\n').slice(-12).join('\n') });
  }
  if (h.graders.intentCheck) {
    const g = graph.loadGraph({ ...ctx.intent, dir: r.intentDir, list: ctx.intent.list, read: ctx.intent.read });
    const conflicts = graph.check(g, { text: r.task, files, attempt: r.id, acknowledge: r.final || '' });
    const open = conflicts.filter((c) => !c.acknowledged);
    r.conflicts = open;
    results.push({
      grader: 'intent.check', pass: open.length === 0, conflicts,
      detail: conflicts.map((c) => `${c.acknowledged ? 'acknowledged ' : ''}${c.kind} ${c.node} (${c.title})`).join('; ') || 'no conflicts',
    });
  }
  r.verify.push({ attempt: r.attempt, results });
  const failed = results.filter((x) => !x.pass);
  failed.forEach((f) => say('verify', `✖ ${f.grader}: ${f.detail}`));
  if (!failed.length) say('verify', '✔ all graders passed');

  const canRetry = failed.length && r.attempt < h.graders.maxAttempts && r.stopReason !== 'budget' && budget.runTokens(r) < (h.budget?.maxRunTokens || Infinity);
  if (canRetry) {
    r.attempt += 1;
    update({ status: 'running' });
    const feedback = `The Benana graders rejected your attempt:\n${failed.map((f) => `- ${f.grader}: ${f.detail}`).join('\n')}\nFix these. If an intent conflict is a false alarm, cite the node id (e.g. dead_123) and explain why it does not apply, then record that as a Decision with intent_record.`;
    // Online Context Compact: resuming re-reads the whole session; a fresh session with a
    // short handoff is cheaper once the context has grown past the gate.
    const g = compactGate({ contextTokens: r.contextTokens || 0 });
    if (h.mechanisms.compactGate && r.sessionId && g.compact) {
      const stat = (await git(r.worktree, ['diff', '--stat', 'HEAD']).catch(() => '')).trim().split('\n').slice(-20).join('\n');
      r.sessionId = null;
      r.compactions += 1;
      say('system', `compact gate: fresh session (resume ≈${g.resume.toLocaleString()} vs handoff ≈${g.fresh.toLocaleString()} token-equivalents)`);
      say('system', `feedback sent → attempt ${r.attempt}`);
      return runAgent(r, h, `${r.prompt}\n\nYou already worked on this in an earlier session. Current changes in the worktree:\n${stat || '(none)'}\nYour last summary: ${(r.final || '').slice(0, 1500)}\n\n${feedback}`, hooks);
    }
    if (r.sessionId) {
      say('system', `feedback sent → attempt ${r.attempt}`);
      return runAgent(r, h, feedback, hooks);
    }
  }
  await checkpoint(r, failed.length === 0, hooks);
}

// Merge the attempt's intent fork back, record an AgentRun node, push to Artifacts.
async function checkpoint(r, passed, { say, update, ctx, emit }) {
  const { intent } = ctx;
  try {
    await git(r.intentDir, ['add', '-A']);
    if ((await git(r.intentDir, ['status', '--porcelain'])).trim()) await git(r.intentDir, ['commit', '-q', '-m', `attempt ${r.id}: agent intent\n\nActor: agent:${r.id}`]);
    await r.artifactsForkPending;
    if (r.artifactsFork) artifacts.schedulePush({ ...intent, dir: r.intentDir, name: r.artifactsFork }, (e) => say('system', `artifacts fork push: ${e.message}`));
    await git(intent.dir, ['pull', '-q', '--no-rebase', '--no-edit', r.intentDir, 'HEAD']);
  } catch (e) { say('system', `intent merge: ${e.message}`); }
  const node = {
    id: `run_${r.id}`, type: 'AgentRun', title: `${r.kind} · ${r.task.slice(0, 80)}`, at: r.startedAt,
    body: (r.final || '').slice(0, 800), status: 'recorded', confidence: 1, outcome: passed ? 'passed' : 'failed',
    touches: r.filesChanged || [], sources: [`benana:run/${r.id}`, r.sessionId ? `${r.kind}:session/${r.sessionId}` : null].filter(Boolean),
    harnessVersion: r.harnessVersion, arm: r.arm, tokens: budget.runTokens(r),
  };
  intent.write(graph.nodePath(node), graph.serializeNode(node));
  if (r.issue) intent.write(`edges/e_${node.id}_works_on.json`, { id: `e_${node.id}_works_on`, from: node.id, to: `issue_${r.issue.number}`, type: 'works_on', status: 'recorded', confidence: 1 });
  for (const c of r.conflicts || []) intent.write(`edges/e_${node.id}_flagged_${c.node}.json`, { id: `e_${node.id}_flagged_${c.node}`, from: node.id, to: c.node, type: 'flagged_by_intent', status: 'recorded', confidence: 1 });
  graph.writeEvent(intent, { type: 'agent_run', run: r.id, outcome: node.outcome, at: Date.now() });
  await intent.commit(`checkpoint ${r.id} (${node.outcome})`, `agent:${r.id}`);
  artifacts.schedulePush(intent, (e) => say('system', `artifacts push: ${e.message}`));
  update({ status: passed ? 'passed' : 'failed', endedAt: Date.now() });
  saveRun(r);
  emit('graph-changed', {});
  ctx.onRunFinished?.(r);
}

function sh(command, cwd, timeoutSec = 600) {
  return new Promise((resolve) => {
    const p = spawn('/bin/sh', ['-c', command], { cwd, env: process.env });
    let out = '';
    const onData = (d) => { if (out.length < 8 * 1024 * 1024) out += d; };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const t = setTimeout(() => { out += `\n[benana: killed after ${timeoutSec}s]`; p.kill('SIGKILL'); }, timeoutSec * 1000);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
  });
}

function steer(id, text, emit) {
  const r = runs.get(id);
  if (!r) throw new Error('unknown run');
  r.pendingBrief = text;
  r.transcript.push({ role: 'you', text, at: Date.now() });
  emit('transcript', { id, line: r.transcript.at(-1) });
  return true;
}

function stop(id, emit) {
  const r = runs.get(id);
  if (r?.proc) {
    r.status = 'stopped';
    r.proc.kill('SIGTERM');
    emit?.('run', publicRun(r));
  }
  return true;
}

function publicRun(r) {
  const { proc, emitTimer, transcript = [], artifactsForkPending, prompt, ...rest } = r;
  return { ...rest, transcriptLength: transcript.length };
}

function get(id) {
  const r = runs.get(id) || allRuns().find((x) => x.id === id);
  return r ? { ...publicRun(r), transcript: r.transcript || [] } : null;
}
// Live runs plus recent history from disk, so a restart keeps the console populated.
function list(limit = 40) { return allRuns().slice(0, limit).map(publicRun); }

// Continue a native run (or an attached session) with a new brief, via the agent's resume.
async function continueRun(id, text, ctx, emit) {
  const r = runs.get(id);
  if (!r) throw new Error('This run is from an earlier session; start a new run instead.');
  if (r.proc) return steer(id, text, emit);
  const h = r.arm === 'candidate' ? (harnessLib.loadCandidate(ctx.harnessStore) || harnessLib.load(ctx.harnessStore)) : harnessLib.load(ctx.harnessStore);
  const hooks = wire(r, emit, ctx);
  hooks.say('you', text);
  r.attempt = 1;
  r.stopReason = null;
  hooks.update({ status: 'running', task: `${r.task}\n+ ${text}` });
  runAgent(r, h, text, hooks);
  return true;
}

// Level 3: take over a session detected on this machine by resuming it inside Benana's loops.
// It runs in the session's own directory (not a worktree); files that were already dirty
// before the takeover are excluded from grading.
async function resumeExternal({ ctx, kind, sessionId, cwd, brief }, emit) {
  const { intent, harnessStore } = ctx;
  const h = harnessLib.load(harnessStore);
  const id = `r${Date.now().toString(36).slice(-6)}`;
  const r = {
    id, kind, origin: 'resumed', task: brief, issue: null, status: 'running', step: 0, startedAt: Date.now(),
    attempt: 1, harnessVersion: h.version, arm: 'baseline', transcript: [], verify: [], usage: {}, sessionId, worktree: cwd, compactions: 0,
  };
  runs.set(id, r);
  r.preexisting = await changedFiles(cwd).catch(() => []);
  r.intentDir = path.join(dataDir, 'attempts', id, 'intent');
  fs.mkdirSync(path.dirname(r.intentDir), { recursive: true });
  await git(path.dirname(intent.dir), ['clone', '-q', intent.dir, r.intentDir]);
  r.prompt = brief;
  const hooks = wire(r, emit, ctx);
  hooks.say('system', `resumed ${kind} session ${sessionId} in ${cwd}`);
  hooks.update();
  runAgent(r, h, brief, hooks);
  return publicRun(r);
}

const live = () => [...runs.values()].filter((r) => LIVE.has(r.status));

module.exports = { start, stop, steer, get, list, allRuns, continueRun, resumeExternal, live, changedFiles, saveRun };

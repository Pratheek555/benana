// Loop 1 (agent) + Loop 2 (verify). Each attempt gets:
//   - its own git worktree of the user's local checkout
//   - its own fork of the intent repo (local clone + Artifacts fork when configured)
//   - the benana-intent MCP server, the harness system prompt and pre-loaded intent context
const fs = require('node:fs');
const path = require('node:path');
const AGENT_CONFIG = ['.entire', '.claude', '.codex'];
const { spawn } = require('node:child_process');
const { git } = require('./git.cjs');
const { dataDir, appRoot } = require('./env.cjs');
const graph = require('./graph.cjs');
const harnessLib = require('./harness.cjs');
const artifacts = require('./artifacts.cjs');
const tracing = require('./tracing.cjs');

const MCP = path.join(appRoot, 'electron', 'mcp-server.cjs');
const runs = new Map();

function runsDir() { const d = path.join(dataDir, 'runs'); fs.mkdirSync(d, { recursive: true }); return d; }
function saveRun(r) {
  const { proc, openTools, ...rest } = r;
  fs.writeFileSync(path.join(runsDir(), `${r.id}.json`), JSON.stringify(rest, null, 2));
}
function allRuns() {
  return fs.readdirSync(runsDir()).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir(), f), 'utf8')); } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.startedAt - a.startedAt);
}

// Entry point: one Neatlogs WORKFLOW trace per agent run (attempts, tools and graders nest under it).
function start(args, emit) {
  const { task, issue, agent } = args;
  return tracing.workflow('agent-run', {
    input: { task, issue: issue ? `#${issue.number} ${issue.title}` : null, agent, label: args.label },
    entryPoint: issue ? 'inbox-issue' : 'brief',
  }, async () => {
    const run = await startRun({ ...args, trace: tracing.capture() }, emit);
    tracing.setOutput({ id: run.id, status: run.status, files: run.filesChanged, conflicts: (run.conflicts || []).map((c) => c.node) });
    return run;
  });
}

async function startRun({ ctx, task, issue, agent, trace, harness, label }, emit) {
  const { intent, harnessStore, repoPath } = ctx;
  if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) throw new Error('Set a local checkout path for this repo first.');
  const h = harness || harnessLib.load(harnessStore); // evals pin a specific version
  const id = `a${Date.now().toString(36).slice(-5)}`;
  const kind = agent || h.agent;
  const r = {
    id, kind, origin: 'native', task, issue: issue || null, status: 'preparing', step: 0,
    startedAt: Date.now(), attempt: 1, harnessVersion: h.version, transcript: [], verify: [], usage: {},
    trace, traceIds: trace?.traceId ? [trace.traceId] : [], label: label || null,
  };
  runs.set(id, r);
  const update = (patch = {}) => { Object.assign(r, patch); emit('run', publicRun(r)); };
  const say = (role, text) => { r.transcript.push({ role, text: String(text).slice(0, 4000), at: Date.now() }); emit('transcript', { id, line: r.transcript.at(-1) }); };
  update();

  // Workspace: a dedicated worktree so the user's own checkout is never touched.
  r.worktree = path.join(dataDir, 'worktrees', id);
  fs.mkdirSync(path.dirname(r.worktree), { recursive: true });
  await git(repoPath, ['worktree', 'add', '-q', '-b', `benana/${id}`, r.worktree, 'HEAD']);
  r.baseSha = (await git(r.worktree, ['rev-parse', 'HEAD'])).trim();
  // Untracked agent hook config (Entire, Claude Code, Codex) lives only in the user's checkout;
  // copy it so session capture also works inside the worktree.
  for (const d of AGENT_CONFIG) {
    const src = path.join(repoPath, d);
    if (fs.existsSync(src) && !fs.existsSync(path.join(r.worktree, d))) fs.cpSync(src, path.join(r.worktree, d), { recursive: true });
  }

  // Intent fork: local clone the agent writes to; mirrored as an Artifacts fork when configured.
  r.intentDir = path.join(dataDir, 'attempts', id, 'intent');
  fs.mkdirSync(path.dirname(r.intentDir), { recursive: true });
  await git(path.dirname(intent.dir), ['clone', '-q', intent.dir, r.intentDir]);
  await git(r.intentDir, ['config', 'user.name', `agent-${id}`]);
  await git(r.intentDir, ['config', 'user.email', `${id}@benana.local`]);
  if (artifacts.configured()) {
    artifacts.fork(intent.name, `${intent.name}-${id}`).then((f) => { r.artifactsFork = f.name || `${intent.name}-${id}`; update(); })
      .catch((e) => say('system', `artifacts fork skipped: ${e.message}`));
  }

  const g = graph.loadGraph(intent);
  r.context = graph.context(g, { text: task });
  say('system', `intent.context → ${r.context.map((c) => c.id).join(', ') || 'nothing relevant yet'}`);
  update({ status: 'running' });
  await runAgent(r, h, buildPrompt(task, issue, r.context), { say, update, emit, ctx });
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

function agentCommand(r, h, prompt, resumeId) {
  const env = { BENANA_INTENT_DIR: r.intentDir, BENANA_ATTEMPT: r.id };
  if (r.kind === 'codex') {
    const args = ['exec', '--json', '--full-auto', '--skip-git-repo-check', '-C', r.worktree,
      '-c', 'mcp_servers.benana-intent.command="node"',
      '-c', `mcp_servers.benana-intent.args=[${JSON.stringify(MCP)}]`,
      '-c', `mcp_servers.benana-intent.env={BENANA_INTENT_DIR=${JSON.stringify(r.intentDir)},BENANA_ATTEMPT=${JSON.stringify(r.id)}}`];
    if (resumeId) args.splice(1, 0, 'resume', resumeId);
    args.push(`${harnessLib.systemPrompt(h)}\n\n${prompt}`);
    return { cmd: 'codex', args };
  }
  const mcpFile = path.join(dataDir, 'attempts', r.id, 'mcp.json');
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { 'benana-intent': { command: 'node', args: [MCP], env } } }));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', mcpFile,
    '--append-system-prompt', harnessLib.systemPrompt(h), '--permission-mode', 'acceptEdits',
    '--allowedTools', 'mcp__benana-intent__intent_context,mcp__benana-intent__intent_check,mcp__benana-intent__intent_record,Read,Edit,Write,Glob,Grep'];
  if (resumeId) args.push('--resume', resumeId);
  return { cmd: 'claude', args, stdin: prompt };
}

// Runs the agent, then the graders, until the run passes, fails or is stopped.
// Attempts and graders are siblings under the run's WORKFLOW span (r.trace).
async function runAgent(r, h, prompt, hooks) {
  let next = prompt;
  while (next != null) {
    await runAttempt(r, h, next, hooks);
    if (r.status === 'stopped' || r.spawnFailed) { saveRun(r); return; }
    if (r.pendingBrief && r.sessionId) {
      next = r.pendingBrief;
      r.pendingBrief = null;
      hooks.say('system', 'sending your brief');
      continue;
    }
    next = await tracing.under(r.trace, () => verify(r, h, hooks));
  }
}

// One agent process = one AGENT span, closed when the process exits.
function runAttempt(r, h, prompt, hooks) {
  const { say, update } = hooks;
  const cmd = r.kind === 'codex' ? 'codex' : 'claude';
  return tracing.under(r.trace, () => tracing.agent(`${cmd} attempt ${r.attempt}`, prompt, (span) => new Promise((resolve) => {
    r.agentSpan = tracing.capture();
    r.openTools = new Map();
    const { args, stdin } = agentCommand(r, h, prompt, r.sessionId);
    const proc = spawn(cmd, args, { cwd: r.worktree, env: process.env });
    r.proc = proc;
    let buf = '';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      r.proc = null;
      for (const end of r.openTools.values()) end();
      r.openTools.clear();
      tracing.setUsage(span, { model: r.model, provider: cmd === 'codex' ? 'openai' : 'anthropic', usage: r.usage });
      resolve();
    };
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleEvent(r, line, say, update);
      }
    });
    proc.stderr.on('data', (d) => { const t = String(d).trim(); if (t && !/^Reading prompt/.test(t)) say('stderr', t); });
    proc.on('error', (e) => { say('system', `failed to start ${cmd}: ${e.message}`); r.spawnFailed = true; update({ status: 'failed' }); finish(); });
    proc.on('close', (code) => { if (r.status !== 'stopped') say('system', `${cmd} exited (${code})`); finish(); });
    if (stdin != null) proc.stdin.end(stdin); else proc.stdin.end();
  })));
}

const resultText = (c) => (typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join('\n')).slice(0, 2000);

function handleEvent(r, line, say, update) {
  let ev;
  try { ev = JSON.parse(line); } catch { return say('agent', line); }
  // Claude Code stream-json
  if (ev.type === 'system' && ev.session_id) { r.sessionId = ev.session_id; r.model = ev.model || r.model; return update(); }
  if (ev.type === 'assistant') {
    for (const c of ev.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) say('agent', c.text);
      if (c.type === 'tool_use') {
        r.step += 1;
        r.openTools?.set(c.id, tracing.openTool(r.agentSpan, c.name, c.input));
        say('tool', `${c.name} ${JSON.stringify(c.input).slice(0, 220)}`);
      }
    }
    return update();
  }
  if (ev.type === 'user') {
    for (const c of ev.message?.content || []) {
      if (c.type !== 'tool_result') continue;
      r.openTools?.get(c.tool_use_id)?.(resultText(c.content));
      r.openTools?.delete(c.tool_use_id);
    }
    return;
  }
  if (ev.type === 'result') {
    r.final = ev.result || '';
    r.usage = {
      costUsd: ev.total_cost_usd, inputTokens: ev.usage?.input_tokens, outputTokens: ev.usage?.output_tokens,
      cacheRead: ev.usage?.cache_read_input_tokens, turns: ev.num_turns,
    };
    return update();
  }
  // Codex exec --json
  if (ev.type === 'thread.started' && ev.thread_id) { r.sessionId = ev.thread_id; return update(); }
  const item = ev.item || ev.msg;
  if (item) {
    if (item.type === 'agent_message' && item.text) { r.final = item.text; say('agent', item.text); }
    else if (item.type === 'command_execution' || item.type === 'mcp_tool_call' || item.type === 'file_change') {
      const input = item.command || item.tool || item.changes;
      if (ev.type === 'item.started' && item.id) r.openTools?.set(item.id, tracing.openTool(r.agentSpan, item.type, input));
      if (ev.type === 'item.completed') {
        const end = r.openTools?.get(item.id) || tracing.openTool(r.agentSpan, item.type, input);
        end(item.aggregated_output);
        r.openTools?.delete(item.id);
        r.step += 1;
        say('tool', `${item.type} ${(item.command || item.tool || JSON.stringify(item.changes || '')).toString().slice(0, 200)}`);
      }
    }
  }
  if (ev.type === 'turn.completed' && ev.usage) r.usage = { inputTokens: ev.usage.input_tokens, outputTokens: ev.usage.output_tokens };
  update();
}

// Loop 2: graders. Deterministic checks + the intent grader. Returns feedback for another
// attempt, or null once the run is checkpointed.
async function verify(r, h, hooks) {
  const { say, update, ctx } = hooks;
  update({ status: 'verifying' });
  const files = (await git(r.worktree, ['status', '--porcelain'])).split('\n').filter(Boolean).map((l) => l.slice(3).trim()).filter((f) => !AGENT_CONFIG.some((d) => f === `${d}/` || f.startsWith(`${d}/`)));
  r.filesChanged = files;
  const results = [];
  results.push({ grader: 'changes', pass: files.length > 0, detail: files.length ? `${files.length} file(s)` : 'agent changed nothing' });
  results.push({ grader: 'diff scope', pass: files.length <= h.graders.maxFilesChanged, detail: `${files.length}/${h.graders.maxFilesChanged} files` });
  if (h.graders.testCommand) {
    const t = await sh(h.graders.testCommand, r.worktree);
    results.push({ grader: 'tests', pass: t.code === 0, detail: t.tail });
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
  for (const x of results) await tracing.guardrail(x.grader, { files, attempt: r.attempt }, x);
  r.verify.push({ attempt: r.attempt, results });
  const failed = results.filter((x) => !x.pass);
  failed.forEach((f) => say('verify', `✖ ${f.grader}: ${f.detail}`));
  if (!failed.length) say('verify', '✔ all graders passed');

  if (failed.length && r.attempt < h.graders.maxAttempts && r.sessionId) {
    r.attempt += 1;
    update({ status: 'running' });
    const feedback = `The Benana graders rejected your attempt:\n${failed.map((f) => `- ${f.grader}: ${f.detail}`).join('\n')}\nFix these. If an intent conflict is a false alarm, cite the node id (e.g. dead_123) and explain why it does not apply, then record that as a Decision with intent_record.`;
    say('system', `feedback sent → attempt ${r.attempt}`);
    return feedback;
  }
  await checkpoint(r, failed.length === 0, hooks);
  return null;
}

// A passing native run is committed on its benana/<id> branch. Entire's git hooks attach the
// agent session to that commit as an Entire-Checkpoint trailer, which we read back.
async function commitWorktree(r, say) {
  if (r.origin !== 'native') return;
  try {
    await git(r.worktree, ['add', '-A', '--', '.', ...AGENT_CONFIG.map((d) => `:!${d}`)]);
    if (!(await git(r.worktree, ['diff', '--cached', '--name-only'])).trim()) return;
    const trailers = [`Benana-Run: ${r.id}`, ...r.traceIds.map((t) => `Neatlogs-Trace: ${t}`)];
    await git(r.worktree, ['commit', '-q', '-m', `benana: ${r.task.split('\n')[0].slice(0, 72)}\n\n${trailers.join('\n')}`]);
    r.commit = (await git(r.worktree, ['rev-parse', 'HEAD'])).trim();
    r.entireCheckpoint = (await git(r.worktree, ['log', '-1', '--format=%(trailers:key=Entire-Checkpoint,valueonly)'])).trim() || null;
    say('system', `committed ${r.commit.slice(0, 7)} on benana/${r.id}${r.entireCheckpoint ? ` · Entire checkpoint ${r.entireCheckpoint}` : ' · no Entire checkpoint'}`);
  } catch (e) { say('system', `commit: ${e.message}`); }
}

// Merge the attempt's intent fork back, record an AgentRun node, push to Artifacts.
async function checkpoint(r, passed, { say, update, ctx, emit }) {
  const { intent } = ctx;
  if (passed) await commitWorktree(r, say);
  try {
    await git(r.intentDir, ['add', '-A']);
    if ((await git(r.intentDir, ['status', '--porcelain'])).trim()) await git(r.intentDir, ['commit', '-q', '-m', `attempt ${r.id}: agent intent\n\nActor: agent:${r.id}`]);
    if (r.artifactsFork) await artifacts.push({ ...intent, dir: r.intentDir, name: r.artifactsFork }).catch(() => {});
    await git(intent.dir, ['pull', '-q', '--no-rebase', '--no-edit', r.intentDir, 'HEAD']);
  } catch (e) { say('system', `intent merge: ${e.message}`); }
  const node = {
    id: `run_${r.id}`, type: 'AgentRun', title: `${r.kind} · ${r.task.slice(0, 80)}`, at: r.startedAt,
    body: (r.final || '').slice(0, 800), status: 'recorded', confidence: 1, outcome: passed ? 'passed' : 'failed',
    touches: r.filesChanged || [],
    sources: [
      `benana:run/${r.id}`,
      r.sessionId ? `${r.kind}:session/${r.sessionId}` : null,
      ...r.traceIds.map((t) => `neatlogs:trace/${t}`),
      r.entireCheckpoint ? `entire:checkpoint/${r.entireCheckpoint}` : null,
      r.commit ? `git:benana/${r.id}@${r.commit}` : null,
      r.artifactsFork ? `artifacts:${artifacts.namespace()}/${r.artifactsFork}` : null,
    ].filter(Boolean),
    harnessVersion: r.harnessVersion,
    provenance: { traceIds: r.traceIds, entireCheckpoint: r.entireCheckpoint || null, commit: r.commit || null, artifactsFork: r.artifactsFork || null },
  };
  intent.write(graph.nodePath(node), graph.serializeNode(node));
  if (r.issue) intent.write(`edges/e_${node.id}_works_on.json`, { id: `e_${node.id}_works_on`, from: node.id, to: `issue_${r.issue.number}`, type: 'works_on', status: 'recorded', confidence: 1 });
  for (const c of r.conflicts || []) intent.write(`edges/e_${node.id}_flagged_${c.node}.json`, { id: `e_${node.id}_flagged_${c.node}`, from: node.id, to: c.node, type: 'flagged_by_intent', status: 'recorded', confidence: 1 });
  graph.writeEvent(intent, { type: 'agent_run', run: r.id, outcome: node.outcome, at: Date.now() });
  await intent.commit(`checkpoint ${r.id} (${node.outcome})`, `agent:${r.id}`);
  if (artifacts.configured()) artifacts.push(intent).catch((e) => say('system', `artifacts push: ${e.message}`));
  update({ status: passed ? 'passed' : 'failed', endedAt: Date.now() });
  saveRun(r);
  emit('graph-changed', {});
}

function sh(command, cwd) {
  return new Promise((resolve) => {
    const p = spawn('/bin/sh', ['-c', command], { cwd, env: process.env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, tail: out.trim().split('\n').slice(-6).join('\n') }));
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

function stop(id) {
  const r = runs.get(id);
  if (r?.proc) { r.status = 'stopped'; r.proc.kill('SIGTERM'); }
  return true;
}

function publicRun(r) {
  const { proc, openTools, transcript, ...rest } = r;
  return { ...rest, transcriptLength: transcript.length };
}

function get(id) { const r = runs.get(id); return r ? { ...publicRun(r), transcript: r.transcript } : null; }
function list() { return [...runs.values()].map(publicRun); }

// Continue a native run (or an attached session) with a new brief, via the agent's resume.
async function continueRun(id, text, ctx, emit) {
  const r = runs.get(id);
  if (!r) throw new Error('unknown run');
  if (r.proc) return steer(id, text, emit);
  const h = harnessLib.load(ctx.harnessStore);
  const say = (role, t) => { r.transcript.push({ role, text: String(t).slice(0, 4000), at: Date.now() }); emit('transcript', { id, line: r.transcript.at(-1) }); };
  const update = (patch = {}) => { Object.assign(r, patch); emit('run', publicRun(r)); };
  say('you', text);
  r.attempt = 1;
  update({ status: 'running', task: `${r.task}\n+ ${text}` });
  tracing.workflow('agent-brief', { input: { run: id, brief: text }, sessionId: r.sessionId, entryPoint: 'brief' }, () => {
    r.trace = tracing.capture();
    if (r.trace.traceId) r.traceIds = [...(r.traceIds || []), r.trace.traceId];
    return runAgent(r, h, text, { say, update, emit, ctx });
  });
  return true;
}

// Level 3: take over a session detected on this machine by resuming it inside Benana's loops.
// It runs in the session's own directory (not a worktree), so graders see that checkout.
async function resumeExternal({ ctx, kind, sessionId, cwd, brief }, emit) {
  const { intent, harnessStore } = ctx;
  const h = harnessLib.load(harnessStore);
  const id = `r${Date.now().toString(36).slice(-5)}`;
  const r = {
    id, kind, origin: 'resumed', task: brief, issue: null, status: 'running', step: 0, startedAt: Date.now(),
    attempt: 1, harnessVersion: h.version, transcript: [], verify: [], usage: {}, sessionId, worktree: cwd, traceIds: [],
  };
  runs.set(id, r);
  r.intentDir = path.join(dataDir, 'attempts', id, 'intent');
  fs.mkdirSync(path.dirname(r.intentDir), { recursive: true });
  await git(path.dirname(intent.dir), ['clone', '-q', intent.dir, r.intentDir]);
  const say = (role, t) => { r.transcript.push({ role, text: String(t).slice(0, 4000), at: Date.now() }); emit('transcript', { id, line: r.transcript.at(-1) }); };
  const update = (patch = {}) => { Object.assign(r, patch); emit('run', publicRun(r)); };
  say('system', `resumed ${kind} session ${sessionId} in ${cwd}`);
  update();
  tracing.workflow('session-resume', { input: { brief, kind, sessionId }, sessionId, entryPoint: 'attached-session' }, () => {
    r.trace = tracing.capture();
    if (r.trace.traceId) r.traceIds.push(r.trace.traceId);
    return runAgent(r, h, brief, { say, update, emit, ctx });
  });
  return publicRun(r);
}

module.exports = { start, stop, steer, get, list, allRuns, continueRun, resumeExternal };

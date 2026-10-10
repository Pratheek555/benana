const fs = require("node:fs");
const path = require("node:path");
const { git } = require("./git.cjs");
const { dataDir } = require("./env.cjs");
const graph = require("./graph.cjs");
const harnessLib = require("./harness.cjs");
const artifacts = require("./artifacts.cjs");
const entire = require("./entire.cjs");
const { runCommand, spawnExecutable, terminateProcessTree } = require("./processes.cjs");
const attemptWorkspace = require("./attempt-workspace.cjs");
const { agentCommand, handleEvent } = require("./providers.cjs");
const runs = new Map();
const retrying = new Map();
let sequence = 0;
const terminal = new Set(["passed", "failed", "stopped"]);

function newId(prefix = "a") {
  sequence = (sequence + 1) % 1296;
  return `${prefix}${Date.now().toString(36)}${sequence.toString(36).padStart(2, "0")}`;
}
function runsDir() {
  const dir = path.join(dataDir, "runs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function saveRun(run) {
  const { proc, verifyProc, ...saved } = run;
  fs.writeFileSync(
    path.join(runsDir(), `${run.id}.json`),
    JSON.stringify(saved, null, 2),
  );
}
function savedRuns(repo) {
  return fs
    .readdirSync(runsDir())
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(runsDir(), name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((run) => run && (!repo || run.repo === repo))
    .sort((a, b) => b.startedAt - a.startedAt);
}
function hydrate(repo) {
  for (const run of savedRuns(repo))
    if (!runs.has(run.id)) runs.set(run.id, run);
  return list(repo);
}
function allRuns(repo) {
  return savedRuns(repo);
}
function publicRun(run) {
  const { proc, verifyProc, transcript = [], ...rest } = run;
  return { ...rest, transcriptLength: transcript.length };
}
function get(id, repo) {
  const run = runs.get(id);
  return run && (!repo || run.repo === repo)
    ? { ...publicRun(run), transcript: run.transcript || [] }
    : null;
}
function list(repo) {
  return [...runs.values()]
    .filter((run) => !repo || run.repo === repo)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(publicRun);
}

function hooksFor(run, emit, ctx) {
  return {
    ctx,
    emit,
    update(patch = {}) {
      if (terminal.has(run.status)) return false;
      Object.assign(run, patch);
      saveRun(run);
      emit("run", publicRun(run));
      return true;
    },
    say(role, text) {
      if (terminal.has(run.status)) return false;
      run.transcript.push({
        role,
        text: String(text).slice(0, 8000),
        at: Date.now(),
      });
      saveRun(run);
      emit("transcript", { id: run.id, line: run.transcript.at(-1) });
      return true;
    },
  };
}

function failure(kind, title, detail, evidence = []) {
  return { kind, title, detail: String(detail || ""), evidence };
}
function proposeRecovery(run, failed) {
  const details = failed
    .map((item) => `${item.grader}: ${item.detail}`)
    .join("\n");
  const prompt = `Benana verification failed. Apply these corrections and retry:\n${failed.map((item) => `- ${item.grader}: ${item.detail}`).join("\n")}`;
  return {
    id: `recovery_${run.id}_${Date.now().toString(36)}`,
    title: "Apply verification feedback and retry",
    diagnosis: details,
    changes: [{ label: "Extra agent instruction", before: "", after: prompt }],
    prompt,
    canRetry: Boolean(run.worktree && fs.existsSync(run.worktree)),
  };
}

async function prepareRun({ ctx, task, issue, agent, parent, recovery }, emit) {
  const { intent, harnessStore, repoPath } = ctx;
  if (!repoPath || !fs.existsSync(path.join(repoPath, ".git")))
    throw new Error("Set a local checkout path for this repo first.");
  const h = harnessLib.load(harnessStore);
  const id = newId(parent ? "r" : "a");
  const run = {
    id,
    rootId: parent?.rootId || parent?.id || id,
    retryOf: parent?.id,
    recoveryId: recovery?.id,
    kind: agent || parent?.kind || h.agent,
    origin: "native",
    repo: ctx.repo,
    task,
    issue: issue || parent?.issue || null,
    status: "preparing",
    step: 0,
    startedAt: Date.now(),
    attempt: parent ? parent.attempt + 1 : 1,
    harnessVersion: h.version,
    transcript: [],
    verify: [],
    usage: {},
  };
  runs.set(id, run);
  const hooks = hooksFor(run, emit, ctx);
  hooks.update();
  try {
    run.worktree = path.join(dataDir, "worktrees", id);
    const base = parent?.baseSha || "HEAD";
    run.baseSha = await attemptWorkspace.create({
      repoPath,
      worktree: run.worktree,
      branch: `benana/${id}`,
      base,
      snapshotFrom: parent?.worktree,
    });
    if (run.status === "stopped") return { run, failed: true };
    run.intentDir = path.join(dataDir, "attempts", id, "intent");
    fs.mkdirSync(path.dirname(run.intentDir), { recursive: true });
    await git(path.dirname(intent.dir), [
      "clone",
      "-q",
      intent.dir,
      run.intentDir,
    ]);
    await git(run.intentDir, ["config", "user.name", `agent-${id}`]);
    await git(run.intentDir, ["config", "user.email", `${id}@benana.local`]);
    if (run.status === "stopped") return { run, failed: true };
    const intentEntries = graph
      .context(graph.loadGraph(intent), { text: task })
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        summary: `${entry.type}: ${entry.title}`,
        reason: entry.reason || "",
        source: "benana-intent",
        raw: entry,
      }));
    const entireContext = await entire.context(repoPath, task);
    if (run.status === "stopped") return { run, failed: true };
    run.contextBundle = {
      entries: [...intentEntries, ...entireContext.entries],
      ...(entireContext.errors?.length ? { errors: entireContext.errors } : {}),
    };
    hooks.say(
      "system",
      `context loaded: ${run.contextBundle.entries.length} record(s)`,
    );
    if (!hooks.update({ status: "running" })) return { run, failed: true };
    if (artifacts.configured())
      try {
        const fork = await artifacts.fork(intent.name, `${intent.name}-${id}`);
        if (!terminal.has(run.status)) {
          run.artifactsFork = fork.name || `${intent.name}-${id}`;
          hooks.update();
        }
      } catch (error) {
        hooks.say("system", `artifacts fork skipped: ${error.message}`);
      }
    if (run.status === "stopped") return { run, failed: true };
    return { run, h, hooks };
  } catch (error) {
    hooks.say("system", `setup failed: ${error.message}`);
    hooks.update({
      status: "failed",
      endedAt: Date.now(),
      failure: failure("setup", "Run setup failed", error.message, [
        { label: "Local setup error", text: error.message, source: "local" },
      ]),
      recovery: {
        id: `recovery_${id}_setup`,
        title: "Fix setup and start again",
        diagnosis: error.message,
        changes: [],
        prompt: "",
        canRetry: false,
        blockReason: "The workspace was not prepared safely.",
      },
    });
    return { run, failed: true };
  }
}

async function start(input, emit) {
  const prepared = await prepareRun(input, emit);
  if (!prepared.failed)
    executeAttempt(
      prepared.run,
      prepared.h,
      buildPrompt(prepared.run, input.issue, input.recovery),
      prepared.hooks,
    ).catch((error) =>
      failExecution(prepared.run, prepared.hooks, error.message),
    );
  return publicRun(prepared.run);
}

function buildPrompt(run, issue, recovery) {
  const lines = [];
  if (issue)
    lines.push(
      `GitHub issue #${issue.number}: ${issue.title}\n${(issue.body || "").slice(0, 2000)}`,
    );
  lines.push(`Task: ${run.task}`);
  if (run.contextBundle.entries.length) {
    lines.push("\nContext records sent by Benana:");
    for (const entry of run.contextBundle.entries)
      lines.push(
        `- [${entry.source} ${entry.id}] ${entry.title}${entry.reason ? `; reason: ${entry.reason}` : ""}\n  ${entry.summary}`,
      );
  }
  if (run.contextBundle.errors?.length)
    lines.push(
      `\nContext provider errors:\n${run.contextBundle.errors.map((x) => `- ${x}`).join("\n")}`,
    );
  if (recovery?.prompt)
    lines.push(`\nApproved recovery instruction:\n${recovery.prompt}`);
  return lines.join("\n");
}

function executeAttempt(run, h, prompt, hooks, deps = {}) {
  return new Promise((resolve) => {
    const command = agentCommand(run, h, prompt);
    let proc;
    try {
      proc = (deps.spawnExecutable || spawnExecutable)(
        command.cmd,
        command.args,
        {
          cwd: run.worktree,
          env: {
            ...process.env,
            BENANA_RUN_ID: run.id,
            BENANA_ATTEMPT: String(run.attempt),
          },
        },
      );
    } catch (error) {
      failExecution(run, hooks, error.message);
      return resolve();
    }
    run.proc = proc;
    hooks.update();
    let buffer = "";
    let spawnError = null;
    proc.stdout?.on("data", (data) => {
      if (terminal.has(run.status)) return;
      buffer += data;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) handleEvent(run, line, hooks);
      }
    });
    proc.stderr?.on("data", (data) => {
      const text = String(data).trim();
      if (text && !/^Reading prompt/.test(text)) hooks.say("stderr", text);
    });
    proc.once("error", (error) => {
      spawnError = error;
    });
    let settled = false;
    const finish = () => { if (settled) return false; settled = true; resolve(); return true; };
    proc.once("close", async (code) => {
      run.proc = null;
      if (terminal.has(run.status)) return finish();
      if (spawnError || code !== 0 || run.terminalFailure) {
        failExecution(
          run,
          hooks,
          spawnError?.message ||
            run.terminalFailure ||
            `${command.cmd} exited with code ${code}`,
        );
        return finish();
      }
      hooks.say("system", `${command.cmd} exited successfully`);
      try {
        await verify(run, h, hooks, deps);
      } catch (error) {
        if (!terminal.has(run.status)) failVerificationTool(run, hooks, error);
      }
      finish();
    });
    command.stdin != null ? proc.stdin.end(command.stdin) : proc.stdin.end();
  });
}

function failVerificationTool(run, hooks, error) {
  const detail = error?.message || String(error);
  hooks.say("system", `verification could not complete: ${detail}`);
  hooks.update({
    status: "failed",
    endedAt: Date.now(),
    failure: failure("execution", "Verification could not complete", detail, [
      { label: "Verifier error", text: detail, source: "local" },
    ]),
    recovery: { id: `recovery_${run.id}_verifier`, title: "Fix verification setup", diagnosis: detail, changes: [], prompt: "", canRetry: false, blockReason: "The verifier itself failed." },
  });
}

function failExecution(run, hooks, detail) {
  hooks.say("system", detail);
  if (/ENOENT|not found|not recognized|cannot find.*file/i.test(detail)) {
    const provider = run.kind === "codex" ? "Codex" : "Claude Code";
    hooks.update({
      status: "failed", endedAt: Date.now(),
      failure: failure("setup", `${provider} could not start`, detail, [{ label: "Launch error", text: detail, source: "local" }]),
      recovery: {
        id: `recovery_${run.id}_setup`, title: `Set up ${provider}`,
        diagnosis: "The coding-agent executable is unavailable. An agent instruction cannot repair this launch prerequisite.",
        changes: [], prompt: "", canRetry: false,
        blockReason: `Install ${provider}, make its command available on PATH, and restart Benana. Then start a new task. This failed attempt remains in history.`,
      },
    });
    return;
  }
  const recovery = {
    id: `recovery_${run.id}_execution`,
    title: "Apply execution feedback and retry",
    diagnosis: detail,
    changes: [
      {
        label: "Extra agent instruction",
        before: "",
        after: `The previous agent process failed before verification: ${detail}\nComplete the task and report any blocking error.`,
      },
    ],
    prompt: `The previous agent process failed before verification: ${detail}\nComplete the task and report any blocking error.`,
    canRetry: Boolean(run.worktree && fs.existsSync(run.worktree)),
  };
  hooks.update({
    status: "failed",
    endedAt: Date.now(),
    failure: failure("execution", "Agent process failed", detail, [
      { label: "Local process error", text: detail, source: "local" },
    ]),
    recovery,
  });
}
async function verify(run, h, hooks, deps = {}) {
  if (run.status === "stopped") return;
  hooks.update({ status: "verifying" });
  const files = await attemptWorkspace.changedFiles(run.worktree);
  run.filesChanged = files;
  let testResult = null;
  if (h.graders.testCommand?.trim())
    testResult = await (deps.runCommand || runCommand)(
      h.graders.testCommand,
      run.worktree,
      {
        onSpawn: (proc) => {
          run.verifyProc = proc;
          if (run.status === "stopped") terminateProcessTree(proc);
        },
      },
    );
  run.verifyProc = null;
  if (run.status === "stopped") return;
  const results = gradeBasics(files, h.graders, testResult);
  if (h.graders.intentCheck) {
    const intentGraph = graph.loadGraph({
      ...hooks.ctx.intent,
      dir: run.intentDir,
      list: hooks.ctx.intent.list,
      read: hooks.ctx.intent.read,
    });
    const conflicts = graph.check(intentGraph, {
      text: run.task,
      files,
      attempt: run.id,
      acknowledge: run.final || "",
    });
    run.conflicts = conflicts.filter((item) => !item.acknowledged);
    results.push({
      grader: "intent.check",
      pass: run.conflicts.length === 0,
      conflicts,
      detail:
        conflicts
          .map((item) => `${item.kind} ${item.node} (${item.title})`)
          .join("; ") || "no conflicts",
    });
  }
  run.verify.push({ attempt: run.attempt, results });
  const failed = results.filter((item) => !item.pass);
  failed.forEach((item) =>
    hooks.say("verify", `FAIL ${item.grader}: ${item.detail}`),
  );
  if (failed.length) {
    const recovery = proposeRecovery(run, failed);
    hooks.update({
      status: "recording",
      failure: failure(
        "verification",
        "Verification failed",
        failed.map((item) => `${item.grader}: ${item.detail}`).join("\n"),
        failed.map((item) => ({
          label: item.grader,
          text: item.detail,
          source: "local",
        })),
      ),
      recovery,
    });
    await checkpoint(run, false, hooks);
  } else {
    hooks.say("verify", "All graders passed.");
    await checkpoint(run, true, hooks);
  }
}

function gradeBasics(files, graders, testResult) {
  const results = [
    {
      grader: "changes",
      pass: files.length > 0,
      detail: files.length
        ? `${files.length} file(s)`
        : "agent changed nothing",
    },
    {
      grader: "diff scope",
      pass: files.length <= graders.maxFilesChanged,
      detail: `${files.length}/${graders.maxFilesChanged} files`,
    },
  ];
  if (!graders.testCommand?.trim())
    results.push({
      grader: "tests",
      pass: false,
      detail: "Configure a test command before a run can pass.",
    });
  else
    results.push({
      grader: "tests",
      pass: testResult?.code === 0 && !testResult?.error,
      detail:
        testResult?.tail || testResult?.error || `exit ${testResult?.code}`,
    });
  return results;
}

async function checkpoint(run, passed, hooks) {
  if (terminal.has(run.status)) return;
  const { intent } = hooks.ctx;
  try {
    await git(run.intentDir, ["add", "-A"]);
    if ((await git(run.intentDir, ["status", "--porcelain"])).trim())
      await git(run.intentDir, [
        "commit",
        "-q",
        "-m",
        `attempt ${run.id}: agent intent\n\nActor: agent:${run.id}`,
      ]);
    await git(intent.dir, [
      "pull",
      "-q",
      "--no-rebase",
      "--no-edit",
      run.intentDir,
      "HEAD",
    ]);
  } catch (error) {
    hooks.say("system", `intent merge: ${error.message}`);
  }
  if (terminal.has(run.status)) return;
  const node = {
    id: `run_${run.id}`,
    type: "AgentRun",
    title: `${run.kind} · ${run.task.slice(0, 80)}`,
    at: run.startedAt,
    body: (run.final || "").slice(0, 800),
    status: "recorded",
    confidence: 1,
    outcome: passed ? "passed" : "failed",
    touches: run.filesChanged || [],
    sources: [
      `benana:run/${run.id}`,
      run.sessionId ? `${run.kind}:session/${run.sessionId}` : null,
    ].filter(Boolean),
    harnessVersion: run.harnessVersion,
  };
  intent.write(graph.nodePath(node), graph.serializeNode(node));
  if (run.issue) intent.write(`edges/e_${node.id}_works_on.json`, { id: `e_${node.id}_works_on`, from: node.id, to: `issue_${run.issue.number}`, type: "works_on", status: "recorded", confidence: 1 });
  for (const conflict of run.conflicts || []) intent.write(`edges/e_${node.id}_flagged_${conflict.node}.json`, { id: `e_${node.id}_flagged_${conflict.node}`, from: node.id, to: conflict.node, type: "flagged_by_intent", status: "recorded", confidence: 1 });
  graph.writeEvent(intent, {
    type: "agent_run",
    run: run.id,
    outcome: node.outcome,
    at: Date.now(),
  });
  await intent.commit(
    `checkpoint ${run.id} (${node.outcome})`,
    `agent:${run.id}`,
  );
  if (terminal.has(run.status)) return;
  if (artifacts.configured()) {
    if (run.artifactsFork) await artifacts.push({ ...intent, dir: run.intentDir, name: run.artifactsFork });
    if (terminal.has(run.status)) return;
    await artifacts.push(intent);
  }
  if (terminal.has(run.status)) return;
  hooks.update({
    status: passed ? "passed" : "failed",
    endedAt: run.endedAt || Date.now(),
  });
  hooks.emit("graph-changed", {});
}

async function retry(id, recoveryId, ctx, emit) {
  const parent = runs.get(id);
  if (!parent) throw new Error("unknown run");
  if (parent.status !== "failed")
    throw new Error("Only a failed run can be retried.");
  if (!parent.recovery || parent.recovery.id !== recoveryId)
    throw new Error(
      "Recovery proposal is stale or does not belong to this run.",
    );
  if (!parent.recovery.canRetry)
    throw new Error(
      parent.recovery.blockReason || "This run cannot be retried.",
    );
  const existing = [...runs.values()].find(
    (run) => run.retryOf === id && run.recoveryId === recoveryId,
  );
  if (existing) return publicRun(existing);
  if (retrying.has(id)) return retrying.get(id);
  const promise = start(
    { ctx, task: parent.task, parent, recovery: parent.recovery },
    emit,
  ).finally(() => retrying.delete(id));
  retrying.set(id, promise);
  return promise;
}
async function continueRun(id, text, ctx, emit) {
  const run = runs.get(id);
  if (!run) throw new Error("unknown run");
  if (!terminal.has(run.status)) {
    throw new Error(
      "This run is active. Stop it first, then start a new run with the revised brief.",
    );
  }
  if (run.status === "failed" || run.failure)
    throw new Error(
      "Apply the current recovery proposal before retrying a failed run.",
    );
  return start(
    {
      ctx,
      task: `${run.task}\n\nAdditional brief: ${text}`,
      parent: run,
      recovery: {
        id: `brief_${run.id}_${Date.now().toString(36)}`,
        prompt: text,
      },
    },
    emit,
  );
}
function stop(id, emit = () => {}) {
  const run = runs.get(id);
  if (!run) return false;
  if (!terminal.has(run.status)) {
    run.status = run.failure ? "failed" : "stopped";
    run.endedAt = Date.now();
    terminateProcessTree(run.proc);
    terminateProcessTree(run.verifyProc);
    saveRun(run);
    emit("run", publicRun(run));
  }
  return true;
}
async function diff(id) {
  const run = runs.get(id);
  if (!run?.worktree) throw new Error("unknown run");
  return attemptWorkspace.diff(run);
}

async function resumeExternal({ ctx, kind, sessionId, cwd, brief }, emit) {
  const h = harnessLib.load(ctx.harnessStore);
  const id = newId("x");
  const run = {
    id,
    rootId: id,
    kind,
    origin: "resumed",
    repo: ctx.repo,
    task: brief,
    issue: null,
    status: "running",
    step: 0,
    startedAt: Date.now(),
    attempt: 1,
    harnessVersion: h.version,
    transcript: [],
    verify: [],
    usage: {},
    sessionId,
    worktree: cwd,
    baseSha: (await git(cwd, ["rev-parse", "HEAD"])).trim(),
  };
  runs.set(id, run);
  run.intentDir = path.join(dataDir, "attempts", id, "intent");
  fs.mkdirSync(path.dirname(run.intentDir), { recursive: true });
  await git(path.dirname(ctx.intent.dir), [
    "clone",
    "-q",
    ctx.intent.dir,
    run.intentDir,
  ]);
  const intentEntries = graph.context(graph.loadGraph(ctx.intent), { text: brief }).map((entry) => ({ id: entry.id, title: entry.title, summary: `${entry.type}: ${entry.title}`, reason: entry.reason || "", source: "benana-intent", raw: entry }));
  const entireContext = await entire.context(ctx.repoPath, brief);
  run.contextBundle = { entries: [...intentEntries, ...entireContext.entries], ...(entireContext.errors?.length ? { errors: entireContext.errors } : {}) };
  const hooks = hooksFor(run, emit, ctx);
  hooks.say("system", `resumed ${kind} session ${sessionId} in ${cwd}`);
  executeAttempt(run, h, brief, hooks);
  return publicRun(run);
}

module.exports = {
  allRuns,
  continueRun,
  diff,
  get,
  hydrate,
  list,
  resumeExternal,
  retry,
  start,
  stop,
  _test: {
    executeAttempt,
    failure,
    gradeBasics,
    agentCommand,
    handleEvent,
    proposeRecovery,
    register: (run) => runs.set(run.id, run),
    verify,
  },
};

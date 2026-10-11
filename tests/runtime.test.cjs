const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { execFileSync } = require("node:child_process");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "benana-runtime-"));
process.env.BENANA_DATA_DIR = sandbox;
const agents = require("../electron/lib/agents.cjs");
const entire = require("../electron/lib/entire.cjs");
const neatlogs = require("../electron/lib/neatlogs.cjs");
const { copyWorkspace, runCommand } = require("../electron/lib/processes.cjs");

test("a nonzero agent process is an execution failure and never reaches verification", async () => {
  const worktree = fs.mkdtempSync(path.join(sandbox, "worktree-"));
  const run = {
    id: "run-nonzero",
    kind: "codex",
    attempt: 1,
    worktree,
    intentDir: worktree,
    transcript: [],
    verify: [],
  };
  const updates = [];
  const hooks = {
    update: (patch = {}) => {
      Object.assign(run, patch);
      updates.push({ ...patch });
    },
    say: () => {},
  };
  const spawnExecutable = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => child.emit("close", 7));
    return child;
  };
  await agents._test.executeAttempt(
    run,
    { systemPrompt: "", rules: [], graders: {} },
    "work",
    hooks,
    { spawnExecutable },
  );
  assert.equal(run.status, "failed");
  assert.equal(run.failure.kind, "execution");
  assert.deepEqual(run.verify, []);
  assert.equal(
    updates.some((update) => update.status === "verifying"),
    false,
  );
});

test("recovery proposal is exact deterministic feedback and does not claim a patch", () => {
  const run = { id: "failed-one", attempt: 1, worktree: sandbox };
  const recovery = agents._test.proposeRecovery(run, [
    { grader: "tests", detail: "exit 1" },
  ]);
  assert.equal(recovery.changes[0].after, recovery.prompt);
  assert.match(recovery.prompt, /tests: exit 1/);
  assert.equal(
    recovery.changes.some((change) => /file|patch/i.test(change.label)),
    false,
  );
});

test("retry validates the exact recovery id without mutating the failed attempt", async () => {
  const parent = {
    id: "retry-parent",
    status: "failed",
    attempt: 1,
    task: "fix it",
    recovery: { id: "approved-recovery", canRetry: true },
    transcript: [{ role: "agent", text: "failed" }],
    verify: [{ attempt: 1, results: [{ grader: "tests", pass: false }] }],
  };
  agents._test.register(parent);
  const before = JSON.stringify(parent);
  await assert.rejects(
    agents.retry("retry-parent", "stale-recovery", {}, () => {}),
    /stale/,
  );
  assert.equal(JSON.stringify(parent), before);
});

test("a failed run brief cannot bypass its recovery gate", async () => {
  const run = {
    id: "brief-failed",
    status: "failed",
    transcript: [],
    recovery: { id: "recovery-only" },
  };
  agents._test.register(run);
  await assert.rejects(
    agents.continueRun("brief-failed", "try again", {}, () => {}),
    /recovery proposal/,
  );
  assert.deepEqual(run.transcript, []);
});

test("an active run rejects a new brief with an actionable transition", async () => {
  const run = { id: "brief-active", status: "running", transcript: [] };
  agents._test.register(run);
  await assert.rejects(
    agents.continueRun("brief-active", "change course", {}, () => {}),
    /Stop it first.*start a new run/i,
  );
  assert.deepEqual(run.transcript, []);
});

test("a missing test command is a failed grader and cannot produce a verified outcome", () => {
  const results = agents._test.gradeBasics(
    ["changed.js"],
    { testCommand: "", maxFilesChanged: 5 },
    null,
  );
  const tests = results.find((result) => result.grader === "tests");
  assert.equal(tests.pass, false);
  assert.match(tests.detail, /Configure a test command/);
});

test("verification runner settles spawn errors and timeouts", async () => {
  const spawnError = () => {
    throw new Error("cannot spawn shell");
  };
  const failed = await runCommand("tests", sandbox, {
    spawnFn: spawnError,
    timeoutMs: 20,
  });
  assert.equal(failed.code, null);
  assert.match(failed.error, /cannot spawn shell/);
  const spawnHung = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    return child;
  };
  const timed = await runCommand("tests", sandbox, {
    spawnFn: spawnHung,
    timeoutMs: 5,
  });
  assert.equal(timed.timedOut, true);
  assert.match(timed.error, /timed out/);
});

test("saved runs hydrate only for the opened project", () => {
  const directory = path.join(sandbox, "runs");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "one.json"),
    JSON.stringify({ id: "one", repo: "a/one", startedAt: 2, transcript: [] }),
  );
  fs.writeFileSync(
    path.join(directory, "two.json"),
    JSON.stringify({ id: "two", repo: "b/two", startedAt: 1, transcript: [] }),
  );
  agents.hydrate("a/one");
  assert.deepEqual(
    agents.list("a/one").map((run) => run.id),
    ["one"],
  );
  assert.deepEqual(
    agents.list("b/two").map((run) => run.id),
    [],
  );
});

test("run lookup cannot cross the open project boundary", () => {
  agents._test.register({ id: "project-a-run", repo: "a/one", transcript: [] });
  assert.equal(agents.get("project-a-run", "b/two"), null);
  assert.equal(agents.get("project-a-run", "a/one").id, "project-a-run");
});

test("stopping during preparation never starts the provider", async () => {
  const repo = fs.mkdtempSync(path.join(sandbox, "prepare-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "base.txt"), "base\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: repo });
  let stoppedId;
  const result = await agents.start({
    ctx: {
      repo: "scope/prepare",
      repoPath: repo,
      intent: { dir: repo },
      harnessStore: { read: () => null },
    },
    task: "prepare only",
    agent: "codex",
  }, (channel, payload) => {
    if (channel === "run" && payload.status === "preparing" && !stoppedId) {
      stoppedId = payload.id;
      agents.stop(payload.id);
    }
  });
  assert.equal(result.id, stoppedId);
  assert.equal(result.status, "stopped");
  assert.equal(result.sessionId, undefined);
});

test("stopping during verification cancels its child and settles", async () => {
  const repo = fs.mkdtempSync(path.join(sandbox, "verify-cancel-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "change.txt"), "changed\n");
  const run = {
    id: "verify-cancel",
    repo: "scope/verify",
    kind: "codex",
    attempt: 1,
    status: "running",
    worktree: repo,
    intentDir: repo,
    transcript: [],
    verify: [],
  };
  agents._test.register(run);
  let verificationKilled = false;
  const runCommand = (_command, _cwd, { onSpawn }) => new Promise((resolve) => {
    const child = new EventEmitter();
    child.kill = () => {
      verificationKilled = true;
      child.killed = true;
      resolve({ code: null, error: "cancelled", tail: "cancelled" });
    };
    onSpawn(child);
  });
  const spawnExecutable = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => child.emit("close", 0));
    return child;
  };
  const hooks = {
    ctx: {}, emit: () => {}, say: () => {},
    update: (value = {}) => { Object.assign(run, value); return true; },
  };
  const execution = agents._test.executeAttempt(
    run,
    { systemPrompt: "", rules: [], graders: { testCommand: "tests", maxFilesChanged: 5, intentCheck: false } },
    "work",
    hooks,
    { spawnExecutable, runCommand },
  );
  while (run.status !== "verifying") await new Promise((resolve) => setImmediate(resolve));
  agents.stop(run.id);
  await execution;
  assert.equal(verificationKilled, true);
  assert.equal(run.status, "stopped");
  assert.deepEqual(run.verify, []);
});

test("Entire normalization retains raw ranked evidence and rejects an empty graph", async () => {
  const context = await entire.context("/repo", "find auth", {
    execute: async () => ({
      ok: true,
      out: JSON.stringify({
        matches: [
          {
            id: "sym1",
            name: "login",
            snippet: "function login() {}",
            ranking: { reason: "identifier" },
          },
        ],
      }),
    }),
  });
  assert.equal(context.entries[0].raw.id, "sym1");
  assert.equal(context.entries[0].source, "entire");
  const graph = await entire.graph("/repo", {
    execute: async () => ({ ok: true, out: '{"type":"header"}' }),
  });
  assert.equal(graph.available, false);
  assert.match(graph.error, /empty snapshot/);
});

test("Neatlogs evidence requires exact session correlation", async () => {
  process.env.NEATLOGS_API_KEY = "test";
  process.env.NEATLOGS_PROJECT_ID = "project";
  const calls = [];
  const result = await neatlogs.evidence(
    { id: "run1", sessionId: "session-good" },
    {
      api: async (resource) => {
        calls.push(resource);
        if (resource.startsWith("/traces?"))
          return {
            traces: [
              { traceId: "trace-good", sessionId: "session-good" },
              { traceId: "trace-wrong", sessionId: "other" },
            ],
          };
        return { spans: [{ spanId: "span1" }] };
      },
    },
  );
  assert.equal(result.matched, true);
  assert.deepEqual(
    result.traces.map((trace) => trace.traceId),
    ["trace-good"],
  );
  assert.equal(
    calls.some((call) => call.includes("trace-wrong")),
    false,
  );
  assert.equal(result.traces[0].spans.length, 1);
  assert.equal(result.traces[0].spans[0].spanId, "span1");
});

test("retry workspace is an exact snapshot including deletes, renames, and nested untracked files", () => {
  const source = fs.mkdtempSync(path.join(sandbox, "snapshot-source-"));
  const target = fs.mkdtempSync(path.join(sandbox, "snapshot-target-"));
  fs.writeFileSync(path.join(source, ".git"), "source git");
  fs.writeFileSync(path.join(target, ".git"), "target git");
  fs.writeFileSync(path.join(target, "deleted.txt"), "must disappear");
  fs.mkdirSync(path.join(source, "nested"));
  fs.writeFileSync(path.join(source, "renamed.txt"), "renamed");
  fs.writeFileSync(path.join(source, "nested", "new.txt"), "untracked nested");
  copyWorkspace(source, target);
  assert.equal(fs.existsSync(path.join(target, "deleted.txt")), false);
  assert.equal(fs.readFileSync(path.join(target, "renamed.txt"), "utf8"), "renamed");
  assert.equal(fs.readFileSync(path.join(target, "nested", "new.txt"), "utf8"), "untracked nested");
  assert.equal(fs.readFileSync(path.join(target, ".git"), "utf8"), "target git");
});

test("provider resume commands and event usage preserve native contracts", () => {
  const codex = agents._test.agentCommand({ id: "r", kind: "codex", attempt: 1, sessionId: "thread-1", worktree: sandbox, intentDir: sandbox }, { systemPrompt: "", rules: [] }, "continue");
  assert.deepEqual(codex.args.slice(0, 3), ["exec", "resume", "--json"]);
  assert.equal(codex.args.includes("--full-auto"), false);
  assert.equal(codex.args.some((arg) => arg.includes("mcp_servers.benana-intent.env")), true);
  assert.match(codex.stdin, /continue/);
  const run = { transcript: [], step: 0, usage: {} };
  const hooks = { say: () => {}, update: () => {} };
  agents._test.handleEvent(run, JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 3 } }), hooks);
  assert.deepEqual(run.usage, {
    inputTokens: 12,
    outputTokens: 3,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
  });
  agents._test.handleEvent(run, JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call", server: "benana" } }), hooks);
  assert.equal(run.step, 1);
});

test("Entire reports installation and repository enablement independently", async () => {
  const responses = [
    { ok: true, out: JSON.stringify({ version: "1.0.0" }) },
    { ok: true, out: JSON.stringify({ enabled: false }) },
  ];
  const status = await entire.status("/repo", { execute: async () => responses.shift() });
  assert.equal(status.installed, true);
  assert.equal(status.enabled, false);
  assert.match(status.error, /not enabled/i);
});

test("Entire graph parser follows provider record_type and relation endpoints", () => {
  const graph = entire.snapshotGraph([
    JSON.stringify({ schema_version: "1.3", provider: "entire-graph" }),
    JSON.stringify({ record_type: "symbol", id: "sym", qualified_name: "Auth.login", file_path: "auth.js", kind: "function" }),
    JSON.stringify({ record_type: "external", id: "db", name: "database", kind: "module" }),
    JSON.stringify({ record_type: "relation", from_id: "sym", to_id: "db", type: "CALLS", reason: "exact call", confidence: 0.92, evidence: [{ file_path: "auth.js" }] }),
  ].join("\n"));
  assert.deepEqual(graph.nodes.map((node) => node.id), ["sym", "db"]);
  assert.deepEqual(graph.edges[0], { id: "entire_edge_0", source: "sym", target: "db", relation: "CALLS", reason: "exact call", confidence: 0.92, file: "auth.js" });
});

test("verifier exceptions become execution failures and settle", async () => {
  const worktree = fs.mkdtempSync(path.join(sandbox, "verify-throw-"));
  fs.writeFileSync(path.join(worktree, ".git"), "placeholder");
  const run = { id: "verify-throw", kind: "codex", attempt: 1, worktree, intentDir: worktree, transcript: [], verify: [] };
  const hooks = { ctx: {}, emit: () => {}, update: (patch = {}) => Object.assign(run, patch), say: () => {} };
  const spawnExecutable = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    process.nextTick(() => child.emit("close", 0));
    return child;
  };
  await agents._test.executeAttempt(run, { systemPrompt: "", rules: [], graders: { testCommand: "x", maxFilesChanged: 5 } }, "work", hooks, { spawnExecutable });
  assert.equal(run.status, "failed");
  assert.equal(run.failure.kind, "execution");
});

test("Entire drops dangling relations without breaking the rendered graph", () => {
  const parsed = entire.snapshotGraph([
    JSON.stringify({ record_type: "relation", from_id: "sym", to_id: "missing", type: "CALLS" }),
    JSON.stringify({ record_type: "symbol", id: "sym", qualified_name: "run" }),
  ].join("\n"));
  assert.equal(parsed.edges.length, 0);
  assert.match(parsed.errors[0], /absent/);
  const cytoscape = require("cytoscape");
  const graph = cytoscape({ headless: true, elements: parsed.nodes.map((node) => ({ data: node })) });
  assert.equal(graph.nodes().length, 1);
  graph.destroy();
});

test("session directories use path boundaries and reject unknown resume identities", () => {
  const sessions = require("../electron/lib/sessions.cjs");
  const repo = path.join(sandbox, "session-repo");
  assert.equal(sessions.withinRepo(repo, repo), true);
  assert.equal(sessions.withinRepo(repo, path.join(repo, "packages")), true);
  assert.equal(sessions.withinRepo(repo, `${repo}-other`), false);
  assert.equal(sessions.withinRepo(repo, path.join(repo, "..", "outside")), false);
  assert.throws(() => sessions.resolveForRepo("codex", "unknown-session-id", sandbox), /no longer available/);
});

test("stopping a verifier persists only the attempt state, never its circular child process", () => {
  const child = { kill: () => {} };
  child.self = child;
  agents._test.register({ id: "stop-circular", status: "verifying", transcript: [], verifyProc: child });
  assert.equal(agents.stop("stop-circular"), true);
  const saved = agents.get("stop-circular");
  assert.equal(saved.status, "stopped");
  assert.equal(saved.verifyProc, undefined);
});

test("stopping failed checkpoint recording preserves the failure and recovery gate", async () => {
  const recovery = { id: "recovery-recording", canRetry: true };
  agents._test.register({ id: "recording-failure", status: "recording", failure: { kind: "verification" }, recovery, transcript: [] });
  assert.equal(agents.stop("recording-failure"), true);
  const run = agents.get("recording-failure");
  assert.equal(run.status, "failed");
  assert.deepEqual(run.recovery, recovery);
  await assert.rejects(agents.continueRun(run.id, "bypass", {}, () => {}), /recovery proposal/);
  assert.throws(() => require("../electron/lib/sessions.cjs").transcript("codex", "unknown", ""), /Open a local repository/);
});

test("a missing provider is a blocked setup prerequisite, not an instruction retry", async () => {
  const run = { id: "missing-provider", kind: "codex", attempt: 1, transcript: [], verify: [] };
  const hooks = { say: () => {}, update: patch => Object.assign(run, patch) };
  await agents._test.executeAttempt(run, { systemPrompt: "", rules: [] }, "fix", hooks, { spawnExecutable: () => { throw new Error("spawn codex ENOENT"); } });
  assert.equal(run.failure.kind, "setup");
  assert.equal(run.recovery.canRetry, false);
  assert.deepEqual(run.recovery.changes, []);
  assert.match(run.recovery.blockReason, /Install Codex/);
});

test("run diff includes tracked edits and untracked text without changing the checkout", async () => {
  const repo = fs.mkdtempSync(path.join(sandbox, "diff-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repo,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "tracked.txt"), "before\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: repo });
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  fs.writeFileSync(path.join(repo, "tracked.txt"), "after\n");
  fs.writeFileSync(path.join(repo, "new.txt"), "new content\n");
  agents._test.register({
    id: "diff-run",
    worktree: repo,
    baseSha,
    filesChanged: ["tracked.txt", "new.txt"],
    transcript: [],
  });
  const result = await agents.diff("diff-run");
  assert.match(result.diff, /-before/);
  assert.match(result.diff, /\+after/);
  assert.match(result.diff, /new content/);
  assert.equal(
    fs.readFileSync(path.join(repo, "tracked.txt"), "utf8"),
    "after\n",
  );
});

test("a playtest that skips test plan checks never passes", () => {
  const game = require("../electron/lib/game/index.cjs");
  const file = path.join(sandbox, "verdict-partial.json");
  const plan = { checks: [{ id: "explodes", expect: "boom" }, { id: "cooldown", expect: "no boom" }] };
  fs.writeFileSync(file, JSON.stringify({ version: 1, finished: true, checks: [{ id: "explodes", status: "pass" }], serverErrors: [] }));
  const verdict = game.readVerdict(file, plan);
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.checks.map((c) => `${c.id}=${c.status}`), ["explodes=pass", "cooldown=blocked"]);
});

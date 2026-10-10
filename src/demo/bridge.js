const now = Date.now();
const attempt1 = {
  id: "demo-1",
  rootId: "demo-root",
  attempt: 1,
  task: "Make checkout recovery safe after a failed verification",
  agent: "claude",
  status: "failed",
  harnessVersion: 7,
  step: "verification",
  startedAt: now - 680000,
  origin: "demo",
  sessionId: "sample-session-1",
  worktree: "/sample/benana-worktrees/recovery",
  usage: { inputTokens: 8421, outputTokens: 2180 },
  contextBundle: {
    entries: [
      {
        id: "ctx-1",
        title: "Retry policy",
        summary: "Retries create a new public attempt.",
        reason: "The task changes retry behavior.",
        source: "Entire",
        provider: "entire",
      },
      {
        id: "ctx-2",
        title: "Recovery command boundary",
        summary: "Only verified output may report success.",
        reason: "This constrains the completion state.",
        source: "Benana intent graph",
      },
    ],
  },
  transcript: [
    {
      role: "user",
      text: "Make checkout recovery safe after a failed verification.",
    },
    {
      role: "agent",
      text: "I traced the retry path and updated the recovery contract.",
    },
    { role: "tool", text: "Edited electron/run-manager.cjs" },
    {
      role: "verify",
      text: "npm test failed at recovery.integration.test.cjs",
    },
  ],
  failure: {
    kind: "verification",
    title: "Repository verification failed",
    detail:
      "The agent completed its work, but the repository test command failed.",
    evidence: [
      {
        label: "Failed step",
        text: "recovery.integration.test.cjs > preserves the original attempt",
        source: "local",
      },
      {
        label: "Assertion",
        text: "expected attempt 1 to remain failed, received passed",
        source: "neatlogs",
        traceId: "trace-demo-184",
      },
    ],
  },
  recovery: {
    id: "recovery-demo-1",
    title: "Preserve the failed attempt before retrying",
    diagnosis: "The retry path updates the original run record.",
    changes: [
      {
        label: "Agent instruction",
        before: "Retry the failed run.",
        after:
          "Create a new attempt. Preserve demo-1 as failed. Implement retryOf, rootId, and attempt incrementing, then run the repository checks.",
      },
    ],
    prompt:
      "Create a new attempt. Preserve demo-1 as failed. Implement retryOf, rootId, and attempt incrementing, then run the repository checks.",
    canRetry: true,
  },
  verify: [
    {
      attempt: 1,
      results: [
        { grader: "changes", pass: true, detail: "Changes detected" },
        { grader: "tests", pass: false, detail: "1 integration test failed" },
        { grader: "intent.check", pass: true, detail: "No intent conflicts" },
      ],
    },
  ],
  files: ["electron/run-manager.cjs", "test/recovery.integration.test.cjs"],
  diff: '@@ retryRun(run)\n- run.status = "running"\n+ return createRun({ retryOf: run.id, attempt: run.attempt + 1 })',
};
let runs = [attempt1];
let sampleInbox = null;
let sampleProposals = null;
let sampleSessions = null;
let listeners = {};
let nextRunNumber = 2;
const nextRunId = () => `demo-${nextRunNumber++}`;
const emit = (name, value) =>
  (listeners[name] || []).forEach((fn) => fn(value));
const project = {
  repo: "acme/benana",
  repoPath: "/sample/benana",
  name: "benana",
  nodes: 24,
  harness: {
    version: 7,
    rules: ["Never mark success before checks pass"],
    graders: { maxAttempts: 3, testCommand: "npm test" },
  },
};
const data = {
  "config:get": {
    autoOpen: false,
    last: {},
    env: { github: true, cloudflare: true, neatlogs: true },
  },
  "project:open": project,
  "project:summary": project,
  "run:list": () => runs,
  "sessions:detect": () =>
    sampleSessions ||
    (sampleSessions = [
      {
        id: "attached-1",
        kind: "codex",
        cwd: "/sample/benana",
        title: "Investigate flaky checkout cleanup",
        updatedAt: now - 900000,
      },
    ]),
  "inbox:list": () =>
    sampleInbox ||
    (sampleInbox = [
      {
        number: 42,
        title: "Retry loses failed verification evidence",
        labels: ["benana:auto"],
        state: "new",
        at: now - 3600000,
      },
    ]),
  "improve:list": () =>
    sampleProposals ||
    (sampleProposals = [
      {
        id: "proposal-8",
        title: "Require immutable retry records",
        rationale: "Two failed runs overwrote their first attempt.",
        status: "open",
        evidence: { runs: 8, retries: 3, neatlogsTraces: 2 },
        patch: {
          addRules: ["Keep prior attempts immutable when creating a retry."],
          graders: {},
        },
      },
    ]),
  "status:integrations": {
    artifacts: { configured: true, namespace: "demo-sample" },
    entire: { installed: true, enabled: true, version: "sample" },
    neatlogs: { configured: true, ok: true },
  },
  "graph:history": [
    {
      sha: "7af209c",
      ts: now - 86400000,
      actor: "Mina",
      subject: "Record retry policy",
    },
    {
      sha: "c128dd1",
      ts: now,
      actor: "Benana",
      subject: "Verification evidence",
    },
  ],
  "entire:overview": {
    status: "ready",
    checkpoints: {
      available: true,
      items: [
        {
          id: "cp-1",
          title: "Before retry refactor",
          summary: "Clean worktree checkpoint",
          at: now - 7200000,
        },
      ],
    },
    sessions: {
      available: true,
      items: [
        {
          id: "ent-1",
          title: "Retry contract implementation",
          summary: "Changed run persistence",
          at: now - 680000,
        },
      ],
    },
    graph: { available: true },
  },
  "entire:context": {
    provider: "entire",
    available: true,
    entries: [
      {
        id: "ec-1",
        title: "Immutable attempts",
        summary: "Earlier work established append-only run history.",
        reason: "Directly constrains retry persistence.",
        source: "Entire checkpoint",
      },
    ],
  },
  "entire:graph": {
    available: true,
    nodes: [
      {
        id: "a",
        label: "retryRun",
        file: "electron/run-manager.cjs",
        kind: "symbol",
      },
      {
        id: "b",
        label: "run-manager.cjs",
        file: "electron/run-manager.cjs",
        kind: "file",
      },
      {
        id: "c",
        label: "createRun",
        file: "electron/run-manager.cjs",
        kind: "symbol",
      },
    ],
    edges: [
      { id: "e1", source: "b", target: "a", relation: "DECLARES" },
      { id: "e2", source: "a", target: "c", relation: "CALLS" },
    ],
  },
  "neatlogs:evidence": {
    source: "neatlogs",
    configured: true,
    matched: true,
    matchReason: "Linked by trace ID trace-demo-184",
    traces: [
      {
        traceId: "trace-demo-184",
        traceName: "retry.verify",
        durationMs: 1842,
        status: "error",
        summary: "Original attempt mutated before test assertion",
        spans: [
          {
            spanId: "span-1",
            spanName: "verification test",
            status: "error",
            failure: "Expected attempt 1 to remain failed",
          },
        ],
      },
    ],
  },
};
async function invoke(channel, payload = {}) {
  if (channel === "neatlogs:evidence") {
    const run = runs.find((item) => item.id === payload.id);
    if (run?.id === attempt1.id) return { ok: true, data: data[channel] };
    const verified = run?.status === "passed";
    return {
      ok: true,
      data: {
        source: "neatlogs", configured: true, matched: verified,
        matchReason: verified ? `Sample trace matched to ${run.sessionId}` : "No sample trace for this attempt yet.",
        traces: verified ? [{
          traceId: `trace-${run.id}`, sessionId: run.sessionId,
          traceName: "retry.verify", status: "success", durationMs: 1350,
          spans: [{ spanId: `span-${run.id}`, spanName: "repository checks", status: "success" }],
        }] : [],
      },
    };
  }
  if (channel === "run:get")
    return { ok: true, data: runs.find((r) => r.id === payload.id) };
  if (channel === "run:diff") {
    const r = runs.find((x) => x.id === payload.id);
    return {
      ok: true,
      data: { diff: r?.diff || "", files: r?.files || [], baseSha: "7af209c" },
    };
  }
  if (channel === "run:retry") {
    const old = runs.find((r) => r.id === payload.id);
    if (
      !old ||
      old.status !== "failed" ||
      old.recovery?.id !== payload.recoveryId
    )
      return {
        ok: false,
        error: "This recovery does not match a failed sample attempt.",
      };
    const existing = runs.find((r) => r.retryOf === old.id);
    if (existing) return { ok: true, data: existing };
    const next = {
      ...structuredClone(old),
      id: nextRunId(),
      sessionId: `sample-session-${nextRunNumber - 1}`,
      usage: {},
      retryOf: old.id,
      rootId: old.rootId,
      attempt: 2,
      status: "running",
      step: "implementing",
      startedAt: Date.now(),
      failure: null,
      recovery: null,
      verify: [],
      transcript: [
        ...old.transcript,
        { role: "user", text: old.recovery.prompt },
        {
          role: "agent",
          text: "Creating a separate retry attempt and preserving the failed record.",
        },
      ],
    };
    runs = [next, ...runs];
    emit("run", next);
    setTimeout(() => {
      if (next.status === "stopped") return;
      Object.assign(next, { status: "verifying", step: "checks" });
      emit("run", { ...next });
    }, 900);
    setTimeout(() => {
      if (next.status === "stopped") return;
      Object.assign(next, {
        status: "passed",
        step: "complete",
        verify: [
          {
            attempt: 2,
            results: [
              { grader: "changes", pass: true, detail: "Changes detected" },
              { grader: "tests", pass: true, detail: "18 tests passed" },
              { grader: "intent.check", pass: true, detail: "No conflicts" },
            ],
          },
        ],
      });
      emit("run", { ...next });
    }, 2200);
    return { ok: true, data: next };
  }
  if (channel === "run:start") {
    const r = {
      id: nextRunId(),
      rootId: `root-${Date.now()}`,
      attempt: 1,
      task: payload.task,
      agent: payload.agent,
      harnessVersion: project.harness.version,
      status: "running",
      step: "preparing",
      startedAt: Date.now(),
      origin: "demo",
      contextBundle: {
        entries: project.harness.rules.map((rule, index) => ({
          id: `rule-${project.harness.version}-${index + 1}`,
          title: `Harness v${project.harness.version} rule`,
          summary: rule,
          reason: "This approved harness rule applies to the new run.",
          source: "Benana harness",
          provider: "benana",
        })),
      },
      transcript: [
        { role: "user", text: payload.task },
        {
          role: "agent",
          text: `Started with harness v${project.harness.version} and its approved rules.`,
        },
      ],
    };
    runs = [r, ...runs];
    if (payload.issueNumber) {
      sampleInbox = data["inbox:list"]().map((item) =>
        item.number === payload.issueNumber
          ? { ...item, state: "started" }
          : item,
      );
      emit("inbox", sampleInbox);
    }
    emit("run", r);
    setTimeout(() => {
      if (r.status === "stopped") return;
      Object.assign(r, { status: "verifying", step: "checks" });
      emit("run", { ...r });
    }, 700);
    setTimeout(() => {
      if (r.status === "stopped") return;
      Object.assign(r, {
        status: "passed",
        step: "complete",
        verify: [
          {
            attempt: 1,
            results: [
              { grader: "changes", pass: true, detail: "Changes detected" },
              { grader: "tests", pass: true, detail: "18 tests passed" },
              {
                grader: "intent.check",
                pass: true,
                detail: "No conflicts",
              },
            ],
          },
        ],
      });
      emit("run", { ...r });
    }, 1600);
    return { ok: true, data: r };
  }
  if (channel === "run:brief") {
    const current = runs.find((run) => run.id === payload.id);
    if (!current) return { ok: false, error: "Sample run not found." };
    if (current.status === "failed") {
      return {
        ok: false,
        error:
          "Failed attempts are immutable. Apply the recovery to create a retry.",
      };
    }
    current.transcript = [
      ...(current.transcript || []),
      { role: "user", text: payload.text },
      {
        role: "agent",
        text: "Added the follow-up instruction to this sample run.",
      },
    ];
    emit("transcript", {
      id: current.id,
      line: current.transcript.at(-2),
    });
    emit("transcript", {
      id: current.id,
      line: current.transcript.at(-1),
    });
    emit("run", { ...current });
    return { ok: true, data: current };
  }
  if (channel === "improve:decide") {
    const proposal = data["improve:list"]().find(
      (item) => item.id === payload.id,
    );
    if (!proposal) return { ok: false, error: "Sample proposal not found." };
    sampleProposals = data["improve:list"]().map((item) =>
      item.id === payload.id
        ? { ...item, status: payload.approve ? "approved" : "rejected" }
        : item,
    );
    if (payload.approve)
      project.harness = {
        ...project.harness,
        version: project.harness.version + 1,
        rules: [...project.harness.rules, ...proposal.patch.addRules],
      };
    emit("proposals", sampleProposals);
    emit("project", { ...project });
    return {
      ok: true,
      data: sampleProposals.find((item) => item.id === payload.id),
    };
  }
  if (channel === "run:stop") {
    const current = runs.find((run) => run.id === payload.id);
    if (!current) return { ok: false, error: "Sample run not found." };
    if (["running", "preparing", "verifying"].includes(current.status)) {
      current.status = "stopped";
      current.step = "stopped";
      emit("run", { ...current });
    }
    return { ok: true, data: current };
  }
  if (channel === "graph:ingest") return { ok: true, data: project };
  if (channel === "harness:update") {
    project.harness = {
      ...project.harness,
      ...payload,
      graders: { ...project.harness.graders, ...(payload.graders || {}) },
      version: project.harness.version + 1,
    };
    emit("project", { ...project });
    return { ok: true, data: project.harness };
  }
  if (channel === "improve:stats") {
    const completed = runs.filter((run) =>
      ["passed", "failed"].includes(run.status),
    );
    const versions = [...new Set(completed.map((run) => run.harnessVersion))]
      .filter((version) => version != null)
      .sort((left, right) => left - right);
    const versionStats = (version) => {
      const matching = completed.filter(
        (run) => run.harnessVersion === version,
      );
      return {
        label: `Harness v${version}`,
        runs: matching.length,
        passed: matching.filter((run) => run.status === "passed").length,
      };
    };
    return {
      ok: true,
      data: {
        runs: completed.length,
        passed: completed.filter((run) => run.status === "passed").length,
        retries: completed.filter((run) => run.retryOf).length,
        fails: {
          tests: completed.filter(
            (run) =>
              run.failure?.kind === "verification" ||
              run.verify?.some((attempt) =>
                attempt.results?.some(
                  (result) => result.grader === "tests" && !result.pass,
                ),
              ),
          ).length,
        },
        before: versions.length ? versionStats(versions[0]) : null,
        after: versions.length > 1 ? versionStats(versions.at(-1)) : null,
      },
    };
  }
  if (channel === "improve:analyze")
    return {
      ok: true,
      data: {
        proposal: data["improve:list"]()[0],
        stats: { runs: runs.length },
      },
    };
  if (channel === "sessions:plan")
    return {
      ok: true,
      data: {
        claude: "claude mcp add --scope user benana-intent",
        codex: "[mcp_servers.benana-intent]",
        codexFile: "~/.codex/config.toml",
      },
    };
  if (channel === "sessions:transcript")
    return {
      ok: true,
      data: [
        { role: "user", text: "Investigate flaky checkout cleanup" },
        {
          role: "agent",
          text: "I am reviewing the cleanup sequence in this sample session.",
        },
      ],
    };
  if (channel === "sessions:resume")
    return invoke("run:start", { task: payload.brief, agent: payload.kind });
  if (channel === "sessions:install")
    return { ok: true, data: { installed: true, sample: true } };
  if (channel === "sessions:uninstall")
    return { ok: true, data: { installed: false, sample: true } };
  if (channel === "open-path") return { ok: true, data: "" };
  if (channel === "graph:load")
    return { ok: true, data: { nodes: [], edges: [] } };
  const value = data[channel];
  return value === undefined
    ? { ok: false, error: `Demo does not implement ${channel}` }
    : { ok: true, data: typeof value === "function" ? value(payload) : value };
}
export const demoBridge = {
  invoke,
  on(channel, fn) {
    listeners[channel] = [...(listeners[channel] || []), fn];
    return () => {
      listeners[channel] = (listeners[channel] || []).filter((x) => x !== fn);
    };
  },
  openExternal() {},
};

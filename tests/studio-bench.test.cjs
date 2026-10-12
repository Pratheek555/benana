const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "benana-studio-bench-"));
process.env.BENANA_DATA_DIR = sandbox;

function stub(rel, exports) {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}

const prompts = [];
const deploys = [];
const verdictFiles = [];

stub("../electron/lib/neatlogs.cjs", { configured: () => false, evidence: async () => ({ matched: false }), status: async () => ({}) });
stub("../electron/lib/game/index.cjs", {
  status: () => ({ mock: true, bot: "online", deploying: null, resetting: false, deployed: null }),
  start: async () => {},
  deployPlugin: async (args) => { deploys.push(args); return { loaded: true, errors: [] }; },
  // The grader passes everything except the boss bar, so scoring sees a real failure.
  mockVerdict: (plan) => ({
    version: 1, finished: true, serverErrors: [], summary: "[mock]",
    checks: plan.checks.map((c) => ({ id: c.id, status: c.id === "boss-bar" ? "fail" : "pass", expected: c.expect, observed: c.id === "boss-bar" ? "no boss bar" : "[mock]" })),
  }),
  readVerdict: (file, plan) => {
    verdictFiles.push(file);
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...v, passed: v.checks.every((c) => c.status === "pass"), serverErrors: [], finished: true, plan };
  },
  mcpConfig: () => ({}), playtestPrompt: () => "", playtesterTools: [], demoPrompt: () => "", demoTools: [], resetWorld: async () => ({}),
});
stub("../electron/lib/studio/repo.cjs", {
  create: async ({ slug }) => {
    const dir = path.join(sandbox, "mods", slug);
    fs.mkdirSync(dir, { recursive: true });
    return { dir, partners: {} };
  },
  commit: async () => ({ ok: true, sha: "abcdef1", checkpoint: null }),
  build: async (dir, name) => {
    const jar = path.join(dir, `${name}.jar`);
    const zip = path.join(dir, `${name}-pack.zip`);
    fs.writeFileSync(jar, "jar");
    fs.writeFileSync(zip, "zip");
    return { ok: true, jar, log: "", assets: { ok: true, errors: [], warnings: [], items: [{ id: "benana:storm_core", size: 16, texture: "data:image/png;base64,AA==" }], zip } };
  },
  checkpoints: async () => ({ ok: false, items: [] }),
  history: async () => "",
  enableNeatlogs: async () => ({ enabled: false }),
});
stub("../electron/lib/studio/claude.cjs", {
  MODELS: { build: "opus", playtest: "sonnet" },
  runClaude: ({ prompt }) => {
    prompts.push(prompt);
    let final = "Done.";
    if (/You are the spec agent/.test(prompt)) {
      final = JSON.stringify({
        modName: "StormGolem", summary: "A boss.", behavior: ["boss"], assets: [{ name: "storm_core", look: "a purple gem" }],
        testPlan: { version: 1, setup: [], checks: [{ id: "summon", title: "Summon", steps: "/stormgolem", expect: "a boss" }] },
      });
    }
    return { done: Promise.resolve({ ok: true, sessionId: `s${prompts.length}`, final, usage: { costUsd: 0.5 }, error: null }), stop() {} };
  },
});

const studio = require("../electron/lib/studio/index.cjs");
const bench = require("../electron/lib/studio/bench.cjs");
const rpc = studio.handlers({ emit: () => {}, log: () => {} });

test('studio registers the creator finance handlers', () => {
  for (const channel of ['cfo:books', 'cfo:quote', 'cfo:export', 'cfo:status', 'cfo:connect', 'cfo:signin', 'cfo:history', 'cfo:active', 'cfo:ask', 'cfo:stop']) {
    assert.equal(typeof rpc[channel], 'function', channel);
  }
});

async function settled(id) {
  for (let i = 0; i < 200; i++) {
    const mod = rpc["studio:get"]({ id });
    if (!mod.running && ["passed", "failed", "stopped"].includes(mod.status)) return mod;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("The build never settled.");
}

test("bench tasks are listed without their hidden expectations", () => {
  const [task] = rpc["studio:bench-tasks"]();
  assert.equal(task.id, "storm-golem");
  assert.equal(task.gold, undefined);
  assert.ok(task.checks.length >= 6);
  assert.ok(task.checks.every((c) => c.id && c.title && task.capabilities[c.capability]), "every check names a known capability");
});

test("a bench run builds the request, then grades the final build with hidden checks and records a score", async () => {
  const created = rpc["studio:bench-run"]({ taskId: "storm-golem" });
  assert.equal(rpc['cfo:books']().mods.some((row) => row.id === created.id), false, 'active internal mods are excluded from finance books');
  const mod = await settled(created.id);
  const task = bench.task("storm-golem");

  assert.equal(mod.status, "passed");
  assert.equal(mod.prompt, task.prompt);
  assert.deepEqual(mod.spec.assets, [{ name: "storm_core", look: "a purple gem" }]);

  // The hidden checks never reach the agents that build the mod, and the grader's verdict stays outside the mod repo.
  const builders = prompts.filter((p) => !/You are the coach/.test(p));
  for (const c of task.gold.checks) assert.ok(builders.every((p) => !p.includes(c.expect)), `${c.id} stays hidden`);
  const graded = verdictFiles.filter((f) => /[\\/]bench[\\/]/.test(f));
  assert.ok(graded.length > 0);
  assert.ok(graded.every((f) => !f.startsWith(mod.repoDir)));

  // The grader redeploys the final build with its resource pack.
  assert.equal(deploys.at(-1).packPath, path.join(mod.repoDir, "StormGolem-pack.zip"));

  const result = mod.bench.result;
  assert.equal(result.taskId, "storm-golem");
  assert.equal(result.total, task.gold.checks.length + 1);
  assert.equal(result.passed, result.total - 1);
  assert.equal(result.checks.find((c) => c.id === "boss-bar").status, "fail");
  assert.equal(result.checks.find((c) => c.id === "assets").status, "pass");
  assert.ok(result.costUsd > 0);
  assert.deepEqual(rpc["studio:bench-results"]().map((r) => r.modId), [mod.id]);
  assert.match(mod.feed.at(-1).text, /benchmark \d+\/\d+/);
});

test("scoring counts unreported checks as blocked and fails the asset check without a build", () => {
  const task = bench.task("storm-golem");
  const scored = bench.score(task, null, null);
  assert.equal(scored.passed, 0);
  assert.ok(scored.checks.filter((c) => c.by === "grader").every((c) => c.status === "blocked"));
  assert.equal(scored.checks.find((c) => c.id === "assets").status, "fail");
});

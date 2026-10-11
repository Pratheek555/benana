const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "benana-studio-turns-"));
process.env.BENANA_DATA_DIR = sandbox;

// The pipeline normally needs Claude Code, Maven, git and a Paper server. Stub them so the turn logic runs for real.
function stub(rel, exports) {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}

const prompts = [];
const commits = [];

stub("../electron/lib/neatlogs.cjs", { configured: () => false, evidence: async () => ({ matched: false }), status: async () => ({}) });
stub("../electron/lib/game/index.cjs", {
  status: () => ({ mock: true, bot: "online", deploying: null, resetting: false, deployed: null }),
  start: async () => {},
  deployPlugin: async () => ({ loaded: true, errors: [] }),
  // The first attempt of the whole chat fails so the fixer runs once.
  mockVerdict: (plan, n) => ({
    version: 1, finished: true, serverErrors: [], summary: "[mock]",
    checks: plan.checks.map((c, i) => ({ id: c.id, status: n <= 1 && i === 0 ? "fail" : "pass", expected: c.expect, observed: "[mock]" })),
  }),
  readVerdict: (file, plan) => {
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
  commit: async (dir, message) => {
    commits.push(message);
    return { ok: true, sha: `${commits.length}`.padStart(7, "a"), checkpoint: null };
  },
  build: async (dir, name) => ({ ok: true, jar: path.join(dir, `${name}.jar`), log: "" }),
  checkpoints: async () => ({ ok: false, items: [] }),
  history: async () => "",
});
stub("../electron/lib/studio/claude.cjs", {
  MODELS: { build: "opus", playtest: "sonnet" },
  runClaude: ({ prompt }) => {
    prompts.push(prompt);
    let final = "Done.";
    if (/You are the spec agent/.test(prompt)) {
      const revising = /already exists and asked for a change/.test(prompt);
      final = JSON.stringify({
        // A revision must not be able to rename the plugin: its repo, jar and main class already use the old name.
        modName: revising ? "SomethingElse" : "SkyBlade",
        summary: revising ? "Launches mobs and sets them on fire." : "Launches mobs.",
        behavior: revising ? ["launch", "ignite"] : ["launch"],
        testPlan: { version: 1, setup: [], checks: revising
          ? [{ id: "launch", title: "Launch", steps: "hit", expect: "up" }, { id: "ignite", title: "Ignite", steps: "hit", expect: "fire" }]
          : [{ id: "launch", title: "Launch", steps: "hit", expect: "up" }, { id: "cooldown", title: "Cooldown", steps: "hit twice", expect: "once" }] },
      });
    } else if (/You are the fixer agent/.test(prompt)) {
      final = "Patched.\nLESSON: apply velocity next tick";
    }
    return { done: Promise.resolve({ ok: true, sessionId: `s${prompts.length}`, final, usage: null, error: null }), stop() {} };
  },
});

const studio = require("../electron/lib/studio/index.cjs");
const events = [];
const rpc = studio.handlers({ emit: (channel, data) => events.push([channel, data]), log: () => {} });

async function settled(id) {
  for (let i = 0; i < 200; i++) {
    const mod = rpc["studio:get"]({ id });
    if (!mod.running && ["passed", "failed", "stopped"].includes(mod.status)) return mod;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("The build never settled.");
}

test("a follow-up message changes the same mod instead of creating another", async () => {
  const created = rpc["studio:create"]({ prompt: "A sword that launches mobs into the sky." });
  const first = await settled(created.id);
  assert.equal(first.status, "passed");
  assert.deepEqual(first.attempts.map((a) => [a.n, a.turn, a.role]), [[1, 0, "builder"], [2, 0, "fixer"]]);
  assert.equal(first.turns.length, 1);
  assert.equal(first.turns[0].status, "passed");
  assert.deepEqual(first.turns[0].checks.map((c) => c.id), ["launch", "cooldown"]);

  const revised = rpc["studio:revise"]({ id: created.id, prompt: "Also set the mob on fire." });
  assert.equal(revised.id, created.id);
  const second = await settled(created.id);

  // Still one mod, one repository, one name.
  assert.equal(rpc["studio:list"]().length, 1);
  assert.equal(second.repoDir, first.repoDir);
  assert.equal(second.name, "SkyBlade");
  assert.equal(second.prompt, first.prompt);

  // The new turn continues the attempt numbering, edits in place, and does not touch the first turn's record.
  assert.equal(second.status, "passed");
  assert.equal(second.turns.length, 2);
  assert.deepEqual(second.turns.map((t) => t.revision || false), [false, true]);
  assert.equal(second.turns[1].prompt, "Also set the mob on fire.");
  assert.equal(second.turns[1].status, "passed");
  assert.deepEqual(second.turns[1].checks.map((c) => c.id), ["launch", "ignite"]);
  assert.deepEqual(second.turns[0].checks.map((c) => c.id), ["launch", "cooldown"]);
  assert.deepEqual(second.attempts.map((a) => [a.n, a.turn]), [[1, 0], [2, 0], [3, 1]]);
  assert.equal(second.attempts[2].revision, true);
  assert.equal(second.attempts[2].role, "builder");
  assert.deepEqual(second.testPlan.checks.map((c) => c.id), ["launch", "ignite"]);
  assert.equal(second.sessions.filter((s) => s.role === "spec").map((s) => s.turn).join(), "0,1");

  // The agents saw the existing spec and the user's request, not a fresh description.
  const specRevision = prompts.find((p) => /already exists and asked for a change/.test(p));
  assert.match(specRevision, /Also set the mob on fire\./);
  assert.match(specRevision, /"id": "cooldown"/);
  const reviser = prompts.find((p) => /already exists in the current repository/.test(p));
  assert.match(reviser, /Also set the mob on fire\./);
  assert.match(reviser, /"id": "ignite"/);
  assert.ok(commits.some((m) => /^Attempt 3 \(builder\): change SkyBlade: Also set the mob on fire\./.test(m)));

  // The message lands in the thread at its own turn.
  const feed = rpc["studio:get"]({ id: created.id }).feed;
  const user = feed.filter((f) => f.kind === "user");
  assert.deepEqual(user.map((f) => [f.turn, f.text]), [[1, "Also set the mob on fire."]]);
  const plans = feed.flatMap((f, i) => (f.kind === "plan" ? [i] : []));
  const at = feed.findIndex((f) => f.kind === "user");
  assert.equal(plans.length, 2);
  assert.ok(plans[0] < at && at < plans[1], "the follow-up sits between the first turn's plan and its own");
});

test("rejects a follow-up while a build is running or when it is too short to act on", async () => {
  const created = rpc["studio:create"]({ prompt: "A bow that fires lightning." });
  assert.throws(() => rpc["studio:revise"]({ id: created.id, prompt: "Make it stronger please." }), /Another mod is running/);
  assert.throws(() => rpc["studio:create"]({ prompt: "A second mod at the same time." }), /Another mod is running/);
  await settled(created.id);
  assert.throws(() => rpc["studio:revise"]({ id: created.id, prompt: "hm" }), /Describe the change/);
  assert.throws(() => rpc["studio:revise"]({ id: "mod_missing", prompt: "Make it stronger please." }), /Unknown mod/);
});

test("a mod saved before chats had turns opens with its request as the first turn", async () => {
  const dir = path.join(sandbox, "studio", "mod_legacy");
  fs.mkdirSync(dir, { recursive: true });
  const legacy = {
    id: "mod_legacy", prompt: "An old sword.", name: "OldSword", status: "passed", phase: "done", createdAt: 1, updatedAt: 1,
    spec: { summary: "Old.", behavior: [] }, testPlan: { checks: [{ id: "hit", title: "Hit", expect: "x" }] },
    attempts: [{ n: 1, role: "builder", status: "passed", sessions: [] }], sessions: [], feed: [], repoDir: null,
  };
  fs.writeFileSync(path.join(dir, "mod.json"), JSON.stringify(legacy));
  const reloaded = studio.handlers({ emit: () => {}, log: () => {} });
  const mod = reloaded["studio:get"]({ id: "mod_legacy" });
  assert.deepEqual(mod.turns, [{ prompt: "An old sword.", at: 1, summary: "Old.", checks: legacy.testPlan.checks, endPhase: "done", status: "passed" }]);
});

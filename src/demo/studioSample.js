import stormGolem from "../../bench/storm-golem/task.json";
const NOW = Date.now();
const MIN = 60_000;
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const at = (agoMin) => NOW - agoMin * MIN;

const check = (id, title, expect) => ({ id, title, expect });
const vcheck = (id, status, observed) => ({ id, status, observed });
const verdict = ({ passed, finished = true, checks, live = false, error = null }) => ({
  passed,
  finished,
  checks,
  live,
  error,
  serverErrors: [],
});
const commit = (sha, checkpoint = null) => ({ sha, checkpoint });

const session = ({ role, model = OPUS, startAgo, lenMin = null, sessionId, cost, inTok, outTok, ok = true, error = null }) => ({
  role,
  model,
  sessionId,
  startedAt: at(startAgo),
  endedAt: lenMin == null ? null : at(startAgo - lenMin),
  ok: lenMin == null ? undefined : ok,
  error,
  usage: {
    inputTokens: inTok,
    outputTokens: outTok,
    cacheReadInputTokens: Math.round(inTok * 0.6),
    cacheCreationInputTokens: 0,
    costUsd: cost,
  },
});

const attempt = ({
  n,
  role,
  status,
  startAgo,
  sessions,
  build = { ok: true },
  deploy = null,
  commit: c,
  playtestCommit = null,
  verdict: v = null,
  failure = null,
  lesson = null,
  context = null,
  summary = "",
}) => ({
  n,
  role,
  status,
  startedAt: at(startAgo),
  sessions,
  build,
  deploy,
  commit: c,
  playtestCommit,
  verdict: v,
  failure,
  lesson,
  context,
  summary,
});

const mod = ({ id, name, prompt, seed = false, status, phase, running = false, ago, spec, testPlan, sessions, attempts, feed = [], error = null }) => ({
  id,
  name,
  prompt,
  seed,
  status,
  phase,
  running,
  createdAt: at(ago),
  updatedAt: at(0),
  spec,
  testPlan,
  sessions,
  attempts,
  feed,
  repoDir: `/sample/benana-mods/${name.toLowerCase()}-${id.slice(-4)}`,
  partners: { entire: { enabled: true }, neatlogs: { enabled: true } },
  error,
});

const brief = ({ feed, ...rest }) => ({ ...rest, feedCount: feed.length });

const launchPlan = {
  modName: "LaunchSword",
  checks: [
    check("launch", "Hit launches the mob upward", "Mob rises at least 6 blocks"),
    check("cooldown", "Second hit inside 3 s does nothing", "No launch during cooldown"),
    check("particles", "Particles play on launch", "A particle burst near the mob"),
    check("no-errors", "No server errors", "Console stays clean"),
  ],
};

const blazePlan = {
  modName: "BlazeBolt",
  checks: [
    check("fire", "Right-click fires a fireball", "A fireball spawns from the player"),
    check("aim", "Fireball follows the look direction", "Travel matches the view angle"),
    check("no-blocks", "Fireball does not break blocks in flight", "No block changes in flight"),
  ],
};

const arrowPlan = {
  modName: "PhantomArrows",
  checks: [
    check("explode", "Arrow explodes on impact", "Explosion effect at the hit point"),
    check("blocks", "Blocks survive the explosion", "No block changes at impact"),
    check("cooldown", "Second shot within 5 s is refused", "No second arrow for 5 seconds"),
  ],
};

const trailPlan = {
  modName: "TrailBlazer",
  checks: [
    check("trail", "Glowing trail while sneaking", "Particles follow the player while sneaking"),
    check("fade", "Trail fades after 2 seconds", "Particles gone within 2 seconds"),
    check("gate", "No trail while walking", "No particles when not sneaking"),
  ],
};

const MODS = [
  mod({
    id: "mod_d4",
    name: "TrailBlazer",
    prompt: "Sneaking while holding a feather spawns a trail of glowing particles behind you, fading after 2 seconds.",
    status: "running",
    phase: "playtest",
    running: true,
    ago: 5,
    spec: {
      summary: "A feather that trails glowing particles while the player sneaks.",
      behavior: ["Sneaking with a feather spawns particles", "Particles fade after 2 seconds", "Walking does not spawn particles"],
    },
    testPlan: trailPlan,
    sessions: [session({ role: "spec", startAgo: 5, lenMin: 1, sessionId: "sess-d-spec", cost: 0.35, inTok: 14800, outTok: 2400 })],
    attempts: [
      attempt({
        n: 1,
        role: "builder",
        status: "running",
        startAgo: 3,
        sessions: [
          session({ role: "builder", startAgo: 3, lenMin: 2, sessionId: "sess-d-build", cost: 0.94, inTok: 66000, outTok: 17000 }),
          session({ role: "playtester", model: SONNET, startAgo: 1, sessionId: "sess-d-pt1", cost: 0.12, inTok: 21000, outTok: 900 }),
        ],
        deploy: { loaded: true },
        commit: commit("4a7f1d92", "b6e3d0a8c4f1"),
        verdict: verdict({ passed: false, finished: false, live: true, checks: [vcheck("trail", "pass", "Glowing trail seen while sneaking")] }),
      }),
    ],
    feed: [
      { at: at(5), role: "benana", kind: "phase", phase: "spec", text: "Writing the spec and an in-game test plan" },
      { at: at(4.9), role: "spec", kind: "text", text: "I'll treat the trail as client-visible particles spawned on **PlayerMoveEvent** while the player is sneaking and holding a `FEATHER`. The test plan checks the trail appears, fades, and stays off while walking." },
      { at: at(4.5), role: "spec", kind: "plan", text: "3 checks: Glowing trail while sneaking · Trail fades after 2 seconds · No trail while walking" },
      { at: at(4), role: "benana", kind: "phase", phase: "repo", text: "Creating the mod repository with Entire and Neatlogs hooks" },
      { at: at(3), attempt: 1, role: "benana", kind: "phase", phase: "build", text: "Attempt 1: writing TrailBlazer" },
      { at: at(2.9), attempt: 1, role: "builder", kind: "tool", name: "Read", summary: "{\"file_path\":\"playtest/test-plan.json\"}" },
      { at: at(2.8), attempt: 1, role: "builder", kind: "tool", name: "Write", summary: "{\"file_path\":\"src/main/resources/plugin.yml\"}" },
      { at: at(2.5), attempt: 1, role: "builder", kind: "tool", name: "Edit", summary: "{\"file_path\":\"src/main/java/dev/benana/mod/TrailBlazer.java\"}" },
      { at: at(2.3), attempt: 1, role: "builder", kind: "tool", name: "Bash", summary: "{\"command\":\"mvn -q package\"}" },
      { at: at(2), attempt: 1, role: "builder", kind: "text", text: "Particle trail spawns on move events while the player is sneaking.\n\n- Uses `Particle.END_ROD` so the trail glows\n- A per-player `BukkitTask` clears it after **40 ticks**" },
      { at: at(1.9), attempt: 1, role: "benana", kind: "phase", phase: "compile", text: "Compiling the plugin with Maven" },
      { at: at(1.85), attempt: 1, role: "benana", kind: "phase", phase: "deploy", text: "Deploying TrailBlazer to the Paper server" },
      { at: at(1.8), attempt: 1, role: "benana", kind: "note", text: "Committed 4a7f1d9, Entire checkpoint b6e3d0a8c4f1" },
      { at: at(1.5), attempt: 1, role: "benana", kind: "phase", phase: "playtest", text: "Attempt 1: the AI player is testing TrailBlazer in-game" },
      { at: at(1.4), attempt: 1, role: "playtester", kind: "tool", name: "game_setup", summary: "{\"commands\":[\"give Benana feather\",\"tp Benana 0 64 0\"]}" },
      { at: at(1.3), attempt: 1, role: "playtester", kind: "tool", name: "equip", summary: "{\"item\":\"feather\"}" },
      { at: at(1.2), attempt: 1, role: "playtester", kind: "tool", name: "move_to", summary: "{\"x\":6,\"z\":0,\"sneak\":true}" },
      { at: at(1.1), attempt: 1, role: "playtester", kind: "tool", name: "track_entity", summary: "{\"entityId\":\"self\",\"ticks\":40}" },
      { at: at(1), attempt: 1, role: "playtester", kind: "result", name: "track_entity", text: "14 trail particles visible while sneaking" },
      { at: at(0.9), attempt: 1, role: "playtester", kind: "tool", name: "report_check", summary: "{\"id\":\"trail\",\"status\":\"pass\",\"expected\":\"Particles follow the player\",\"observed\":\"Glowing trail seen while sneaking\"}" },
      { at: at(0.5), attempt: 1, role: "playtester", kind: "text", text: "Trail appears while sneaking. Checking the fade timing next." },
      { at: at(0.3), attempt: 1, role: "playtester", kind: "tool", name: "wait_ticks", summary: "{\"ticks\":40}" },
    ],
  }),
  mod({
    id: "mod_b2",
    name: "BlazeBolt",
    prompt: "Right-clicking with a blaze rod shoots a fireball where you look.",
    status: "passed",
    phase: "done",
    ago: 120,
    spec: {
      summary: "A blaze rod that fires a fireball along the player's view.",
      behavior: ["Right-click fires one fireball", "The fireball follows the look direction"],
    },
    testPlan: blazePlan,
    sessions: [session({ role: "spec", startAgo: 120, lenMin: 1, sessionId: "sess-b-spec", cost: 0.38, inTok: 15100, outTok: 2600 })],
    attempts: [
      attempt({
        n: 1,
        role: "builder",
        status: "passed",
        startAgo: 117,
        sessions: [
          session({ role: "builder", startAgo: 117, lenMin: 6, sessionId: "sess-b-build", cost: 1.12, inTok: 74000, outTok: 21000 }),
          session({ role: "playtester", model: SONNET, startAgo: 110, lenMin: 5, sessionId: "sess-b-pt1", cost: 0.46, inTok: 61000, outTok: 3300 }),
        ],
        deploy: { loaded: true },
        commit: commit("e19a4c0d", "a4d0f9e2c115"),
        playtestCommit: commit("b0d7e13f", "91c7e0a3b2d4"),
        verdict: verdict({
          passed: true,
          checks: [
            vcheck("fire", "pass", "One fireball spawned"),
            vcheck("aim", "pass", "Travel matched the view angle"),
            vcheck("no-blocks", "pass", "No block changes"),
          ],
        }),
        summary: "Spawned a fireball entity along the player's look vector on right-click.",
      }),
    ],
    feed: [],
  }),
  mod({
    id: "mod_c3",
    name: "PhantomArrows",
    prompt: "Arrows that explode on impact without breaking blocks, with a 5 second cooldown per player.",
    status: "failed",
    phase: "done",
    ago: 1440,
    spec: {
      summary: "Arrows that explode on impact, leave blocks intact, and share a per-player cooldown.",
      behavior: ["Arrows explode on impact", "Blocks are not broken", "Shots are limited to one per 5 seconds"],
    },
    testPlan: arrowPlan,
    sessions: [session({ role: "spec", startAgo: 1440, lenMin: 1, sessionId: "sess-c-spec", cost: 0.4, inTok: 16200, outTok: 2800 })],
    attempts: [
      attempt({
        n: 1,
        role: "builder",
        status: "failed",
        startAgo: 1436,
        sessions: [session({ role: "builder", startAgo: 1436, lenMin: 5, sessionId: "sess-c-build1", cost: 1.04, inTok: 69000, outTok: 18000 })],
        build: { ok: false },
        commit: commit("5c2e8a10"),
        failure: { kind: "build", summary: "The plugin did not compile." },
      }),
      attempt({
        n: 2,
        role: "fixer",
        status: "failed",
        startAgo: 1428,
        sessions: [
          session({ role: "fixer", startAgo: 1428, lenMin: 4, sessionId: "sess-c-fix2", cost: 0.79, inTok: 102000, outTok: 8400 }),
          session({ role: "playtester", model: SONNET, startAgo: 1422, lenMin: 6, sessionId: "sess-c-pt2", cost: 0.52, inTok: 79000, outTok: 3600 }),
        ],
        deploy: { loaded: true },
        commit: commit("9e4c51f0", "d02a7b6e9f18"),
        playtestCommit: commit("2a8d6f3c", "7f3b9c1d0e52"),
        verdict: verdict({
          passed: false,
          checks: [
            vcheck("explode", "pass", "Arrow exploded on the target"),
            vcheck("blocks", "fail", "Two blocks broke at impact"),
            vcheck("cooldown", "fail", "Second arrow fired at 2 s"),
          ],
        }),
        failure: { kind: "playtest", summary: "blocks: Two blocks broke at impact · cooldown: Second arrow fired at 2 s" },
        lesson: "Cancel block updates in the projectile hit event.",
        context: { entireCheckpoints: 1, neatlogsTrace: true },
      }),
      attempt({
        n: 3,
        role: "fixer",
        status: "failed",
        startAgo: 1412,
        sessions: [
          session({ role: "fixer", startAgo: 1412, lenMin: 3, sessionId: "sess-c-fix3", cost: 0.74, inTok: 110000, outTok: 7600 }),
          session({ role: "playtester", model: SONNET, startAgo: 1407, lenMin: 4, sessionId: "sess-c-pt3", cost: 0.41, inTok: 54000, outTok: 2100, ok: false, error: "Playtester stopped before finishing." }),
        ],
        deploy: { loaded: true },
        commit: commit("c3f0b8d7", "e8a1c6f04b29"),
        playtestCommit: commit("6d9e2a14"),
        verdict: verdict({
          passed: false,
          finished: false,
          error: "The playtester did not finish.",
          checks: [
            vcheck("explode", "pass", "Arrow exploded on the target"),
            vcheck("blocks", "blocked", "Not reached"),
            vcheck("cooldown", "blocked", "Not reached"),
          ],
        }),
        failure: { kind: "playtest", summary: "The playtester did not finish." },
        context: { entireCheckpoints: 2, neatlogsTrace: false },
      }),
    ],
    feed: [
      { at: at(1436), attempt: 1, role: "benana", kind: "error", text: "Attempt 1 failed (build): The plugin did not compile." },
      { at: at(1412), attempt: 3, role: "benana", kind: "phase", phase: "fix", text: "Attempt 3: fixing what the playtester found" },
      { at: at(1407), attempt: 3, role: "benana", kind: "failure", text: "Attempt 3 failed (playtest): The playtester did not finish." },
      { at: at(1404), attempt: 3, role: "benana", kind: "phase", phase: "done", text: "PhantomArrows still fails after 3 attempts" },
    ],
  }),
  mod({
    id: "mod_a1",
    name: "LaunchSword",
    prompt: "A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown.",
    seed: true,
    status: "passed",
    phase: "done",
    ago: 2880,
    spec: {
      summary: "A golden sword that launches a struck mob into the sky with a particle burst and a 3 second cooldown.",
      behavior: ["Hitting a mob launches it upward", "Particles play at launch", "Hits within 3 seconds of a launch do nothing"],
    },
    testPlan: launchPlan,
    sessions: [session({ role: "spec", startAgo: 2880, lenMin: 2, sessionId: "sess-a-spec", cost: 0.42, inTok: 18200, outTok: 3100 })],
    attempts: [
      attempt({
        n: 1,
        role: "seeded",
        status: "failed",
        startAgo: 2870,
        sessions: [session({ role: "playtester", model: SONNET, startAgo: 2858, lenMin: 9, sessionId: "sess-a-pt1", cost: 0.61, inTok: 96000, outTok: 4200 })],
        deploy: { loaded: true },
        commit: commit("a91f0c2e", "3f9a1c0be712"),
        playtestCommit: commit("d4e7b19a", "8b2e6d10c4a7"),
        verdict: verdict({
          passed: false,
          checks: [
            vcheck("launch", "fail", "Mob rose 0.4 blocks, needs 6+"),
            vcheck("cooldown", "pass", "No launch during cooldown"),
            vcheck("particles", "pass", "Burst seen"),
            vcheck("no-errors", "pass", "Console clean"),
          ],
        }),
        failure: { kind: "playtest", summary: "launch: Mob rose 0.4 blocks, needs 6+" },
      }),
      attempt({
        n: 2,
        role: "fixer",
        status: "passed",
        startAgo: 2850,
        sessions: [
          session({ role: "fixer", startAgo: 2850, lenMin: 4, sessionId: "sess-a-fix2", cost: 0.88, inTok: 121000, outTok: 9800 }),
          session({ role: "playtester", model: SONNET, startAgo: 2845, lenMin: 7, sessionId: "sess-a-pt2", cost: 0.57, inTok: 88000, outTok: 3900 }),
        ],
        deploy: { loaded: true },
        commit: commit("77c0e5a3", "c15d90f2a8e3"),
        playtestCommit: commit("f2c6a88e", "6e0a4d7b91c2"),
        verdict: verdict({
          passed: true,
          checks: [
            vcheck("launch", "pass", "Mob rose 6.8 blocks"),
            vcheck("cooldown", "pass", "No launch during cooldown"),
            vcheck("particles", "pass", "Burst seen"),
            vcheck("no-errors", "pass", "Console clean"),
          ],
        }),
        lesson: "Set the launch velocity after the damage event resolves, or the server overwrites it.",
        context: {
          from: 1,
          entireCheckpoints: 2,
          neatlogsTrace: true,
          neatlogs: { state: "read", summary: { traceId: "tr_ss-a-pt1", status: "ERROR", finalized: true, spans: 9, toolCalls: 7, llmCalls: 2, tokens: 100200, costUsd: 0.61, durationMs: 540000, errors: [{ name: "measure_entity_height", type: "TOOL", durationMs: 48000 }], sequence: [{ name: "equip_item", n: 1, error: false }, { name: "attack_entity", n: 1, error: false }, { name: "measure_entity_height", n: 1, error: true }, { name: "report_check", n: 4, error: false }] } },
          checkpoints: [{ id: "3f9a1c0be712", message: "Attempt 1 seeded implementation" }, { id: "8b2e6d10c4a7", message: "Attempt 1 playtest evidence" }],
        },
        summary: "Moved the velocity change into a scheduled task after the damage event.",
      }),
    ],
    feed: [
      { at: at(2862), attempt: 1, role: "benana", kind: "phase", phase: "playtest", text: "Attempt 1: the AI player is testing LaunchSword in-game" },
      { at: at(2860), attempt: 1, role: "playtester", kind: "text", text: "I am measuring the launch height against the 6 block requirement." },
      { at: at(2859), attempt: 1, role: "playtester", kind: "tool", name: "attack_entity", summary: '{"id":"test-zombie"}' },
      { at: at(2858), attempt: 1, role: "playtester", kind: "tool", name: "measure_entity_height", summary: '{"id":"test-zombie"}' },
      { at: at(2857), attempt: 1, role: "playtester", kind: "result", isError: true, text: "Observed 0.4 blocks of vertical movement. Expected at least 6 blocks." },
      { at: at(2852), attempt: 1, role: "benana", kind: "failure", text: "Attempt 1 failed (playtest): launch: Mob rose 0.4 blocks, needs 6+" },
      { at: at(2851), attempt: 2, role: "benana", kind: "handoff", text: "Recorded playtest evidence handed to the fixer" },
      { at: at(2849), attempt: 2, role: "benana", kind: "phase", phase: "fix", text: "Attempt 2: fixing what the playtester found" },
      { at: at(2848), attempt: 2, role: "fixer", kind: "text", text: "The damage event restores the mob's velocity after the handler returns. I will schedule the launch for the next server tick, after damage resolution." },
      { at: at(2847), attempt: 2, role: "fixer", kind: "tool", name: "Read", summary: '{"file_path":"src/main/java/dev/benana/mod/LaunchSword.java"}' },
      { at: at(2846), attempt: 2, role: "fixer", kind: "result", text: "Found target.setVelocity inside EntityDamageByEntityEvent." },
      { at: at(2845), attempt: 2, role: "fixer", kind: "tool", name: "Edit", summary: '{"file_path":"src/main/java/dev/benana/mod/LaunchSword.java"}' },
      { at: at(2844), attempt: 2, role: "fixer", kind: "result", text: "Wrapped velocity and particle effects in Bukkit.getScheduler().runTask." },
      { at: at(2843), attempt: 2, role: "fixer", kind: "tool", name: "Bash", summary: '{"command":"mvn -q package"}' },
      { at: at(2842), attempt: 2, role: "fixer", kind: "result", text: "BUILD SUCCESS" },
      { at: at(2839), attempt: 2, role: "playtester", kind: "text", text: "Retesting the repaired launch behavior in-game." },
      { at: at(2838), attempt: 2, role: "playtester", kind: "tool", name: "measure_entity_height", summary: '{"id":"test-zombie"}' },
      { at: at(2837), attempt: 2, role: "playtester", kind: "result", text: "Observed 6.8 blocks of vertical movement. Cooldown, particles, and console checks also passed." },
      { at: at(2800), attempt: 2, role: "benana", kind: "phase", phase: "done", text: "LaunchSword passed after 2 attempts" },
    ],
  }),
].sort((a, b) => b.createdAt - a.createdAt);

const byId = (id) => {
  const m = MODS.find((item) => item.id === id);
  if (!m) throw new Error("Unknown mod.");
  return m;
};

const LESSONS = [
  {
    lesson: "Set the launch velocity after the damage event resolves, or the server overwrites it.",
    mod: "LaunchSword",
    at: at(2790),
  },
];

const GAME = { server: "running", bot: "online", version: "1.21.4", mock: true, viewerUrl: null, error: null };

const JAVA = {
  LaunchSword: `package dev.benana.mod;

import org.bukkit.Bukkit;
import org.bukkit.Particle;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.Vector;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

public class LaunchSword implements Listener {
    private static final long COOLDOWN_MS = 3000;
    private final JavaPlugin plugin;
    private final Map<UUID, Long> lastLaunch = new HashMap<>();

    public LaunchSword(JavaPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onHit(EntityDamageByEntityEvent event) {
        if (!(event.getDamager() instanceof Player player)) return;
        if (!(event.getEntity() instanceof LivingEntity target)) return;
        long now = System.currentTimeMillis();
        if (now - lastLaunch.getOrDefault(player.getUniqueId(), 0L) < COOLDOWN_MS) return;
        lastLaunch.put(player.getUniqueId(), now);
        Bukkit.getScheduler().runTask(plugin, () -> {
            target.setVelocity(new Vector(0, 1.2, 0));
            target.getWorld().spawnParticle(Particle.CLOUD, target.getLocation(), 40);
        });
    }
}
`,
};

const POM = `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.benana</groupId>
  <artifactId>sample-mod</artifactId>
  <version>1.0.0</version>
</project>
`;

const DIFFS = {
  "77c0e5a3": `Attempt 2 (fixer): fix from playtest evidence LaunchSword

Entire-Checkpoint: c15d90f2a8e3

diff --git a/src/main/java/dev/benana/mod/LaunchSword.java b/src/main/java/dev/benana/mod/LaunchSword.java
@@ -18,5 +18,7 @@ public void onHit(EntityDamageByEntityEvent event) {
         lastLaunch.put(player.getUniqueId(), now);
-        target.setVelocity(new Vector(0, 1.2, 0));
-        target.getWorld().spawnParticle(Particle.CLOUD, target.getLocation(), 40);
+        Bukkit.getScheduler().runTask(plugin, () -> {
+            target.setVelocity(new Vector(0, 1.2, 0));
+            target.getWorld().spawnParticle(Particle.CLOUD, target.getLocation(), 40);
+        });
`,
};

function checkpointsOf(m) {
  return m.attempts.flatMap((a) => {
    const sessionId = a.sessions.find((s) => s.role === "builder" || s.role === "fixer")?.sessionId ?? null;
    return [
      ["commit", a.commit],
      ["playtest", a.playtestCommit],
    ]
      .filter(([, c]) => c?.checkpoint)
      .map(([kind, c]) => ({
        checkpoint_id: c.checkpoint,
        message: `Attempt ${a.n} (${a.role}) ${kind}`,
        session_id: sessionId,
        agent: "claude",
      }));
  });
}

const javaPath = (m) => `src/main/java/dev/benana/mod/${m.name}.java`;
const iso = (t) => new Date(t).toISOString();

function commitsOf(m) {
  const items = m.attempts.flatMap((a) => [
    a.commit?.sha && {
      sha: a.commit.sha,
      subject: a.role === "seeded" ? `Attempt ${a.n} seeded implementation` : `Attempt ${a.n} (${a.role}): ${a.role === "builder" ? "implement" : "fix from playtest evidence"} ${m.name}`,
      date: iso(a.startedAt + 2 * MIN),
      checkpoint: a.commit.checkpoint,
      files: [{ path: javaPath(m), additions: a.role === "builder" ? 84 : 9, deletions: a.role === "builder" ? 3 : 4 }, ...(a.role === "builder" ? [{ path: "src/main/resources/plugin.yml", additions: 6, deletions: 1 }] : [])],
    },
    a.playtestCommit?.sha && {
      sha: a.playtestCommit.sha,
      subject: `Playtest attempt ${a.n}: ${a.verdict?.passed ? "PASS" : "FAIL"} (${(a.verdict?.checks || []).map((c) => `${c.id}=${c.status}`).join(", ")})`,
      date: iso(a.startedAt + 6 * MIN),
      checkpoint: a.playtestCommit.checkpoint,
      files: [{ path: `playtest/attempt-${a.n}/verdict.json`, additions: 38, deletions: 0 }],
    },
  ].filter(Boolean));
  items.unshift({ sha: `${m.id.slice(-4)}0a1b2c`, subject: `Scaffold ${m.name} from the Benana Paper template`, date: iso(m.createdAt), checkpoint: null, files: [{ path: "pom.xml", additions: 61, deletions: 0 }, { path: "src/main/resources/plugin.yml", additions: 4, deletions: 0 }, { path: javaPath(m), additions: 12, deletions: 0 }] });
  return items.reverse().map((c) => ({ ...c, author: "Benana Mod Studio", additions: c.files.reduce((n, f) => n + f.additions, 0), deletions: c.files.reduce((n, f) => n + f.deletions, 0) }));
}

function checkpointOf(m, id) {
  const a = m.attempts.find((x) => x.commit?.checkpoint === id || x.playtestCommit?.checkpoint === id);
  if (!a) return { ok: false, error: "Unknown checkpoint." };
  const playtest = a.playtestCommit?.checkpoint === id;
  const s = a.sessions.find((x) => (playtest ? x.role === "playtester" : x.role !== "playtester")) || a.sessions[0];
  const files = playtest ? [`playtest/attempt-${a.n}/verdict.json`] : [javaPath(m), ...(a.role === "builder" ? ["src/main/resources/plugin.yml"] : [])];
  const u = s?.usage || {};
  return {
    ok: true,
    item: {
      checkpoint_id: id,
      strategy: "manual-commit",
      branch: "main",
      checkpoints_count: 1,
      files_touched: files,
      session_count: 1,
      sessions: [{
        index: 0,
        session_id: s?.sessionId,
        agent: "Claude Code",
        model: s?.model,
        created_at: iso(s?.startedAt || a.startedAt),
        files_touched: files,
        token_usage: { input_tokens: Math.round((u.inputTokens || 0) * 0.02), cache_creation_tokens: Math.round((u.inputTokens || 0) * 0.18), cache_read_tokens: u.cacheReadInputTokens || 0, output_tokens: u.outputTokens || 0, api_call_count: playtest ? 14 : 7 },
      }],
      tasks: [],
    },
  };
}

function fileText(m, rel) {
  if (rel.endsWith(".java")) return JAVA[m.name] || `package dev.benana.mod;\n\npublic class ${m.name} {\n}\n`;
  if (rel === "pom.xml") return POM;
  if (rel === "src/main/resources/plugin.yml")
    return `name: ${m.name}\nversion: 1.0.0\nmain: dev.benana.mod.${m.name}\napi-version: "1.21"\n`;
  if (rel === "playtest/test-plan.json") return JSON.stringify(m.testPlan, null, 2);
  return "";
}

// LaunchSword's sessions tell the recovery story: the failed measurement, the fix, then the passing retest.
// The handoff summary on its attempt 2 mirrors what this builds for sess-a-pt1.
const playtestSteps = (height) => [
  ["LLM", "agent turn"],
  ["TOOL", "equip_item"],
  ["TOOL", "attack_entity"],
  ["TOOL", "measure_entity_height", height < 6 ? `Observed ${height} blocks of vertical movement. Expected at least 6 blocks.` : null],
  ["TOOL", "report_check"],
  ["TOOL", "report_check"],
  ["TOOL", "report_check"],
  ["TOOL", "report_check"],
  ["LLM", "agent turn"],
];
const TRACE_STEPS = {
  "sess-a-pt1": playtestSteps(0.4),
  "sess-a-fix2": [["LLM", "agent turn"], ["TOOL", "Read"], ["TOOL", "Edit"], ["TOOL", "Bash"], ["LLM", "agent turn"]],
  "sess-a-pt2": playtestSteps(6.8),
};
const genericSteps = (sessionId) => [
  ["LLM", "agent turn"],
  ["TOOL", "Edit"],
  ...(sessionId.includes("pt") ? [["TOOL", "track_entity", "Entity not found in the test world"]] : []),
];

function sampleTrace(sessionId) {
  const s = MODS.flatMap((m) => [...m.sessions, ...m.attempts.flatMap((a) => a.sessions)]).find((x) => x.sessionId === sessionId);
  const story = TRACE_STEPS[sessionId];
  const steps = story || genericSteps(sessionId);
  const start = s?.startedAt ?? NOW - 540000;
  const durationMs = story && s?.endedAt ? s.endedAt - start : 4200;
  const slot = durationMs / steps.length;
  const spans = steps.map(([spanType, spanName, failure], i) => ({
    spanId: `sp_${sessionId}_${i + 1}`,
    spanName,
    spanType,
    status: failure ? "ERROR" : "OK",
    startedAt: new Date(start + i * slot).toISOString(),
    endedAt: new Date(start + (i + 0.8) * slot).toISOString(),
    durationMs: Math.round(slot * 0.8),
    ...(failure ? { failure } : {}),
  }));
  const tools = spans.filter((sp) => sp.spanType === "TOOL");
  const sequence = [];
  for (const sp of tools) {
    const error = sp.status === "ERROR";
    const last = sequence.at(-1);
    if (last?.name === sp.spanName && last.error === error) last.n++;
    else sequence.push({ name: sp.spanName, n: 1, error });
  }
  const errors = tools.filter((sp) => sp.status === "ERROR").map((sp) => ({ name: sp.spanName, type: "TOOL", durationMs: sp.durationMs }));
  const traceId = `tr_${sessionId.slice(-8)}`;
  return {
    traceId,
    traceName: "agent.session",
    durationMs,
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + durationMs).toISOString(),
    spans,
    summary: {
      traceId,
      status: errors.length ? "ERROR" : "OK",
      finalized: true,
      spans: spans.length,
      toolCalls: tools.length,
      llmCalls: spans.length - tools.length,
      tokens: story && s ? s.usage.inputTokens + s.usage.outputTokens : 12400,
      costUsd: story && s ? s.usage.costUsd : 0.14,
      durationMs,
      errors,
      sequence,
    },
  };
}

function evidenceFor({ sessionId = "" }) {
  const matched = Boolean(TRACE_STEPS[sessionId]) || /[02468ace]$/.test(sessionId);
  return {
    source: "neatlogs",
    configured: true,
    matched,
    matchReason: matched ? `Linked by session ${sessionId}` : "No trace yet for this session.",
    traces: matched ? [sampleTrace(sessionId)] : [],
  };
}

// Bench preview: the real task, with two sample runs (a baseline, then a run after the coach's lessons).
const BENCH_CHECKS = stormGolem.gold.checks.map(({ id, title, capability }) => ({ id, title, capability }));
const benchRun = (n, failing, lessonsBefore, minutesAgo) => {
  const checks = [...BENCH_CHECKS, { id: "assets", title: "Ships at least 1 generated item texture wired into the code", capability: "asset" }].map((c) => ({
    ...c,
    status: failing[c.id] ? "fail" : "pass",
    observed: failing[c.id] || "[sample] matched",
    by: c.id === "assets" ? "benana" : "grader",
  }));
  const passed = checks.filter((c) => c.status === "pass").length;
  return {
    id: `sample_bench_${n}`, taskId: stormGolem.id, modId: MODS[0].id, modName: "StormGolem", at: NOW - minutesAgo * 60000,
    durationMs: 14 * 60000, attempts: n === 1 ? 3 : 1, selfPassed: n !== 1, lessonsBefore, costUsd: n === 1 ? 4.1 : 2.3,
    checks, passed, total: checks.length, score: passed / checks.length, lessonsLearned: [],
  };
};
const BENCH_RESULTS = [
  benchRun(1, {
    "slam-range": "[sample] launched at 9.8 blocks: the slam used a 10-block radius",
    "phase-two-faster": "[sample] launches 100 ticks apart; the slam timer never changed in phase two",
    "core-drop": "[sample] Storm Core had no itemModel",
    assets: "[sample] no textures in pack/",
  }, 3, 90),
  benchRun(2, {}, 6, 20),
];

const CFO_BOOKS = {
  at: NOW,
  currency: "USD",
  source: "Sample data stored in Benana's browser demo. These figures are not your costs or revenue.",
  totals: {
    spend: 8.56, mods: 4, passed: 3, failed: 1, costPerVerifiedMod: 2.8533,
    medianPassedMod: 1.84, rework: 3.21, reworkShare: 0.375, failedSpend: 3.26,
    firstTryRate: 0.5, remixes: 0, remixMedianCost: null, scratchMedianCost: 1.84,
    costedSessions: 14, uncostedSessions: 0,
    byRole: { spec: 1.55, builder: 3.47, playtester: 2.08, fixer: 1.46 },
    byModel: { opus: 6.48, sonnet: 2.08 },
  },
  mods: [
    { id: "sample-cfo-1", name: "LaunchSword", status: "passed", remix: false, turns: 1, attempts: 2, sessions: 5, cost: 2.41, costComplete: true, rework: 0.86, breakEven: [{ price: 0.99, sales: 3 }, { price: 1.99, sales: 2 }, { price: 4.99, sales: 1 }] },
    { id: "sample-cfo-2", name: "StormGolem", status: "passed", remix: false, turns: 1, attempts: 1, sessions: 3, cost: 1.84, costComplete: true, rework: 0, breakEven: [{ price: 0.99, sales: 2 }, { price: 1.99, sales: 1 }, { price: 4.99, sales: 1 }] },
    { id: "sample-cfo-3", name: "TrailBlazer", status: "passed", remix: false, turns: 1, attempts: 1, sessions: 3, cost: 1.05, costComplete: true, rework: 0, breakEven: [{ price: 0.99, sales: 2 }, { price: 1.99, sales: 1 }, { price: 4.99, sales: 1 }] },
    { id: "sample-cfo-4", name: "PhantomArrows", status: "failed", remix: false, turns: 1, attempts: 3, sessions: 3, cost: 3.26, costComplete: true, rework: 2.35, breakEven: [{ price: 0.99, sales: 4 }, { price: 1.99, sales: 2 }, { price: 4.99, sales: 1 }] },
  ],
};

function sampleQuote(prompt) {
  const basis = /sword|weapon|lightning/i.test(prompt) ? CFO_BOOKS.mods.slice(0, 2) : CFO_BOOKS.mods.filter((m) => m.status === "passed");
  const costs = basis.map((m) => m.cost);
  return {
    ok: true, expected: costs.reduce((n, x) => n + x, 0) / costs.length,
    low: Math.min(...costs), high: Math.max(...costs), fixChance: 0.5, costPerFix: 1.07,
    matched: basis.length < 3,
    basis: basis.map((m) => ({ name: m.name, cost: m.cost, attempts: m.attempts, status: m.status, shared: [] })),
  };
}

export const studioSample = {
  "cfo:books": () => CFO_BOOKS,
  "cfo:quote": ({ prompt }) => sampleQuote(prompt),
  "cfo:export": () => { throw new Error("CSV export runs in the desktop app. This preview uses local sample finance data only."); },
  "cfo:status": { added: false, state: "sample", detail: "The browser demo uses labelled local sample data." },
  "cfo:history": [],
  "cfo:active": null,
  "cfo:ask": () => { throw new Error("cfo.ai questions run in the desktop app. This preview uses local sample finance data only."); },
  "cfo:stop": false,
  "studio:bench-tasks": () => [{ ...stormGolem, gold: undefined, checks: BENCH_CHECKS }],
  "studio:bench-results": () => BENCH_RESULTS,
  "studio:bench-run": () => { throw new Error("Benchmarks run in the desktop app. This preview shows sample runs."); },
  "studio:list": () => MODS.map(brief),
  "studio:get": ({ id }) => ({ ...brief(byId(id)), feed: byId(id).feed }),
  "studio:stop": () => false,
  "studio:lessons": () => LESSONS,
  "studio:partners": { neatlogs: { configured: true, ok: true }, entire: { installed: true, version: "sample" } },
  "studio:evidence": evidenceFor,
  "studio:checkpoints": ({ id }) => ({ ok: true, items: checkpointsOf(byId(id)) }),
  "studio:checkpoint": ({ id, checkpoint }) => checkpointOf(byId(id), checkpoint),
  "studio:commits": ({ id }) => ({ ok: true, branch: "main", items: commitsOf(byId(id)) }),
  "studio:files": ({ id }) => {
    const m = byId(id);
    return ["pom.xml", "src/main/resources/plugin.yml", `src/main/java/dev/benana/mod/${m.name}.java`, "playtest/test-plan.json"];
  },
  "studio:file": ({ id, path }) => fileText(byId(id), path),
  "studio:diff": ({ sha }) =>
    DIFFS[sha] ||
    `Sample commit ${sha}\n\ndiff --git a/playtest/test-plan.json b/playtest/test-plan.json\n@@ -1,3 +1,4 @@\n {\n+  "checks": [],\n   "version": 1\n }\n`,
  "game:status": GAME,
  "game:logs": () => SERVER_BACKLOG,
  "game:start": GAME,
  "game:stop": GAME,
  "game:demo": { demo: false },
};

const clock = (t) => new Date(t).toTimeString().slice(0, 8);
const paper = (t, level, text) => ({ line: `[${clock(t)} ${level}]: ${text}`, level: level === "WARN" ? "warn" : level === "ERROR" ? "error" : "info", at: t });

const SERVER_BACKLOG = [
  [300, "INFO", "Starting minecraft server version 1.21.4"],
  [296, "INFO", "Preparing level \"studio-flat64\""],
  [290, "INFO", "Done (6.214s)! For help, type \"help\""],
  [120, "INFO", "Benana joined the game"],
  [118, "INFO", "[TrailBlazer] Enabling TrailBlazer v1.0.0"],
  [117, "INFO", "[TrailBlazer] Listening for sneak movement"],
  [96, "INFO", "Benana issued server command: /give Benana feather"],
  [90, "INFO", "Benana issued server command: /tp Benana 0 64 0"],
  [60, "WARN", "Can't keep up! Is the server overloaded? Running 2104ms or 42 ticks behind"],
  [44, "INFO", "[TrailBlazer] Trail started for Benana"],
  [20, "INFO", "[TrailBlazer] Trail cleared for Benana after 40 ticks"],
].map(([sec, level, text]) => paper(NOW - sec * 1000, level, text));

const LIVE_LINES = [
  ["INFO", "[TrailBlazer] Trail started for Benana"],
  ["INFO", "Benana moved too quickly! 0.42,0.0,0.12"],
  ["INFO", "[TrailBlazer] Spawned 14 END_ROD particles"],
  ["INFO", "[Benana] report_check trail: pass"],
  ["INFO", "[TrailBlazer] Trail cleared for Benana after 40 ticks"],
  ["WARN", "Benana was kicked for floating too long! (ignored in test mode)"],
  ["INFO", "Benana issued server command: /tp Benana 0 64 0"],
];

const LIVE_ACTIONS = [
  { tool: "move_to", args: { x: 6, z: 0, sneak: true }, result: { reached: true } },
  { tool: "track_entity", args: { entityId: "self", ticks: 40 }, result: { name: "Benana", maxUpwardVelocity: 0, maxHeightGain: 0 } },
  { tool: "wait_ticks", args: { ticks: 40 }, result: {} },
  { tool: "nearby_entities", args: {}, result: [{ name: "end_rod", id: 412 }, { name: "end_rod", id: 413 }] },
];

let demoStarted = false;
export function startStudioDemo(emit) {
  if (demoStarted) return;
  demoStarted = true;
  let i = 0;
  setInterval(() => {
    const [level, text] = LIVE_LINES[i % LIVE_LINES.length];
    emit("game:log", paper(Date.now(), level, text));
    if (i % 2 === 0) {
      const a = LIVE_ACTIONS[(i / 2) % LIVE_ACTIONS.length];
      const started = Date.now();
      emit("game:action", { ...a, at: started });
      setTimeout(() => emit("game:action", { ...a, at: started, done: Date.now() }), 600);
    }
    i += 1;
  }, 1800);
}

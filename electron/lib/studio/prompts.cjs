// Prompts for the spec, builder, reviser, fixer and coach agents. The playtester prompt lives with the game runtime.

const TESTABLE = `The playtester controls a real player bot ("@bot") on a local Paper 1.21.4 superflat server with these tools:
game_setup(console commands run as the bot; ^ and ~ are relative to it), reset_arena (flat arena, no mobs, empty inventory), bot_state,
nearby_entities (id, type, position, velocity, health), attack_sequence(entityIds, intervalTicks, trackTicks) (back-to-back hits in one call, for cooldowns),
equip(item), look_at, move_to, attack(entityId, trackTicks), use_item(entityId?, trackTicks),
shoot(entityId | entityIds | position, item?, chargeTicks?) (aims and fires a bow, crossbow, trident or throwable; entityIds fires several shots back to back in one call;
reports each projectile, every explosion with its position, ammo used, chat, and health before/after, deaths and max velocity of every living entity nearby),
track_entity(entityId, ticks) (per-tick position and velocity with maxUpwardVelocity and maxHeightGain), wait_ticks, chat (including /commands), read_chat
(chat, action bar and titles), server_log (console, including plugin exceptions and the plugin's own getLogger() lines).
The bot itself can be the test subject: track_self(ticks), use_item(position | entityId, trackSelf) and move(forward/jump/sprint/sneak, ticks) record
the BOT's max upward velocity, height gain, launches, distance, health and effects. place_block / dig_block act as a player (they fire block
events), boss_bars reads boss bars, and bot_state lists effects plus each item's customName, lore and itemModel (its resource-pack model).`;

// Everything the user has asked for before a repository exists. A build that died early is retried with the new message folded in.
const requestOf = (mod) => (mod.turns || []).map((t) => t.prompt).join('\n\nThe user then added:\n') || mod.prompt;

const planRules = (maxChecks) => `Rules for the test plan:
- 2 to ${maxChecks} checks. Each check targets one behavior and has an "expect" with a measurable threshold (velocity, height, count, chat text, health).
- "setup" holds console commands without a leading slash. Use @bot for the bot. Give the bot the items it needs.
- Summon mobs with {PersistenceRequired:1b}. Never use NoAI:1b (NoAI mobs ignore velocity and knockback). Prefer husks to zombies (zombies burn in daylight).
- Summon melee targets 2-3 blocks in front of the bot, e.g. "summon husk ^ ^ ^3 {PersistenceRequired:1b}". Summon ranged targets
  (bows, tridents, snowballs) 8-12 blocks away, e.g. "summon husk ^ ^ ^10 {PersistenceRequired:1b}", and use the shoot tool, never use_item.
- Explosions hit everything nearby. Space mobs that must stay unharmed at least 8 blocks from any blast, and start checks that need a clean
  world (fresh mobs, no cooldown left over) with reset_arena followed by their own setup.
- Every check must name the tool that produces its measurement. Prefer direct evidence (an explosion position, a health number, a chat line,
  a server_log line) over indirect signs such as a mob disappearing.
- Timing-sensitive checks (cooldowns) must happen inside ONE tool call: attack_sequence for melee, shoot with entityIds for ranged. Separate
  tool calls are several real seconds apart.
- Include a check for any limit the user mentioned (cooldowns, permissions, item requirements) and one negative check where it is cheap (for example, a different item does nothing).
- Velocity is in blocks per tick. A normal sword hit's knockback gives about 0.4 upward; a strong launch is above 1.0. A normal jump
  is 0.42 upward and about 1.25 blocks high; Jump Boost I reaches about 1.8.
- When the mod moves, launches or buffs the PLAYER, measure the bot with track_self / use_item trackSelf / move, never with track_entity.
- Mobs walk around and ruin distance checks. Freeze a target in place without breaking knockback with
  "effect give @e[type=husk,distance=..16] slowness infinite 255 true" after summoning it.
- The bot has Resistance V. For a health or fall-damage check, put "effect clear @bot resistance" in that check's steps.
- If the mod adds a custom item, add a check that bot_state shows it with its customName and an itemModel in the "benana" namespace.`;

const PLAN_SHAPE = `Respond with ONLY a JSON object, no prose:
{
  "modName": "PascalCase plugin name, letters only, max 24 chars",
  "summary": "one sentence",
  "behavior": ["precise behavior bullet", "..."],
  "assets": [{ "name": "snake_case item id", "look": "what its texture should show" }],
  "testPlan": {
    "version": 1,
    "modName": "same as above",
    "summary": "same as above",
    "setup": ["..."],
    "checks": [{ "id": "kebab-case", "title": "...", "steps": "...", "expect": "..." }]
  }
}`;

function spec(prompt) {
  return `You are the spec agent for Benana Mod Studio. A user described a Minecraft mod. Turn it into a Paper plugin spec and a test plan
that an AI playtester can execute in-game and judge with measurements.

User's description:
"""${prompt}"""

${TESTABLE}

${planRules(4)}
- List an asset for every custom item the mod adds (an empty array if it adds none). The builder draws them.

${PLAN_SHAPE}`;
}

// A follow-up message in the same chat: the plugin already exists, so the spec and test plan are edited, not rewritten.
function specRevision({ mod, request }) {
  return `You are the spec agent for Benana Mod Studio. The user is iterating on a Paper plugin that already exists and asked for a change.
Update its spec and in-game test plan so they describe the plugin as it must behave AFTER the change.

Plugin: ${mod.name}: ${mod.spec.summary}
Current behavior:
${mod.spec.behavior.map((b) => `- ${b}`).join('\n')}

Current test plan (checks):
${JSON.stringify(mod.testPlan.checks, null, 2)}

The user's change request:
"""${request}"""

${TESTABLE}

${planRules(5)}
- Keep "modName" exactly "${mod.name}"; the repository, jar and main class already use it.
- Keep every current check the change does not affect, with the same id. Rewrite the checks it does affect, add checks for the new
  behavior, and drop checks the change makes obsolete.
- "behavior" and "summary" describe the whole plugin after the change, not just the change.
- "assets" lists every custom item the plugin has after the change, keeping existing names.

${PLAN_SHAPE}`;
}

const assetList = (mod) => (mod.spec.assets?.length
  ? `\nAssets to draw (one texture per custom item; add more if the mod needs them):\n${mod.spec.assets.map((a) => `- ${a.name}: ${a.look}`).join('\n')}\n`
  : '');

const lessonList = (lessons) => (lessons.length ? `\nLessons from earlier mods built in Benana (apply them):\n${lessons.map((l) => `- ${l}`).join('\n')}\n` : '');

// The steps every builder session follows, for a new plugin or a change.
const buildSteps = (mod, verb) => `Work steps:
1. Read CLAUDE.md first: it has the asset workflow and a Paper 1.21.4 cookbook of renamed APIs and common traps.
2. For each check in the test plan, decide which code path makes it pass and which log line proves it. ${verb} the behavior with the
   Paper API. Log every key action and decision with getLogger().info (for example "slam launched 1 player", "cooldown 3.2s remaining",
   "phase 2 at 96.0/200 health"); the playtester reads these lines as evidence.
3. Give every custom item its own art: write art/<name>.json, run \`node tools/texture.cjs\`, Read preview/<name>.png to check that it
   looks right, and point the item at it with setItemModel(new NamespacedKey("benana", "<name>")).
4. Run \`mvn -q package\` and fix every compile error until target/${mod.name}.jar builds. If you are unsure of an API name, check it
   with javap (see CLAUDE.md) instead of guessing.
5. Do not commit.`;

function builder({ mod, lessons }) {
  return `You are the builder agent for Benana Mod Studio. Implement this Paper plugin in the current repository.

Mod: ${mod.name}: ${mod.spec.summary}
User's description: """${requestOf(mod)}"""

Behavior:
${mod.spec.behavior.map((b) => `- ${b}`).join('\n')}

The in-game playtester will run this test plan after you finish (also in playtest/test-plan.json):
${JSON.stringify(mod.testPlan.checks, null, 2)}

Use the code graph before broad reading: \`entire graph search --query "<what you need>" --repo .\`, then \`entire graph neighbors\` or \`entire graph impact --symbol <name> --repo .\` before changing a method.
The main class dev.benana.mod.${mod.name} already exists as a stub.
${assetList(mod)}${lessonList(lessons)}
${buildSteps(mod, 'Implement')} Finish with a short summary of what you implemented and the assets you drew.`;
}

// A follow-up message in the same chat: change the existing plugin in place.
function reviser({ mod, attempt, request, lessons }) {
  const last = mod.attempts.filter((a) => a.n < attempt.n).at(-1);
  const standing = last?.failure
    ? `The previous version did not pass (${last.failure.kind}): ${last.failure.summary}\n`
    : last?.status === 'passed' ? 'The previous version passed every check.\n' : '';
  return `You are the builder agent for Benana Mod Studio. The ${mod.name} Paper plugin already exists in the current repository.
The user asked for a change. Edit the existing code to make it; do not start over.

Mod: ${mod.name}: ${mod.spec.summary}
The user's change request: """${request}"""
${standing}
Behavior after the change:
${mod.spec.behavior.map((b) => `- ${b}`).join('\n')}

The in-game playtester will run this updated test plan after you finish (also in playtest/test-plan.json):
${JSON.stringify(mod.testPlan.checks, null, 2)}

Use the code graph before broad reading: \`entire graph search --query "<what you need>" --repo .\`, then \`entire graph neighbors\` or \`entire graph impact --symbol <name> --repo .\` before changing a method.
The plugin source is under src/main/java/dev/benana/mod/ and its art under art/ and pack/; \`git log\` shows how it got here.
Read the current implementation before changing it, and keep every behavior the user did not ask to change.
${assetList(mod)}${lessonList(lessons)}
${buildSteps(mod, 'Change')} Finish with a short summary of what you changed.`;
}

function fixer({ mod, attempt, previous, context }) {
  const failed = (previous.verdict?.checks || []).filter((c) => c.status !== 'pass');
  const evidence = previous.failure?.kind === 'build'
    ? `The build failed. Maven output (tail):\n${previous.build?.log?.slice(-4000) || '(none)'}`
    : previous.failure?.kind === 'assets'
      ? `The plugin compiled, but its resource pack is broken, so its items would render as missing textures. Problems:\n${(previous.build?.assets?.errors || []).join('\n').slice(0, 4000)}\nRedraw or rewire them with tools/texture.cjs (see CLAUDE.md).`
    : previous.failure?.kind === 'load'
      ? `The plugin did not load on the server. Errors:\n${(previous.deploy?.errors || []).join('\n').slice(0, 4000)}`
      : `The in-game playtester reported:\n${JSON.stringify({ summary: previous.verdict?.summary, failedChecks: failed, serverErrors: previous.verdict?.serverErrors }, null, 2).slice(0, 8000)}`;
  return `You are the fixer agent for Benana Mod Studio. Attempt ${attempt.n - 1} of the ${mod.name} plugin failed. Fix it.

Mod: ${mod.name}: ${mod.spec.summary}
Behavior:
${mod.spec.behavior.map((b) => `- ${b}`).join('\n')}

Use the code graph before broad reading: \`entire graph search --query "<what you need>" --repo .\`, then \`entire graph neighbors\` or \`entire graph impact --symbol <name> --repo .\` before changing a method.

Full test plan: playtest/test-plan.json. Previous verdicts: playtest/attempt-*/verdict.json.

${evidence}

Repository history (Entire checkpoints link each commit to the agent session that produced it):
${context.history || '(none)'}
${context.checkpoints ? `\nEntire checkpoints:\n${context.checkpoints}` : ''}
${context.trace ? `\nNeatlogs trace of the failed playtest session (the playtester's tool calls in order; "(error)" marks a call that failed):\n${context.trace}` : ''}

Steps:
1. Find the root cause from the evidence; the playtester's measurements are ground truth, and its suspected cause is only a guess.
   CLAUDE.md lists common Paper 1.21.4 traps; check whether one of them explains it.
2. Make the smallest change that fixes it. Run \`mvn -q package\` until it builds.
3. Do not commit. End your reply with exactly one line:
LESSON: <one sentence a future builder should know to avoid this bug>`;
}

// After a benchmark run: turns failed hidden checks into lessons for future builders. It reads the code to find root causes, and
// writes lessons about Paper technique rather than about the benchmark's checks.
function coach({ task, mod, gold, lessons }) {
  const failed = gold.checks.filter((c) => c.status !== 'pass');
  return `You are the coach for Benana Mod Studio's builder agents. A builder just attempted a benchmark mod, and Benana then ran
hidden in-game checks the builder never saw. Turn the failures into short lessons that help future builders on ANY mod.

Benchmark: ${task.title}
The user's request: """${task.prompt}"""
Plugin: ${mod.name}. The repository is the current directory; read src/main/java to see what was built.

Hidden checks that did not pass:
${JSON.stringify(failed.map((c) => ({ id: c.id, expected: c.expected, observed: c.observed, suspectedCause: c.suspectedCause })), null, 2).slice(0, 8000)}

Lessons builders already have:
${lessons.length ? lessons.map((l) => `- ${l}`).join('\n') : '(none)'}

Find the root cause of each failure in the code. A check can also fail because the builder skipped part of the request; say so if that
is the cause. Then write 1 to 3 NEW lessons. Each is one sentence about Paper plugin technique or about building everything the user
literally asked for, general enough to apply to other mods, and not a duplicate of an existing lesson. Do not mention the benchmark,
its checks, or this plugin's names. Do not edit files.
End your reply with the lessons, one per line, each starting with "LESSON: ".`;
}

module.exports = { requestOf, spec, specRevision, builder, reviser, fixer, coach };

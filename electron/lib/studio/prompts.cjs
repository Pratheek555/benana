// Prompts for the spec, builder, and fixer agents. The playtester prompt lives with the game runtime.

const TESTABLE = `The playtester controls a real player bot ("@bot") on a local Paper 1.21.4 superflat server with these tools:
game_setup(console commands run as the bot; ^ and ~ are relative to it), bot_state, nearby_entities (id, type, position, velocity), attack_sequence(entityIds, intervalTicks, trackTicks) (back-to-back hits in one call, for cooldowns),
equip(item), look_at, move_to, attack(entityId, trackTicks), use_item(entityId?, trackTicks), track_entity(entityId, ticks)
(per-tick position and velocity with maxUpwardVelocity and maxHeightGain), wait_ticks, chat (including /commands), read_chat,
server_log (console, including plugin exceptions).`;

function spec(prompt) {
  return `You are the spec agent for Benana Mod Studio. A user described a Minecraft mod. Turn it into a Paper plugin spec and a test plan
that an AI playtester can execute in-game and judge with measurements.

User's description:
"""${prompt}"""

${TESTABLE}

Rules for the test plan:
- 2 to 4 checks. Each check targets one behavior and has an "expect" with a measurable threshold (velocity, height, count, chat text, health).
- "setup" holds console commands without a leading slash. Use @bot for the bot. Give the bot the items it needs.
- Summon mobs with {PersistenceRequired:1b}. Never use NoAI:1b (NoAI mobs ignore velocity and knockback). Prefer husks to zombies (zombies burn in daylight).
- Summon mobs 2-3 blocks in front of the bot, e.g. "summon husk ^ ^ ^3 {PersistenceRequired:1b}".
- Include a check for any limit the user mentioned (cooldowns, permissions, item requirements) and one negative check where it is cheap (for example, a different item does nothing).
- Velocity is in blocks per tick. A normal sword hit's knockback gives about 0.4 upward; a strong launch is above 1.0.

Respond with ONLY a JSON object, no prose:
{
  "modName": "PascalCase plugin name, letters only, max 24 chars",
  "summary": "one sentence",
  "behavior": ["precise behavior bullet", "..."],
  "testPlan": {
    "version": 1,
    "modName": "same as above",
    "summary": "same as above",
    "setup": ["..."],
    "checks": [{ "id": "kebab-case", "title": "...", "steps": "...", "expect": "..." }]
  }
}`;
}

function builder({ mod, lessons }) {
  return `You are the builder agent for Benana Mod Studio. Implement this Paper plugin in the current repository.

Mod: ${mod.name}: ${mod.spec.summary}
User's description: """${mod.prompt}"""

Behavior:
${mod.spec.behavior.map((b) => `- ${b}`).join('\n')}

The in-game playtester will run this test plan after you finish (also in playtest/test-plan.json):
${JSON.stringify(mod.testPlan.checks, null, 2)}

Read CLAUDE.md for the repository conventions. The main class dev.benana.mod.${mod.name} already exists as a stub.
${lessons.length ? `\nLessons from earlier mods built in Benana (apply them):\n${lessons.map((l) => `- ${l}`).join('\n')}\n` : ''}
Work steps:
1. Implement the behavior. Keep it to the Paper API. Log key actions with getLogger().info.
2. Run \`mvn -q package\` and fix every compile error until target/${mod.name}.jar builds.
3. Do not commit. Finish with a short summary of what you implemented.`;
}

function fixer({ mod, attempt, previous, context }) {
  const failed = (previous.verdict?.checks || []).filter((c) => c.status !== 'pass');
  const evidence = previous.failure?.kind === 'build'
    ? `The build failed. Maven output (tail):\n${previous.build?.log?.slice(-4000) || '(none)'}`
    : previous.failure?.kind === 'load'
      ? `The plugin did not load on the server. Errors:\n${(previous.deploy?.errors || []).join('\n').slice(0, 4000)}`
      : `The in-game playtester reported:\n${JSON.stringify({ summary: previous.verdict?.summary, failedChecks: failed, serverErrors: previous.verdict?.serverErrors }, null, 2).slice(0, 8000)}`;
  return `You are the fixer agent for Benana Mod Studio. Attempt ${attempt.n - 1} of the ${mod.name} plugin failed. Fix it.

Mod: ${mod.name}: ${mod.spec.summary}
Behavior:
${mod.spec.behavior.map((b) => `- ${b}`).join('\n')}

Full test plan: playtest/test-plan.json. Previous verdicts: playtest/attempt-*/verdict.json.

${evidence}

Repository history (Entire checkpoints link each commit to the agent session that produced it):
${context.history || '(none)'}
${context.checkpoints ? `\nEntire checkpoints:\n${context.checkpoints}` : ''}
${context.trace ? `\nNeatlogs trace of the failed playtest session:\n${context.trace}` : ''}

Steps:
1. Find the root cause from the evidence; the playtester's measurements are ground truth, and its suspected cause is only a guess.
2. Make the smallest change that fixes it. Run \`mvn -q package\` until it builds.
3. Do not commit. End your reply with exactly one line:
LESSON: <one sentence a future builder should know to avoid this bug>`;
}

module.exports = { spec, builder, fixer };

# Track interfaces

Track A (game) and Track B (studio) depend only on what this file defines. Change it only with both people agreeing, and update the mock in `electron/lib/game/index.cjs` in the same commit.

## Test plan: `test-plan.json`

The spec agent (B) writes it and the playtester (A) reads it.

```json
{
  "version": 1,
  "modName": "LaunchSword",
  "summary": "Hitting a mob with a golden sword launches it upward with particles. 3 second cooldown per player.",
  "setup": [
    "time set day",
    "give @bot golden_sword",
    "summon husk ^ ^ ^3 {PersistenceRequired:1b}"
  ],
  "checks": [
    {
      "id": "launch-on-hit",
      "title": "Hitting a mob with a golden sword launches it upward",
      "steps": "Equip golden_sword and attack the nearest zombie once.",
      "expect": "The zombie's upward velocity exceeds 0.8 blocks/tick within 5 ticks of the hit."
    },
    {
      "id": "cooldown",
      "title": "A second hit within 3 seconds does not launch",
      "steps": "Summon another zombie, hit it within 1 second of the first launch.",
      "expect": "The second zombie's upward velocity stays below 0.5 blocks/tick."
    }
  ]
}
```

- `setup` entries are server console commands without a leading `/`. `@bot` is replaced with the bot's username, and the commands run as the bot so that `^`/`~` coordinates are relative to it.
- `expect` must describe something the playtester tools can observe: entity position or velocity, inventory, chat, server log, health.
- Don't summon mobs with `NoAI:1b`: they ignore velocity and knockback, so movement checks always fail. Prefer husks to zombies because zombies burn in daylight. Add `PersistenceRequired:1b` so mobs don't despawn.
- Measured on the `fixtures/launch-sword` plugin: the correct build gives a max upward velocity of **1.6** (the mob rises about 13 blocks). The buggy build, where vanilla knockback overwrites the launch, gives **0.4**. Thresholds around 0.8 separate the two cleanly.

## Verdict: `verdict.json`

The `minecraft` MCP server (A) writes it from the playtester's `report_check` and `finish` calls. The pipeline (B) reads it with `game.readVerdict(file)`.

```json
{
  "version": 1,
  "runId": "mod_x_attempt_1",
  "finished": true,
  "passed": false,
  "summary": "Zombie took damage but did not rise.",
  "checks": [
    {
      "id": "launch-on-hit",
      "status": "fail",
      "expected": "upward velocity > 0.8 within 5 ticks",
      "observed": "max upward velocity 0.0; zombie took 6 damage",
      "evidence": { "samples": [{ "tick": 0, "pos": [0, 64, 3], "vel": [0, 0, 0] }], "serverLog": [] },
      "suspectedCause": "Velocity applied before the damage event resets it, or the event handler isn't registered."
    }
  ],
  "serverErrors": [{ "at": 1760140000000, "message": "Could not pass event EntityDamageByEntityEvent to LaunchSword", "stack": "..." }]
}
```

- `status` is one of `pass`, `fail` or `blocked`. `blocked` means the playtester couldn't run the check, for example because the bot died or the plugin didn't load.
- `passed` is `finished && every check passed && serverErrors is empty`.
- Every check id in the test plan must appear. `finish` refuses once if any are unreported, then records the rest as `blocked`; `readVerdict(file, testPlan)` also fills unreported checks in as `blocked`, so a partial playtest never passes.
- If the file is missing or the session never called `finish`, `readVerdict` returns `{ finished: false, passed: false, error }`. That never counts as a pass.

## Game runtime: `electron/lib/game/index.cjs` (A)

```js
const game = require('./lib/game/index.cjs');

game.status()
// { server: 'stopped'|'starting'|'running'|'error', bot: 'offline'|'connecting'|'online',
//   viewerUrl: string|null, controlUrl: string|null, version: '1.21.4', mock: boolean, error: string|null }

await game.start(emit)            // download/prepare Paper if needed, start the server, connect the bot, start the viewer
await game.stop()
await game.deployPlugin({ jarPath, emit })
// Removes previously deployed studio jars, copies jarPath, restarts, waits for the bot.
// -> { loaded: boolean, plugin: string|null, errors: string[], logTail: string[] }
await game.runCommand('time set day')   // -> console output string

game.mcpConfig({ runId, verdictFile, testPlanFile })   // -> object to write as the Claude `--mcp-config` file
game.playtesterTools                                    // -> string[] for Claude `--allowedTools`
game.playtestPrompt(testPlan)                           // -> prompt for the playtester session
game.readVerdict(verdictFile, testPlan)                 // -> verdict (see above); unreported plan checks count as blocked
game.mockVerdict(testPlan, attempt)                     // mock only: attempt 1 fails the first check, attempt 2+ passes
```

**Who runs the playtester:** B's pipeline spawns the playtester as a normal Claude Code run (`claude -p --output-format stream-json --mcp-config <file> --allowedTools <playtesterTools>`) with `playtestPrompt(testPlan)`. That way Neatlogs traces it like every other session. In mock mode, B skips the session and uses `mockVerdict`.

**Events** (main → renderer through `emit`):

- `game:status`: the status object above.
- `game:log`: `{ line, level: 'info'|'warn'|'error', at }`, server console lines.
- `game:action`: `{ tool, args, result?, at }`, each MCP tool call the bot performs, for the GamePane overlay.

**IPC** (registered by `game.handlers(emit)`): `game:status`, `game:start`, `game:stop`, `game:command { command }`.

## `minecraft` MCP server: `electron/mcp-minecraft.cjs` (A)

Runtime facts: the bot (`BenanaBot`) and viewer run in a child process under **system Node 22+**, because Mineflayer doesn't run on Electron 33's Node 20. A plugin swap takes about 16 seconds because it restarts the server. The world is a superflat at y=64, and the viewer is at `http://127.0.0.1:3007`.

This stdio MCP server forwards calls to the bot's local control API (`BENANA_GAME_URL`). The bot lives in the Electron main process, so the viewer and connection survive between sessions. Env: `BENANA_GAME_URL`, `BENANA_VERDICT_FILE`, `BENANA_TEST_PLAN`, `BENANA_RUN_ID`.

| Tool | Purpose |
|---|---|
| `game_setup(commands[])` | Run test-plan setup console commands (`@bot` substituted) |
| `bot_state()` | Position, health, held item, inventory |
| `reset_arena()` | Rebuild the flat arena, remove all non-player entities, reset the bot (empty inventory). Plugin state such as cooldowns is not reset |
| `nearby_entities(radius?)` | id, type, position, velocity, distance, health (living entities) |
| `equip(item)` | Put an item in hand |
| `look_at(entityId \| position)` | Aim the bot |
| `move_to(entityId \| position, range?)` | Pathfind toward a target |
| `attack(entityId, trackTicks?)` | Left-click an entity. Use `trackTicks` to sample it right after the hit |
| `attack_sequence(entityIds[], intervalTicks?, trackTicks?)` | Hit several entities a few ticks apart in one call, for cooldown and combo checks |
| `use_item(entityId?, trackTicks?, holdTicks?)` | Right-click, optionally on an entity. With a ranged item in hand it fires through `shoot` |
| `shoot(entityId \| entityIds[] \| position, item?, chargeTicks?, intervalTicks?, trackTicks?, radius?)` | Aim and fire a bow, crossbow, trident or throwable; `entityIds` fires a sequence in one call. Reports each projectile (spawned, last position, removed or stuck), explosions with positions, ammo used, chat, and health before/after, deaths and max velocity of every living entity in `radius` |
| `track_entity(entityId, ticks?)` | Per-tick position and velocity samples |
| `wait_ticks(ticks)` | Let the game advance |
| `chat(message)` | Speak or run a player command (`/launch`) |
| `read_chat(sinceMs?)` | Recent chat |
| `server_log(sinceMs?, level?)` | Server console, including plugin stack traces |
| `report_check({ id, status, expected, observed, evidence?, suspectedCause? })` | Record one check result |
| `finish({ summary })` | Finalize `verdict.json` |

## Studio: `electron/lib/studio/index.cjs` (B)

IPC is registered by `studio.handlers({ emit, log })`. B defines the channel names and the mod object. The renderer side lives in `src/components/studio/**`. `ModStudio` renders `<GamePane />` from `src/components/game/GamePane.jsx`. `GamePane` takes no required props and subscribes to `game:*` events itself.

Per-mod data (B): `<dataDir>/mods/<slug>/` is the plugin's git repo (Entire is enabled here). `<dataDir>/studio/<modId>/attempt-<n>/` holds `test-plan.json`, `verdict.json`, `build.log` and `mcp.json`.

# Benana Mod Studio

Describe a Minecraft mod in one sentence. Benana writes it as a Paper plugin, starts a Minecraft server inside the app, and sends an AI player in to test it. When the playtest fails, a fixer agent reads the in-game evidence, patches the plugin, and the AI player tests it again.

![Benana Mod Studio: the agent's report on the left, the live game, server log, Neatlogs traces and Entire checkpoints on the right](docs/images/build.png)

## Start with one sentence

> "A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown."

Type an idea, or pick one of the examples, and press Enter. You never open an IDE, a server console, or the game client. Lessons the fixer has learned from earlier mods are shown under the examples and passed to every new build.

![The New mod composer with example ideas and the lessons the fixer has learned so far](docs/images/new-mod.png)

## What happens next

1. **Spec agent** (Claude Opus) turns the sentence into behavior rules and an in-game **test plan** with measurable expectations, for example "the husk's upward velocity exceeds 0.8 blocks/tick".
2. **Builder** (Claude Code, Opus) implements the plugin in its own git repository created from `templates/paper-plugin`, and Maven builds it.
3. **Deploy**: Benana restarts its local Paper 1.21.4 server with the new jar, which takes about 16 seconds.
4. **Playtester** (Claude Code, Sonnet) controls `BenanaBot`, a real player, through the `minecraft` MCP tools: equip, attack, use items, and track an entity's velocity tick by tick. It reports pass, fail, or blocked for each check, with the measurements as evidence.
5. **Fixer** (Claude Code, Opus) receives the verdict, server stack traces, the mod's Entire checkpoint history, and the Neatlogs trace of the failed playtest. It fixes the root cause, writes down a **lesson**, and the loop runs again (up to 3 attempts).

## Watch the AI player test it

The live view embeds the game from BenanaBot's camera, so you see the playtest as it happens: the bot gets the item, spawns a target, and uses the mod on it. The server log streams next to it, so plugin errors are visible as they happen.

![Three frames from BenanaBot's first-person view as it fights husks in the test arena](docs/images/live-view.png)

## When a playtest fails, it fixes itself

A failed check is not the end of the run. Every attempt keeps the measured evidence, the agent sessions behind it, and the fixer's lesson.

The **Mods** page below shows ArrowTracer, a real run that needed three attempts. The request was "can't see the arrows being shot". The first build reported the arrow's landing spot 1.3 blocks from the shooter instead of 7 to 9. The fixer traced the impact point along the arrow's velocity and wrote that down as a lesson. The second playtest still failed. On the third attempt the fixer worked out that the plugin was right: the husk had walked up to the bot before the shot. It fixed the test target by giving it NoAI, and all four checks passed. Total cost: $1.32.

![The Mods page: ArrowTracer's spec and its attempt timeline, with failed attempts, evidence and the fixer's lesson](docs/images/mods.png)

## Every agent session is traced (Neatlogs)

Every builder, playtester, and fixer session is traced through `@neatlogs/claude-code` hooks installed into each mod repository. The **Neatlogs** page lists all sessions across all mods. Opening one shows its cost, tokens, the failure it was handed, each tool call, and its final output. The fixer reads the failed playtest's trace before it changes any code.

![The Neatlogs page with the ArrowTracer fixer session open: duration, tokens, cost, the attempt 2 failure it received, and its 7 steps](docs/images/neatlogs-trace.png)

## Every commit is tied to its session (Entire)

Each agent commit in a mod repository carries an `Entire-Checkpoint` trailer that links the code to the session that wrote it. The **Entire** page shows the commit history per mod: builder, playtest, and fixer commits in order, with the checkpoint that produced each one. The fixer gets this history as context.

![The Entire page: ArrowTracer's six commits, alternating fixer attempts and playtests, each linked to a checkpoint](docs/images/entire.png)

## Insights

The **Insights** page tracks build outcomes, pass rate, first-try passes, and spend broken down by agent role and model.

![The Insights page: mods built, pass rate, agent sessions, total spend, build activity and spend by agent role](docs/images/insights.png)

## Partner tools

- **Neatlogs** traces every agent session (see above).
- **Entire** checkpoints every attempt (see above). This repository has Entire enabled too.
- **cfo.ai** holds the business plan: [docs/hackathon/cfo-plan.md](docs/hackathon/cfo-plan.md).

## Run it

Requirements: Node 22+ on `PATH` (the game bot runs on system Node), JDK 21, Maven 3.9, and Claude Code logged in. Install the [Entire CLI](https://github.com/entireio/cli) and `npm i -g @neatlogs/claude-code` for partner evidence.

```sh
npm ci
cp .env.example .env     # add Neatlogs keys
npm run dev
```

Click **Start game**, describe a mod, and press Enter. On first start Benana downloads Paper (51 MB). Game data lives in `~/.benana/game`, mod repositories in `~/.benana/mods`.

- `BENANA_GAME_AUTOSTART=1` starts the game with the app. `BENANA_GAME_DEMO=1` turns on attract mode, where the bot keeps launching husks. `BENANA_VIEW=first` switches the live view to the bot's first-person camera.
- **Seeded bug** (the toggle under the prompt) starts from `fixtures/seeded`, a labeled LaunchSword with the knockback bug. The playtester and fixer still run for real, and the UI labels the run as seeded.
- If Electron crashes at startup with `reading 'handle'`, unset `ELECTRON_RUN_AS_NODE`.

```sh
npm run build
npm test
```

Architecture and interfaces: [docs/hackathon/CONTRACTS.md](docs/hackathon/CONTRACTS.md). Build plan: [docs/hackathon/PLAN.md](docs/hackathon/PLAN.md). The original repository-bug workspace is still available from **Repository workspace** in the sidebar; see [execute_yourself.md](execute_yourself.md).

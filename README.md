# Benana Mod Studio

Describe a Minecraft mod in one sentence. Benana writes it as a Paper plugin, starts a Minecraft server inside the app, and sends an AI player in to test it. When the playtest fails, a fixer agent reads the in-game evidence, patches the plugin, and the AI player tests it again.

> "A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown."

1. **Spec agent** (Claude Opus) turns the sentence into behavior rules and an in-game **test plan** with measurable expectations, for example "the husk's upward velocity exceeds 0.8 blocks/tick".
2. **Builder** (Claude Code, Opus) implements the plugin in its own git repository created from `templates/paper-plugin`, and Maven builds it.
3. **Deploy**: Benana restarts its local Paper 1.21.4 server with the new jar, which takes about 16 seconds.
4. **Playtester** (Claude Code, Sonnet) controls `BenanaBot`, a real player, through the `minecraft` MCP tools: equip, attack, use items, and track an entity's velocity tick by tick. It reports pass, fail, or blocked for each check, with the measurements as evidence. You watch it live in the embedded 3D view.
5. **Fixer** (Claude Code, Opus) receives the verdict, server stack traces, the mod's Entire checkpoint history, and the Neatlogs trace of the failed playtest. It fixes the root cause, writes down a **lesson**, and the loop runs again (up to 3 attempts). Lessons are passed to future builders, so later mods avoid the same bug.

## Partner tools

- **Neatlogs** traces every builder, playtester, and fixer session through `@neatlogs/claude-code` hooks installed into each mod repository. The fixer reads the failed playtest's trace, and each session in the attempt timeline links to its trace.
- **Entire** checkpoints every attempt. Each agent commit in a mod repository carries an `Entire-Checkpoint` trailer that links the code to the session that produced it. The fixer is given that checkpoint history as context. This repository has Entire enabled too.
- **cfo.ai** holds the business plan: [docs/hackathon/cfo-plan.md](docs/hackathon/cfo-plan.md).

## Run it

Requirements: Node 22+ on `PATH` (the game bot runs on system Node), JDK 21, Maven 3.9, and Claude Code logged in. Install the [Entire CLI](https://github.com/entireio/cli) and `npm i -g @neatlogs/claude-code` for partner evidence.

```sh
npm ci
cp .env.example .env     # add Neatlogs keys
npm run dev
```

Click **Start game**, describe a mod, then click **Build and playtest**. On first start Benana downloads Paper (51 MB). Game data lives in `~/.benana/game`, mod repositories in `~/.benana/mods`.

- `BENANA_GAME_AUTOSTART=1` starts the game with the app. `BENANA_GAME_DEMO=1` turns on attract mode, where the bot keeps launching husks.
- **Seeded bug (fallback)** starts from `fixtures/seeded`, a labeled LaunchSword with the knockback bug. The playtester and fixer still run for real, and the UI labels the run as seeded.
- If Electron crashes at startup with `reading 'handle'`, unset `ELECTRON_RUN_AS_NODE`.

```sh
npm run build
npm test
```

Architecture and interfaces: [docs/hackathon/CONTRACTS.md](docs/hackathon/CONTRACTS.md). Build plan: [docs/hackathon/PLAN.md](docs/hackathon/PLAN.md). The original repository-bug workspace is still available from **Open repository workspace**; see [execute_yourself.md](execute_yourself.md).

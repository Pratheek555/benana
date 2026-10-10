# neatHack plan: Benana Mod Studio

Submissions close **Mon Oct 12, 23:55 IST**. Aim to submit by **21:00** and keep the remaining time as buffer.

## What we are building

A user describes a Minecraft mod in one sentence. Benana then runs this loop:

1. **Spec agent** writes a mod spec and a machine-checkable **test plan**.
2. **Builder** (Claude Code in the mod's git repo) writes a **Paper 1.21.4 plugin** from our template, and `mvn package` builds it.
3. **Deploy** copies the jar into a local Paper server managed by Benana and restarts the server.
4. **Playtester** (Claude Code plus our `minecraft` MCP server) controls a Mineflayer bot inside the game. The bot follows the test plan the way a player would: equip, hit, use and observe, measuring position and velocity. It reports pass or fail for each check with evidence.
5. **On failure**, a **fixer** gets the verdict, server stack traces, the Neatlogs trace and the Entire checkpoint context. It then rebuilds, redeploys and retests (up to 3 attempts).
6. The app shows the bot's view live through the embedded prismarine-viewer, with the test checklist and attempts beside it.

Partner usage counts for 25% of the score:

- **Neatlogs:** a trace for every builder, playtester and fixer session (Claude Code plugin).
- **Entire:** a checkpoint for every attempt in the mod repo, plus context from earlier failed attempts for the fixer.
- **cfo.ai:** the business plan. Customers are server owners and regular players.

Hero demo: *"A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown."*

We use real bugs. A clearly **labeled** injected-bug mode exists only as a recording fallback.

## Tracks

| | Track A: Game and playtester | Track B: Studio pipeline and partners |
|---|---|---|
| Person | Pratheek (demo machine; has Minecraft) | Teammate |
| Owns | Paper server runtime, Mineflayer bot, viewer, `minecraft` MCP server, playtester prompt, `GamePane`, fixture plugins, injected-bug fallback | Plugin template, spec/builder/fixer prompts, `mvn` build, pipeline orchestration, mod repos, Neatlogs/Entire evidence, `ModStudio` UI, cfo.ai, README, submission |

The tracks meet only at the interfaces in [CONTRACTS.md](CONTRACTS.md). Until the real game runtime lands, Track B develops against `BENANA_GAME_MOCK=1`.

### File ownership (edit only your own files)

| Track A only | Track B only | Shared (see rules) |
|---|---|---|
| `electron/lib/game/**` | `electron/lib/studio/**` | `package.json`, `package-lock.json` |
| `electron/mcp-minecraft.cjs` | `templates/paper-plugin/**` | `electron/main.cjs` (frozen after the skeleton commit) |
| `src/components/game/**` | `src/components/studio/**` | `src/App.jsx` (owned by B) |
| `fixtures/**` | `electron/lib/agents.cjs`, `providers.cjs`, `neatlogs.cjs`, `entire.cjs` | `docs/hackathon/CONTRACTS.md` (change only with both people agreeing) |
| | `README.md`, `docs/hackathon/SUBMISSION.md`, `docs/hackathon/cfo-plan.md` | |

Rules:

- **`main.cjs`**: each track registers IPC through its own module (`game.handlers()` / `studio.handlers()`). Add channels inside your module, not in `main.cjs`.
- **CSS**: each component imports its own stylesheet (`src/components/game/game.css`, `src/components/studio/studio.css`). Don't edit `src/styles.css`.
- **Dependencies**: add them in a separate small commit and merge it to `main` immediately. On a lockfile conflict, take `main`'s version and run `npm install` again.
- **Contract changes**: discuss them first, then update `CONTRACTS.md` and the mock in one commit.

### Machine setup (both)

- Node 22+ on `PATH` (the bot host runs on system Node), JDK 21, and Maven 3.9.
- If `npx electron .` crashes with `Cannot read properties of undefined (reading 'handle')`, your shell has `ELECTRON_RUN_AS_NODE` set. Unset it first.
- `BENANA_GAME_AUTOSTART=1` starts the game when the app opens, and `BENANA_GAME_DEMO=1` turns on attract mode (the bot keeps launching husks; useful for X clips).
- The game data lives in `~/.benana/game/server`. Paper is downloaded on first start (51 MB).

### Git workflow

- Branches: `game/<topic>` (A), `studio/<topic>` (B). Keep them short-lived and merge to `main` at least every sync point.
- Before merging, run `git pull --rebase origin main`, `npm run build` and `npm test`.
- Never force-push `main`. Squash-merge PRs (`gh pr merge --squash`).
- Commit often. Commits dated during the event are judged evidence.

## Schedule (IST)

| When | Track A | Track B | X post |
|---|---|---|---|
| **Sun 02:30 → sleep** | Skeleton commit. Spike: Paper server + bot + viewer inside the app | (asleep) | **#1** "Benana boots a Minecraft server and an AI player inside the app" (A) |
| **Sun 09:00–13:00** | `minecraft` MCP server and tools. Handwritten `fixtures/launch-sword` (correct and buggy versions). Playtester prompt. Run the playtester by hand on the fixture until `verdict.json` is correct | Neatlogs plugin and Entire CLI set up. `templates/paper-plugin` + `mvn package` build step. Mod repo creation (`git init`, `entire enable`). Spec agent → `test-plan.json` | **#2** "Claude wrote a working Minecraft plugin from one sentence" (B) |
| **Sun 13:00 sync** | Merge. Deploy B's built jar with the real `deployPlugin` | Merge. Swap the mock for the real game | |
| **Sun 14:00–20:00** | Real `deployPlugin` (restart, load detection, error capture). Bot reconnects after restart. `GamePane` overlay (current tool call, action ticker) | Pipeline: create → spec → build → deploy → playtest → verdict → fixer → retry (max 3). Studio UI: prompt, live checklist, attempt timeline. Neatlogs evidence per session | **#3** "AI playtester hitting zombies and measuring launch velocity" (A) |
| **Sun 20:00–22:00 together** | First full real loop end to end | Same | **#4** fail → fix → pass clip (both) |
| **Mon 09:00–15:00** | Labeled injected-bug fallback. Run the hero mod 5 times and fix flaky steps. Camera polish. A second mod prompt to show it generalizes | Entire checkpoint per attempt + Entire context for the fixer. Evidence panel (trace link, checkpoint, server log). cfo.ai plan. README evidence | **#5** "Every attempt traced in Neatlogs and checkpointed in Entire" (B) |
| **Mon 15:00** | **Code freeze**: bug fixes only after this | | |
| **Mon 15:00–19:00** | Drive the app for the recording (demo machine) | Script, edit and voice-over the video. Draft the submission | |
| **Mon 19:00–21:00** | Submit (window opens 19:00). Final X post with the video | | **#6** demo video |

If a block slips, cut scope in this order: second mod prompt → camera polish → attempt timeline styling. Never cut the fail → fix → pass loop or the partner evidence.

## Teammate brief (paste into your Claude Code)

> You are working on **Track B** of Benana Mod Studio for the neatHack hackathon. Read `docs/hackathon/PLAN.md` and `docs/hackathon/CONTRACTS.md` first; they are the source of truth. Edit only the files listed under "Track B only" in the ownership table. Treat `electron/lib/game/**`, `electron/mcp-minecraft.cjs`, `src/components/game/**` and `fixtures/**` as read-only; they belong to the other track. Use the game API exactly as written in CONTRACTS.md. Until the real runtime is merged, run with `BENANA_GAME_MOCK=1`, where `game.mockVerdict()` fails attempt 1 and passes attempt 2. Work on `studio/<topic>` branches. Rebase on `origin/main` and run `npm run build && npm test` before every merge. If a contract needs to change, stop and tell me instead of editing the other track's files. Current block: see the schedule table in PLAN.md.

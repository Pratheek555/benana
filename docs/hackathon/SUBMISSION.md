# neatHack submission checklist

Submissions are open Mon Oct 12, 19:00–23:55 IST. Plan to submit by 21:00.

| Requirement | Evidence | Status |
|---|---|---|
| Agent capability (30%) | Demo video: prompt → spec → build → in-game playtest fails → fixer → retest passes. Mod repos in `~/.benana/mods/*` | Loop verified headless on 2026-10-11 (seeded run: fail → fix → pass in 3m16s) |
| neatlogs | Trace links or screenshots for builder, playtester, and fixer sessions. Session IDs are in `~/.benana/studio/<mod>/mod.json` | Waiting on keys in `.env` |
| Entire | `entire checkpoint list` in a mod repo. `Entire-Checkpoint` trailers on every agent commit. Entire enabled on this repo | Checkpoints recorded locally. Run `entire login` for shareable links |
| cfo.ai | Business plan covering pricing, costs, revenue, runway: [cfo-plan.md](cfo-plan.md) | Inputs drafted. Run it in cfo.ai and paste the result |
| Failure recovery | Attempt timeline: the failed attempt with its measured evidence, the fixer's lesson, and the passing retest | Working |
| Public commits during the event | `git log` on `Pratheek555/benana` | Pushing at each milestone |
| Build log on X (#neatHack) | Posts #1–#6 from [PLAN.md](PLAN.md) | |
| Demo video (20%) | 2–3 minutes, recorded Mon 15:00–19:00 | |

## Demo video script (about 2:30)

1. **0:00–0:15. Hook.** "This AI just built a Minecraft mod, played it, found its own bug, and fixed it." Show the passing checklist.
2. **0:15–0:35.** Type the hero prompt and click **Build and playtest**. Show the spec agent's test plan appearing.
3. **0:35–1:00.** The builder writes the plugin (speed up this part), then compiles and deploys while the server restarts.
4. **1:00–1:40.** The playtester in the 3D view: equips the sword and hits the husk while the overlay shows the measured velocity. The check turns red, with the observed velocity next to it.
5. **1:40–2:10.** The fixer: it reads the evidence, the Entire checkpoint context, and the Neatlogs trace, writes its lesson, and the husk flies 13 blocks up. Everything turns green.
6. **2:10–2:30.** Evidence: a Neatlogs trace, `entire checkpoint list`, the cfo.ai plan. "Lessons carry over: the next mod doesn't repeat the bug."

If the organic run doesn't fail on camera, use **Seeded bug (fallback)** and say on screen that it's seeded.

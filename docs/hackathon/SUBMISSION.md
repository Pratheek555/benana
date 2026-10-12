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

## Crazy mod: Black Hole Grenade (ready, real Minecraft client)

Built in the app on 2026-10-12 (chat `BlackHoleGrenade`, repo `~/.benana/mods/black-hole-grenade-okx3`). Both turns passed every check on the first attempt; $2.29 in total.

1. Prompt (5 min, 4/4 checks): *"Black Hole Grenade: a dark orb you throw like a snowball. Where it lands, a black hole opens for 5 seconds: a swirling vortex of purple and black particles that drags every mob within 12 blocks into a spiral around it and lifts them off the ground. Then it collapses with a huge explosion that flings every mob caught in it high into the sky. 8 second cooldown per player."*
   The playtester measured a husk pulled from 4.9 to 0.5 blocks off the impact point, then launched at 2.2 blocks/tick and 26 blocks high.
2. Follow-up in the same chat (8 min, 5/5 checks): *"Make it way crazier: while the black hole is open it rips chunks of the ground up, so blocks tear off the floor and spiral into the vortex along with the mobs, and when it collapses lightning strikes the center and the blast leaves a crater."* The log reads "ripped 40 blocks, crater 189 blocks".
3. **Run mod**: the live view is the real Minecraft client, filmed from the side, so the vortex, flying blocks, lightning and crater are all in the shot.
4. **Play in Minecraft**: a second real Minecraft window opens with you next to the bot, holding 3 grenades and husk eggs. Throw it yourself on camera. **Reset world** fills the crater back in, and your window rejoins.

Shot list: type prompt 1 → speed up the builder → playtest in the live view → green checks → send prompt 2 → Run mod → Play in Minecraft and throw one yourself. Use ArrowTracer's history (or the seeded run) for the fail → fix → pass beat.

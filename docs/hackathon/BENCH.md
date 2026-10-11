# Benana Bench, generated assets, and player-movement tests

## Assets the agents draw

Agents draw the mod's art. Every mod repository ships `tools/texture.cjs`. The builder writes 16x16 pixel art as JSON in `art/`, and the tool renders the texture, model and 1.21.4 item definition into `pack/`, plus an upscaled preview the agent reads to check its work. After Maven, Benana validates the pack: the JSON, model and texture references, PNG sizes, and that every `setItemModel(...)` in the code points at a drawn item. It then zips the pack, and the server offers it to every player who joins. A broken pack fails the attempt and goes to the fixer like a compile error. The chat shows each attempt's textures.

## The benchmark

`bench/storm-golem/task.json` is a fixed benchmark request: a Storm Golem boss with a summon command, a boss bar, a timed slam that launches the player, a second phase, and a textured drop with its own effect. It also carries **hidden checks**. The spec agent writes its own test plan as usual and never sees them. After the pipeline finishes, a grader playtests the final build against the hidden checks from outside the mod repository, and Benana checks the assets itself. A coach agent then turns failed checks into general lessons that every future builder reads. The **Bench** page shows the score for each run and which capabilities passed, so you can see whether the builder improves over runs.

The playtester can now test mods that act on the player. `track_self`, `move`, and `use_item` with `trackSelf` record the bot's own launches, height gain and effects. `place_block`, `dig_block` and `boss_bars` cover block mods and bosses.

## Running it

Open **Bench** in the sidebar and click **Run benchmark**. The run builds the request through the normal pipeline (spec, builder, playtester, fixer), then the grader replays the final build on a fresh world with the hidden checks. Results are kept in `~/.benana/bench/results.json`. Coach lessons go to `~/.benana/studio/lessons.json` with `"source": "coach"`, and the builder and fixer read them.

To add a task, create `bench/<id>/task.json` with `prompt`, `capabilities`, optional `assets.min`, and `gold.setup` and `gold.checks`. Each check names one capability.

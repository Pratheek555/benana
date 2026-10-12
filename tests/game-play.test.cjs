const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.BENANA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "benana-play-"));
const { playKit } = require("../electron/lib/game/index.cjs");

test("Play in Minecraft hands the user every item the test plan gives, once per kind", () => {
  const plan = {
    setup: ["gamerule doMobSpawning false", "time set day"],
    checks: [
      { id: "a", steps: 'reset_arena. game_setup: ["bhg give @bot 3"]. Call bot_state.' },
      { id: "b", steps: 'game_setup: ["bhg give @bot 1", "summon husk ^ ^ ^10 {PersistenceRequired:1b}", "effect give @e[type=husk,distance=..16] slowness infinite 255 true"]. shoot.' },
      { id: "c", steps: 'game_setup: ["give @bot snowball 1", "summon husk ^ ^ ^10"]' },
    ],
  };
  const kit = playKit(plan);
  assert.deepEqual(kit.commands, ["bhg give @bot 3", "give @bot snowball 1", "give @bot husk_spawn_egg 16"]);
  assert.deepEqual(kit.tries, []);
});

test("plugin commands that are not gives are suggested to the user instead of run", () => {
  const kit = playKit({ setup: ["give @bot iron_sword", "stormgolem"], checks: [] });
  assert.deepEqual(kit.commands, ["give @bot iron_sword", "give @bot husk_spawn_egg 16"]);
  assert.deepEqual(kit.tries, ["stormgolem"]);
});

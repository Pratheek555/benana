const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const TEMPLATE = path.join(__dirname, "..", "templates", "paper-plugin");
const pack = require("../electron/lib/studio/pack.cjs");

// A mod repo with the template's asset tooling and a plugin that uses the given item models.
function repo(javaModels = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "benana-assets-"));
  fs.cpSync(path.join(TEMPLATE, "tools"), path.join(dir, "tools"), { recursive: true });
  fs.cpSync(path.join(TEMPLATE, "pack"), path.join(dir, "pack"), { recursive: true });
  const src = path.join(dir, "src", "main", "java", "dev", "benana", "mod");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "Mod.java"), javaModels.map((m) => `meta.setItemModel(new NamespacedKey("benana", "${m}"));`).join("\n"));
  return dir;
}

const GEM = {
  name: "storm_core",
  palette: { ".": null, k: "#1b1030", p: "#8a4bff", w: "#ffffffcc" },
  pixels: Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => {
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    return d < 4 ? "w" : d < 6.5 ? "p" : d < 7.5 ? "k" : ".";
  }).join("")),
};

function draw(dir, art) {
  fs.mkdirSync(path.join(dir, "art"), { recursive: true });
  fs.writeFileSync(path.join(dir, "art", `${art.name}.json`), JSON.stringify(art));
  return execFileSync(process.execPath, [path.join(dir, "tools", "texture.cjs")], { cwd: dir, encoding: "utf8" });
}

test("the texture tool draws pixel art into a texture, model, item definition and preview", () => {
  const dir = repo(["storm_core"]);
  const out = draw(dir, GEM);
  assert.match(out, /benana:storm_core \(16x16\)/);
  const tex = fs.readFileSync(path.join(dir, "pack/assets/benana/textures/item/storm_core.png"));
  assert.deepEqual(pack.pngSize(tex), { width: 16, height: 16 });
  assert.deepEqual(pack.pngSize(fs.readFileSync(path.join(dir, "preview/storm_core.png"))), { width: 256, height: 256 });
  const item = JSON.parse(fs.readFileSync(path.join(dir, "pack/assets/benana/items/storm_core.json"), "utf8"));
  assert.equal(item.model.model, "benana:item/storm_core");
});

test("the texture tool rejects rows of the wrong width and colors missing from the palette", () => {
  const dir = repo();
  assert.throws(() => draw(dir, { ...GEM, pixels: [...GEM.pixels.slice(0, 15), "..."] }), /row 15 has 3 pixels/);
  assert.throws(() => draw(dir, { ...GEM, pixels: GEM.pixels.map((r) => r.replace("p", "z")) }), /"z", which is not in the palette/);
});

test("a valid pack is zipped with every file, and its textures are listed for the UI", () => {
  const dir = repo(["storm_core"]);
  draw(dir, GEM);
  const out = pack.build(dir, path.join(dir, "target", "Mod-pack.zip"));
  assert.equal(out.ok, true, out.errors.join("\n"));
  assert.deepEqual(out.assets.map((a) => [a.id, a.size]), [["benana:storm_core", 16]]);
  assert.match(out.assets[0].texture, /^data:image\/png;base64,/);
  const zip = fs.readFileSync(out.zip);
  // End of central directory: entry count, then each local header carries its file name.
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(zip.readUInt16LE(eocd + 10), out.files);
  for (const name of ["pack.mcmeta", "assets/benana/items/storm_core.json", "assets/benana/textures/item/storm_core.png"]) {
    assert.ok(zip.includes(Buffer.from(name)), `${name} is in the zip`);
  }
  // Identical inputs give an identical zip, so the server's sha1 only changes when the art does.
  const again = pack.build(dir, path.join(dir, "target", "again.zip"));
  assert.ok(fs.readFileSync(again.zip).equals(zip));
});

test("code pointing at an item model that was never drawn fails the pack", () => {
  const dir = repo(["storm_core", "thunder_shard"]);
  draw(dir, GEM);
  const out = pack.build(dir, path.join(dir, "target", "Mod-pack.zip"));
  assert.equal(out.ok, false);
  assert.equal(out.zip, null);
  assert.match(out.errors.join("\n"), /setItemModel\("benana:thunder_shard"\)/);
});

test("a model that points at a missing texture fails the pack, and unused art is a warning", () => {
  const dir = repo([]);
  draw(dir, GEM);
  fs.rmSync(path.join(dir, "pack/assets/benana/textures/item/storm_core.png"));
  const out = pack.build(dir, path.join(dir, "target", "Mod-pack.zip"));
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /texture benana:item\/storm_core does not exist/);
  assert.match(out.warnings.join("\n"), /no setItemModel/);
});

test("a mod without assets has no pack and passes", () => {
  const out = pack.build(repo([]), path.join(os.tmpdir(), "unused.zip"));
  assert.deepEqual([out.ok, out.zip, out.assets.length], [true, null, 0]);
});

test("setItemModel through a field, a constant or plugin-namespaced key still counts as using the art", () => {
  const dir = repo([]);
  draw(dir, GEM);
  const java = path.join(dir, "src/main/java/dev/benana/mod/Mod.java");
  const cases = [
    'private NamespacedKey coreKey; void on() { coreKey = new NamespacedKey("benana", "storm_core"); meta.setItemModel(coreKey); }',
    'static final String CORE = "benana:storm_core"; void a() { meta.setItemModel(NamespacedKey.fromString(CORE)); }',
    'void a() { meta.setItemModel(key("storm_core")); }',
  ];
  for (const code of cases) {
    fs.writeFileSync(java, code);
    const out = pack.build(dir, path.join(dir, "target", "Mod-pack.zip"));
    assert.deepEqual([out.ok, out.warnings], [true, []], code);
  }
  // The PDC key here is not an item model, so it must not be reported as missing art.
  fs.writeFileSync(java, 'NamespacedKey tag = new NamespacedKey("benana", "golem"); NamespacedKey model = new NamespacedKey("benana", "storm_core"); meta.setItemModel(model);');
  assert.equal(pack.build(dir, path.join(dir, "target", "Mod-pack.zip")).ok, true);
});

test("the live view reads each item's texture back out of the pack zip", () => {
  const dir = repo(["storm_core"]);
  draw(dir, GEM);
  const out = pack.build(dir, path.join(dir, "target", "Mod-pack.zip"));
  const textures = pack.packTextures(out.zip);
  assert.deepEqual(Object.keys(textures), ["benana:storm_core"]);
  assert.equal(textures["benana:storm_core"], out.assets[0].texture);
});

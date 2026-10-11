const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { sanitize } = require("../electron/lib/publish/sanitize.cjs");
const { pushCheckpoints } = require("../electron/lib/publish/refs.cjs");
const bundle = require("../electron/lib/publish/bundle.cjs");

const identity = { home: "/Users/alice", user: "alice", host: "alices-macbook", emails: ["alice@corp.example"] };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });

test("sanitize scrubs home paths, other users' homes, emails, host and username", () => {
  const r = sanitize("cd /Users/alice/mods && cat /home/bob/x; mail alice@corp.example or carol@x.io on alices-macbook as alice", identity);
  assert.equal(r.text, "cd ~/mods && cat /$HOME_OTHER/x; mail <email> or <email> on <host> as <user>");
  assert.deepEqual(r.suspicious, []);
});

test("random-looking tokens are flagged; hashes, ULIDs and agent IDs are not", () => {
  const r = sanitize(`key=Zx9QpL2mN7vB4rT8wY1kD6sF3hJ0aGcE ${"a".repeat(0)}sha=${"0123456789abcdef".repeat(4)} id=01M4P2C5GYHP4DHS9ZR94DBPJQ msg_01AbCdEfGhIjKlMnOpQrStUv`, identity);
  assert.equal(r.suspicious.length, 1);
  assert.equal(r.suspicious[0].preview, "Zx9Q…");
});

function repoWithCheckpoints() {
  const dir = tmp("pub-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "t"); git(dir, "config", "user.email", "t@t");
  fs.writeFileSync(path.join(dir, "a.txt"), "1");
  git(dir, "add", "."); git(dir, "commit", "-qm", "base");
  const base = git(dir, "rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(dir, "a.txt"), "2");
  git(dir, "commit", "-qam", "change\n\nEntire-Checkpoint: CK1");
  const tree = git(dir, "write-tree").trim();
  for (const id of ["CK1", "CK2"]) {
    const c = git(dir, "commit-tree", tree, "-m", id).trim();
    git(dir, "update-ref", `refs/entire/checkpoints/${id.slice(-2)}/${id}`, c);
  }
  return { dir, base };
}

test("only the chosen checkpoint refs are pushed", async () => {
  const { dir } = repoWithCheckpoints();
  const remote = tmp("pub-remote-");
  git(remote, "init", "-q", "--bare");
  const r = await pushCheckpoints(dir, remote, ["CK1"]);
  assert.deepEqual(r.pushed, ["refs/entire/checkpoints/K1/CK1"]);
  assert.match(git(remote, "for-each-ref"), /CK1/);
  assert.doesNotMatch(git(remote, "for-each-ref"), /CK2/);
  await assert.rejects(pushCheckpoints(dir, remote, ["NOPE"]), /No local ref/);
});

const fakeEntire = (transcript) => async (args) => {
  if (args[0] === "checkpoint" && args.includes("--json")) return { ok: true, out: JSON.stringify({ checkpoint_id: args[2], files_touched: ["a.txt"], sessions: [{ session_id: "S1", token_usage: { input_tokens: 5, output_tokens: 7 } }] }) };
  if (args[0] === "checkpoint" && args.includes("--transcript")) return { ok: true, out: transcript };
  return { ok: false, out: "" }; // graph unavailable in this test
};

test("a clean bundle passes, hashes every file, and keeps paths scrubbed", async () => {
  const { dir, base } = repoWithCheckpoints();
  const out = path.join(tmp("pub-out-"), "bundle");
  const jar = path.join(tmp("pub-jar-"), "Mod.jar");
  fs.writeFileSync(jar, "jar-bytes");
  const r = await bundle.build({ repoDir: dir, version: "HEAD", previous: base, jarPath: jar, sessions: ["S1"], outDir: out, identity, execute: fakeEntire('{"text":"ran cat /Users/alice/mods/a.txt"}\n') });
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.checkpoints.map((c) => [c.id, c.transcript]), [["CK1", true]]);
  assert.equal(r.manifest.tokens.output, 7);
  assert.equal(r.manifest.jar.sha256.length, 64);
  assert.ok(r.manifest.files.every((f) => f.sha256.length === 64));
  assert.match(fs.readFileSync(path.join(out, "checkpoints/CK1/transcript.jsonl"), "utf8"), /cat ~\/mods\/a\.txt/);
});

test("a transcript with a real-format secret blocks the bundle", async () => {
  const { dir, base } = repoWithCheckpoints();
  const out = path.join(tmp("pub-out-"), "bundle");
  const r = await bundle.build({ repoDir: dir, version: "HEAD", previous: base, sessions: ["S1"], outDir: out, identity, execute: fakeEntire('{"text":"aws_access_key_id = AKIAQWERTYUIOPASDFGH"}\n') });
  assert.equal(r.ok, false);
  assert.equal(r.manifest.gate.findings[0].rule, "aws-access-token");
});

test("sessions not chosen ship metadata only", async () => {
  const { dir, base } = repoWithCheckpoints();
  const out = path.join(tmp("pub-out-"), "bundle");
  const r = await bundle.build({ repoDir: dir, version: "HEAD", previous: base, sessions: [], outDir: out, identity, execute: fakeEntire("should not be read") });
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(path.join(out, "checkpoints/CK1/transcript.jsonl")), false);
});

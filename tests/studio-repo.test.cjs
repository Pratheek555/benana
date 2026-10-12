const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "benana-studio-repo-"));
process.env.BENANA_DATA_DIR = sandbox;
const repo = require("../electron/lib/studio/repo.cjs");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(sandbox, "mod-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "Launch.java"), "class Launch {}\n");
  fs.writeFileSync(path.join(sandbox, "secret.txt"), "outside the repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  const sha = git("rev-parse", "HEAD").trim();
  return { dir, sha };
}

test("lists tracked files and reads them", async () => {
  const { dir } = makeRepo();
  assert.deepEqual(await repo.files(dir), ["src/Launch.java"]);
  assert.match(await repo.readFile(dir, "src/Launch.java"), /class Launch/);
});

test("refuses paths that are not tracked files of the repository", async () => {
  const { dir } = makeRepo();
  await assert.rejects(repo.readFile(dir, "../secret.txt"), /Not a tracked file/);
  await assert.rejects(repo.readFile(dir, "src/Missing.java"), /Not a tracked file/);
});

test("returns a commit's patch and rejects anything that is not a commit id", async () => {
  const { dir, sha } = makeRepo();
  const patch = await repo.diff(dir, sha);
  assert.match(patch, /\+class Launch/);
  await assert.rejects(repo.diff(dir, "HEAD; rm -rf ."), /Unknown commit/);
  await assert.rejects(repo.diff(dir, "0000000"), /bad object|unknown revision|Could not read commit/i);
});

test("lists root and later commits with line counts and checkpoint trailers", async () => {
  const { dir, sha: rootSha } = makeRepo();
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });

  fs.writeFileSync(path.join(dir, "src", "Launch.java"), "class Launch {\n  int port = 25565;\n}\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add server port", "-m", "Entire-Checkpoint: 01M4NZNKVWMPE2Z7H59AQD7S0C");
  const latestSha = git("rev-parse", "HEAD").trim();

  const result = await repo.commits(dir);
  assert.equal(result.ok, true);
  assert.equal(result.branch, "main");
  assert.deepEqual(result.items.map((item) => item.sha), [latestSha, rootSha]);
  assert.deepEqual(result.items[0], {
    sha: latestSha,
    subject: "add server port",
    date: result.items[0].date,
    author: "t",
    checkpoint: "01M4NZNKVWMPE2Z7H59AQD7S0C",
    files: [
      { path: "README.md", additions: 1, deletions: 0 },
      { path: "src/Launch.java", additions: 3, deletions: 1 },
    ],
    additions: 4,
    deletions: 1,
  });
  assert.deepEqual(result.items[1].files, [{ path: "src/Launch.java", additions: 1, deletions: 0 }]);
  assert.equal(result.items[1].additions, 1);
  assert.equal(result.items[1].deletions, 0);
  assert.equal(result.items[1].checkpoint, null);
});

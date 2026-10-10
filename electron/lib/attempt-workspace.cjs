const fs = require("node:fs");
const path = require("node:path");
const { git } = require("./git.cjs");
const { copyWorkspace } = require("./processes.cjs");

// Untracked agent hook config (Entire, Claude Code, Codex) lives only in the user's checkout.
// It is copied into each worktree so Entire captures the session, and never counts as a change.
const AGENT_CONFIG = [".entire", ".claude", ".codex"];
const isAgentConfig = (file) => AGENT_CONFIG.some((dir) => file === dir || file.startsWith(`${dir}/`));

function statusRecords(porcelain) {
  const fields = porcelain.split("\0");
  const records = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    records.push({ status, file: record.slice(3) });
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return records;
}

async function create({ repoPath, worktree, branch, base = "HEAD", snapshotFrom }) {
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  await git(repoPath, ["worktree", "add", "-q", "-b", branch, worktree, base]);
  const baseSha = (await git(worktree, ["rev-parse", "HEAD"])).trim();
  if (snapshotFrom) copyWorkspace(snapshotFrom, worktree);
  for (const dir of AGENT_CONFIG) {
    const source = path.join(repoPath, dir);
    if (fs.existsSync(source) && !fs.existsSync(path.join(worktree, dir)))
      fs.cpSync(source, path.join(worktree, dir), { recursive: true });
  }
  return baseSha;
}

async function changedFiles(worktree) {
  const porcelain = await git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return statusRecords(porcelain).map((record) => record.file).filter((file) => !isAgentConfig(file));
}

// Commit a passing attempt on its benana/<id> branch. Entire's git hooks attach the agent
// session as an Entire-Checkpoint trailer, which is read back here.
async function commit(worktree, message) {
  await git(worktree, ["add", "-A", "--", ".", ...AGENT_CONFIG.map((dir) => `:!${dir}`)]);
  if (!(await git(worktree, ["diff", "--cached", "--name-only"])).trim()) return null;
  await git(worktree, ["commit", "-q", "-m", message]);
  const sha = (await git(worktree, ["rev-parse", "HEAD"])).trim();
  const checkpoint = (await git(worktree, ["log", "-1", "--format=%(trailers:key=Entire-Checkpoint,valueonly)"])).trim();
  return { sha, entireCheckpoint: checkpoint || null };
}

async function diff(run) {
  let output = await git(run.worktree, ["diff", "--no-ext-diff", "--binary", run.baseSha]);
  const porcelain = await git(run.worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const untracked = statusRecords(porcelain).filter((record) => record.status === "??" && !isAgentConfig(record.file)).map((record) => record.file);
  for (const name of untracked) {
    const file = path.join(run.worktree, name);
    try {
      const content = fs.readFileSync(file, "utf8");
      output += `\ndiff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ untracked file @@\n${content.split(/\r?\n/).map((line) => `+${line}`).join("\n")}\n`;
    } catch { output += `\nBinary untracked file ${name}\n`; }
  }
  return { diff: output, files: [...new Set((run.filesChanged || []).concat(untracked))], baseSha: run.baseSha };
}

module.exports = { changedFiles, commit, create, diff, statusRecords };

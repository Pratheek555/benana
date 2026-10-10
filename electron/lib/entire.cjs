// Entire: code ↔ session provenance. Optional; detected on PATH.
const { execFile } = require('node:child_process');
const { cached } = require('./util.cjs');

const run = (args, cwd) => new Promise((resolve) => execFile('entire', args, { cwd, timeout: 15000 }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || stderr || '').trim(), missing: err?.code === 'ENOENT' })));

const version = cached(5 * 60000, () => run(['version']));

async function status(repoPath) {
  const v = await version();
  if (v.missing) return { installed: false };
  if (!repoPath) return { installed: true, version: v.out };
  const s = await run(['status', '--json'], repoPath);
  let parsed = null;
  try { parsed = JSON.parse(s.out); } catch { /* not json */ }
  return { installed: true, version: v.out.split('\n')[0], enabled: s.ok, status: parsed || s.out.slice(0, 400) };
}

const checkpoints = (repoPath) => run(['checkpoint', 'list'], repoPath);

// Links a finished run to the Entire checkpoints its worktree produced (if Entire is enabled).
async function attach(worktree) {
  const v = await version();
  if (v.missing || !worktree) return null;
  const c = await checkpoints(worktree);
  if (!c.ok || !c.out) return null;
  return c.out.split('\n').filter(Boolean).slice(0, 10);
}
const why = (repoPath, target) => run(['why', target], repoPath);

module.exports = { status, checkpoints, why, attach };

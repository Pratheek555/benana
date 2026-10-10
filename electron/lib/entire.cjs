// Entire: code ↔ session provenance. Optional; detected on PATH.
const { execFile } = require('node:child_process');

const run = (args, cwd) => new Promise((resolve) => execFile('entire', args, { cwd, timeout: 15000 }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || stderr || '').trim(), missing: err?.code === 'ENOENT' })));

async function status(repoPath) {
  const v = await run(['version']);
  if (v.missing) return { installed: false };
  if (!repoPath) return { installed: true, version: v.out };
  const s = await run(['status', '--json'], repoPath);
  let parsed = null;
  try { parsed = JSON.parse(s.out); } catch { /* not json */ }
  return { installed: true, version: v.out.split('\n')[0], enabled: s.ok, status: parsed || s.out.slice(0, 400) };
}

const checkpoints = (repoPath) => run(['checkpoint', 'list'], repoPath);
const why = (repoPath, target) => run(['why', target], repoPath);

module.exports = { status, checkpoints, why };

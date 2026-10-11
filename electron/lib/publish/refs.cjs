// Publishes only the chosen checkpoints. Entire stores each checkpoint as its own ref
// (refs/entire/checkpoints/<shard>/<id>); its pre-push hook would push all of them, so the push
// names each ref explicitly and bypasses the hook.
const { git } = require('../git.cjs');

async function refFor(repoDir, id) {
  const out = await git(repoDir, ['for-each-ref', '--format=%(refname)', `refs/entire/checkpoints/*/${id}`]);
  return out.trim().split('\n').filter(Boolean)[0] || null;
}

async function pushCheckpoints(repoDir, remote, ids) {
  const refs = [];
  const missing = [];
  for (const id of ids) {
    const ref = await refFor(repoDir, id);
    if (ref) refs.push(ref); else missing.push(id);
  }
  if (missing.length) throw new Error(`No local ref for checkpoint(s): ${missing.join(', ')}`);
  if (!refs.length) return { pushed: [] };
  await git(repoDir, ['push', '--no-verify', remote, ...refs.map((r) => `${r}:${r}`)]);
  return { pushed: refs };
}

module.exports = { refFor, pushCheckpoints };

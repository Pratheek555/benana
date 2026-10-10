// Turns a passed run into a draft pull request on the user's GitHub repo:
// commit the worktree, push the run branch to the checkout's `origin`, open a draft PR.
// The PR body carries the evidence a reviewer needs (graders, intent context, harness arm).
const github = require('./github.cjs');
const { git } = require('./git.cjs');
const budget = require('./budget.cjs');

function body(r) {
  const last = r.verify?.at(-1)?.results || [];
  const lines = [
    r.issue ? `Closes #${r.issue.number}` : null,
    '',
    `Task: ${r.task.split('\n')[0]}`,
    '',
    '### Graders',
    ...last.map((x) => `- ${x.pass ? '✅' : '❌'} ${x.grader}: ${String(x.detail).split('\n')[0].slice(0, 200)}`),
    '',
    r.context?.length ? '### Intent context used' : null,
    ...(r.context || []).map((c) => `- \`${c.id}\` ${c.type}: ${c.title}`),
    '',
    `Run \`${r.id}\` · ${r.kind} · harness v${r.harnessVersion}${r.arm === 'candidate' ? ' (candidate on trial)' : ''} · ${r.verify?.length || 0} attempt(s) · ${budget.runTokens(r).toLocaleString()} tokens`,
    '',
    '_Opened by the benana harness. Review before merging._',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

async function openForRun(r, repo) {
  if (r.status !== 'passed') throw new Error('only passed runs are turned into pull requests');
  if (r.pr?.url) return r.pr;
  if (!r.branch || !r.worktree) throw new Error('run has no branch (resumed sessions are not pushed)');
  await git(r.worktree, ['add', '-A']);
  if ((await git(r.worktree, ['status', '--porcelain'])).trim()) {
    await git(r.worktree, ['-c', 'user.name=benana', '-c', 'user.email=benana@local', 'commit', '-q', '-m', `${r.task.split('\n')[0].slice(0, 70)}\n\nbenana run ${r.id}`]);
  }
  const t = github.token();
  const auth = t ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${t}`).toString('base64')}`] : [];
  await git(r.worktree, [...auth, 'push', '-q', '-u', 'origin', `HEAD:refs/heads/${r.branch}`]);
  const base = await github.defaultBranch(repo);
  const pr = await github.createPullRequest(repo, { head: r.branch, base, title: r.task.split('\n')[0].slice(0, 120), body: body(r) });
  return { url: pr.html_url, number: pr.number };
}

module.exports = { openForRun, body };

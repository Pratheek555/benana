// GitHub REST reads. Public repos work unauthenticated; set GITHUB_TOKEN for private repos and higher limits.
const { execFileSync } = require('node:child_process');
const { env } = require('./env.cjs');
const { fetchRetry } = require('./util.cjs');

// GITHUB_TOKEN wins; otherwise reuse the GitHub CLI login if present.
let cached;
function token() {
  if (env('GITHUB_TOKEN')) return env('GITHUB_TOKEN');
  if (cached === undefined) {
    try { cached = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 }).trim(); } catch { cached = ''; }
  }
  return cached;
}

async function gh(p, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'benana' };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetchRetry(`https://api.github.com${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined }, { retries: method === 'GET' ? 2 : 0 });
  if (!res.ok) throw new Error(`GitHub ${p}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function pages(p, max) {
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const batch = await gh(`${p}${p.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.slice(0, max);
}

async function history(repo, { max = 200 } = {}) {
  const [meta, issues, pulls] = await Promise.all([
    gh(`/repos/${repo}`),
    pages(`/repos/${repo}/issues?state=all&sort=updated`, max),
    pages(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc`, max),
  ]);
  return {
    meta: { name: meta.full_name, description: meta.description, defaultBranch: meta.default_branch },
    issues: issues.filter((i) => !i.pull_request),
    pulls,
  };
}

async function pullFiles(repo, number) {
  try { return (await gh(`/repos/${repo}/pulls/${number}/files?per_page=50`)).map((f) => f.filename); }
  catch { return []; }
}

async function openIssues(repo) {
  return (await gh(`/repos/${repo}/issues?state=open&sort=created&per_page=30`)).filter((i) => !i.pull_request);
}

async function defaultBranch(repo) {
  return (await gh(`/repos/${repo}`)).default_branch;
}

async function createPullRequest(repo, { head, base, title, body, draft = true }) {
  if (!token()) throw new Error('GITHUB_TOKEN (or gh auth login) is required to open pull requests');
  return gh(`/repos/${repo}/pulls`, { method: 'POST', body: { head, base, title, body, draft } });
}

module.exports = { history, pullFiles, openIssues, defaultBranch, createPullRequest, token, authenticated: () => Boolean(token()) };

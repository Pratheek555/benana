// Cloudflare Artifacts adapter: namespaces, repos, forks, scoped tokens, push/pull.
// Kept behind this small interface so the storage backend can be swapped.
const { env } = require('./env.cjs');
const { git } = require('./git.cjs');

const API = 'https://api.cloudflare.com/client/v4';
let accountId = null;

async function cf(method, p, body) {
  const token = env('CLOUDFLARE_API_TOKEN');
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN missing');
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map((e) => e.message).join('; ') || res.statusText;
    const err = new Error(`Artifacts ${method} ${p}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json.result ?? json;
}

async function account() {
  if (accountId) return accountId;
  accountId = env('CLOUDFLARE_ACCOUNT_ID') || (await cf('GET', '/accounts'))[0]?.id;
  if (!accountId) throw new Error('No Cloudflare account visible to this token');
  return accountId;
}

const ns = () => env('ARTIFACTS_NAMESPACE', 'benana-dev');
const base = async () => `/accounts/${await account()}/artifacts`;

async function ensureNamespace() {
  try { await cf('GET', `${await base()}/namespaces/${ns()}`); }
  catch (e) { if (e.status !== 404) throw e; await cf('POST', `${await base()}/namespaces`, { namespace: ns() }); }
}

async function ensureRepo(name, description = '') {
  await ensureNamespace();
  try { return await cf('GET', `${await base()}/namespaces/${ns()}/repos/${name}`); }
  catch (e) { if (e.status !== 404) throw e; return cf('POST', `${await base()}/namespaces/${ns()}/repos`, { name, description }); }
}

async function fork(source, name, { readOnly = false } = {}) {
  return cf('POST', `${await base()}/namespaces/${ns()}/repos/${source}/fork`, {
    name, read_only: readOnly, default_branch_only: false,
  });
}

async function token(repo, scope = 'write', ttl = 600) {
  const r = await cf('POST', `${await base()}/namespaces/${ns()}/tokens`, { repo, scope, ttl });
  return r.token || r.plaintext || r.value;
}

async function readFile(repo, filePath, ref = 'main') {
  const url = `${API}${await base()}/namespaces/${ns()}/repos/${repo}/raw/${ref}/${filePath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env('CLOUDFLARE_API_TOKEN')}` } });
  return res.ok ? res.text() : null;
}

// Push a local store to its Artifacts repo with a short-lived write token.
async function push(store) {
  const repo = await ensureRepo(store.name, `${store.kind} graph for ${store.repo}`);
  const t = await token(store.name, 'write', 300);
  const auth = ['-c', `http.extraHeader=Authorization: Bearer ${t}`];
  try {
    await git(store.dir, [...auth, 'push', '-q', repo.remote, 'HEAD:main']);
  } catch (e) {
    if (!/rejected|fetch first|non-fast-forward/i.test(e.message)) throw e;
    // Someone else (another device or agent) pushed first: merge theirs, then push again.
    await git(store.dir, [...auth, 'pull', '-q', '--no-rebase', '--no-edit', '--allow-unrelated-histories', '-X', 'ours', repo.remote, 'main']);
    await git(store.dir, [...auth, 'push', '-q', repo.remote, 'HEAD:main']);
  }
  return { remote: repo.remote, name: store.name };
}

async function pull(store) {
  const repo = await ensureRepo(store.name);
  const t = await token(store.name, 'read', 120);
  try {
    await git(store.dir, ['-c', `http.extraHeader=Authorization: Bearer ${t}`, 'pull', '-q', '--no-rebase', '--no-edit', '--allow-unrelated-histories', repo.remote, 'main']);
  } catch (e) {
    if (!/couldn't find remote ref|empty/i.test(e.message)) throw e;
  }
}

const configured = () => Boolean(env('CLOUDFLARE_API_TOKEN'));

module.exports = { configured, ensureRepo, fork, token, readFile, push, pull, namespace: ns };

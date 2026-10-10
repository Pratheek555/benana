// Cloudflare Artifacts adapter: namespaces, repos, forks, scoped tokens, push/pull.
// Kept behind this small interface so the storage backend can be swapped.
const { env } = require('./env.cjs');
const { git } = require('./git.cjs');
const { fetchRetry, serial, debounce, sleep } = require('./util.cjs');

const API = 'https://api.cloudflare.com/client/v4';
let accountId = null;

async function cf(method, p, body) {
  const token = env('CLOUDFLARE_API_TOKEN');
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN missing');
  const res = await fetchRetry(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, { retries: method === 'GET' ? 2 : 1 });
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

// Namespace and repo lookups are cached: they never change during a session, and every
// push used to repeat them (3 extra API calls per push).
let nsReady = null;
const repoCache = new Map();

function ensureNamespace() {
  nsReady ||= (async () => {
    try { await cf('GET', `${await base()}/namespaces/${ns()}`); }
    catch (e) { if (e.status !== 404) throw e; await cf('POST', `${await base()}/namespaces`, { namespace: ns() }); }
  })().catch((e) => { nsReady = null; throw e; });
  return nsReady;
}

async function ensureRepo(name, description = '') {
  if (repoCache.has(name)) return repoCache.get(name);
  await ensureNamespace();
  let repo;
  try { repo = await cf('GET', `${await base()}/namespaces/${ns()}/repos/${name}`); }
  catch (e) {
    if (e.status !== 404) throw e;
    try { repo = await cf('POST', `${await base()}/namespaces/${ns()}/repos`, { name, description }); }
    catch (e2) { if (e2.status !== 409) throw e2; repo = await cf('GET', `${await base()}/namespaces/${ns()}/repos/${name}`); }
  }
  repoCache.set(name, repo);
  return repo;
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
  const res = await fetchRetry(url, { headers: { Authorization: `Bearer ${env('CLOUDFLARE_API_TOKEN')}` } });
  return res.ok ? res.text() : null;
}

// Push a local store to its Artifacts repo with a short-lived write token.
// Pushes to the same repo are serialised; a non-fast-forward merges theirs and retries.
let last = null;
function push(store) {
  return serial(`push:${store.name}`, () => pushOnce(store))
    .then((r) => { last = { at: Date.now(), repo: store.name, ok: true }; return r; })
    .catch((e) => { last = { at: Date.now(), repo: store.name, ok: false, error: e.message }; throw e; });
}

async function pushOnce(store) {
  const repo = await ensureRepo(store.name, `${store.kind} graph for ${store.repo}`);
  const t = await token(store.name, 'write', 300);
  const auth = ['-c', `http.extraHeader=Authorization: Bearer ${t}`];
  for (let i = 0; ; i++) {
    try {
      await git(store.dir, [...auth, 'push', '-q', repo.remote, 'HEAD:main']);
      return { remote: repo.remote, name: store.name };
    } catch (e) {
      const behind = /rejected|fetch first|non-fast-forward/i.test(e.message);
      const transient = /timed out|Could not resolve|Connection|reset|50\d/i.test(e.message);
      if (i >= 2 || (!behind && !transient)) throw e;
      // Someone else (another device or agent) pushed first: merge theirs, then push again.
      // Graph files are one-per-node, so real conflicts are rare; on one, keep the local side.
      if (behind) await git(store.dir, [...auth, 'pull', '-q', '--no-rebase', '--no-edit', '--allow-unrelated-histories', '-X', 'ours', repo.remote, 'main']);
      else await sleep(1000 * 2 ** i);
    }
  }
}

// Coalesces bursts (several runs finishing, ingest + checkpoint) into one push per repo.
function schedulePush(store, onError = () => {}, ms = 1500) {
  if (!configured()) return;
  debounce(`push:${store.name}:${store.dir}`, ms, () => push(store).catch(onError));
}

function pull(store) {
  return serial(`push:${store.name}`, () => pullOnce(store));
}

async function pullOnce(store) {
  const repo = await ensureRepo(store.name);
  const t = await token(store.name, 'read', 120);
  try {
    await git(store.dir, ['-c', `http.extraHeader=Authorization: Bearer ${t}`, 'pull', '-q', '--no-rebase', '--no-edit', '--allow-unrelated-histories', repo.remote, 'main']);
  } catch (e) {
    if (!/couldn't find remote ref|empty/i.test(e.message)) throw e;
  }
}

const configured = () => Boolean(env('CLOUDFLARE_API_TOKEN'));

module.exports = { lastPush: () => last, configured, ensureRepo, fork, token, readFile, push, schedulePush, pull, namespace: ns };

// Published mods live on Entire: one public Entire repo per listing (/et/<project>/<slug>).
//   main, marketplace/v<n>        the mod's source at each published version
//   refs/entire/checkpoints/*     the version's checkpoints, sanitized by the publish gate (never the raw local refs)
//   benana/meta                   v<n>/: context.json (spec, test plan, history), evidence bundle, jar
// Anyone signed in to Entire can clone a public repo, so a remixer gets the code, the checkpoints and the context
// from one place, and `entire checkpoint explain` works on the parent's history in their clone.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { env } = require('../env.cjs');
const { git } = require('../git.cjs');

const REMOTE = 'benana-market';
const META = 'refs/heads/benana/meta';
const STAGE = 'refs/benana/publish/'; // sanitized checkpoint refs are built here, then pushed under refs/entire/

function entire(args, { cwd = os.homedir(), timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    execFile(process.env.BENANA_ENTIRE || 'entire', args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ACCESSIBLE: '1' } },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout || ''), err: String(stderr || ''), missing: error?.code === 'ENOENT' }));
  });
}
const fail = (what, r) => new Error(`${what}: ${(r.err || r.out).trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'unknown error'}`);
const json = (text) => { try { return JSON.parse(text); } catch { return null; } };

const project = () => env('BENANA_ENTIRE_PROJECT', 'benana-market');
const repoPath = (slug) => `/et/${project()}/${slug}`;

// { loggedIn, handle, error } from `entire auth status --json`.
async function status() {
  const r = await entire(['auth', 'status', '--json'], { timeout: 20000 });
  if (r.missing) return { loggedIn: false, error: 'The Entire CLI is not installed.' };
  const s = json(r.out);
  if (!r.ok || !s) return { loggedIn: false, error: /not logged in/i.test(r.out + r.err) ? 'Not signed in to Entire. Run `entire login`.' : (r.err || r.out).trim().slice(0, 300) };
  const handle = [s.user?.handle, s.user?.login, s.handle, s.login, s.account?.handle, s.username, s.user].find(value => typeof value === 'string' && value.trim()) || null;
  return { loggedIn: s.logged_in ?? s.loggedIn ?? true, handle, project: project(), raw: s };
}

async function ensureProject() {
  if ((await entire(['project', 'get', project(), '--json'])).ok) return project();
  const who = await status();
  if (!who.loggedIn) throw new Error(who.error || 'Not signed in to Entire.');
  if (!who.handle) throw new Error(`Entire project "${project()}" does not exist and the signed-in account is unknown. Create it with \`entire project create ${project()} --owner github:<you> --owner-type account\`.`);
  const owner = who.handle.includes(':') ? who.handle : `github:${who.handle}`;
  const r = await entire(['project', 'create', project(), '--owner', owner, '--owner-type', 'account', '--json']);
  if (!r.ok) throw fail(`Could not create the Entire project ${project()}`, r);
  return project();
}

// Creates the listing's repo if needed and makes it public (readable by any signed-in Entire user).
async function ensureRepo(slug) {
  const repo = repoPath(slug);
  if (!(await entire(['repo', 'view', repo, '--json'])).ok) {
    await ensureProject();
    const r = await entire(['repo', 'create', slug, '--project', project(), '--json'], { timeout: 11 * 60000 });
    if (!r.ok) throw fail(`Could not create the Entire repo ${repo}`, r);
  }
  // A new repo can take a few seconds to become editable ("not found or not shared with you").
  for (let tries = 0; ; tries++) {
    const vis = await entire(['repo', 'visibility', 'get', repo, '--json']);
    if (/"public"/i.test(vis.out)) return repo;
    const r = await entire(['repo', 'edit', repo, '--visibility', 'public', '--json']);
    if (r.ok) return repo;
    if (tries >= 6) throw fail(`Could not make ${repo} public`, r);
    await new Promise((done) => setTimeout(done, 3000));
  }
}

// Writes `files` ({ 'v1/context.json': absPath, ... }) as a commit on top of `parent` (or a root commit), without touching
// the working tree or the real index.
async function commitFiles(repoDir, { parent, files, message, keep = true }) {
  const index = path.join(os.tmpdir(), `benana-index-${process.pid}-${Date.now()}`);
  const opts = { env: { GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'Benana Mod Studio', GIT_AUTHOR_EMAIL: 'studio@benana.dev', GIT_COMMITTER_NAME: 'Benana Mod Studio', GIT_COMMITTER_EMAIL: 'studio@benana.dev' } };
  try {
    if (parent && keep) await git(repoDir, ['read-tree', parent], opts);
    else await git(repoDir, ['read-tree', '--empty'], opts);
    for (const [rel, abs] of Object.entries(files)) {
      const blob = (await git(repoDir, ['hash-object', '-w', '--no-filters', abs])).trim();
      await git(repoDir, ['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`], opts);
    }
    const tree = (await git(repoDir, ['write-tree'], opts)).trim();
    return (await git(repoDir, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], opts)).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

const walk = (dir, base = dir, out = {}) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, base, out); else out[path.relative(base, f).split(path.sep).join('/')] = f;
  }
  return out;
};

const refExists = (repoDir, ref) => git(repoDir, ['rev-parse', '--verify', '-q', ref]).then((s) => s.trim()).catch(() => null);

// Pushes one version: source, tag, sanitized checkpoints and the meta files. `checkpoints` are the bundle manifest's entries;
// each one's sanitized tree is read from bundleDir/checkpoints/<id>/ref.
async function publishVersion({ repoDir, commit, slug, number, bundleDir, metaFiles, checkpoints, log = () => {} }) {
  const repo = await ensureRepo(slug);
  log(`Entire: pushing ${slug} v${number} to ${repo}`);
  const tag = `refs/tags/marketplace/v${number}`;
  await git(repoDir, ['tag', '-f', `marketplace/v${number}`, commit]);

  // Sanitized checkpoint refs, staged outside refs/entire so the local (raw) ones stay untouched.
  const pushed = [];
  for (const c of checkpoints) {
    const dir = path.join(bundleDir, 'checkpoints', c.id, 'ref');
    if (!c.ref || !fs.existsSync(dir)) continue;
    const stage = STAGE + c.ref.replace(/^refs\//, '');
    const commit = await commitFiles(repoDir, { files: walk(dir), message: `Checkpoint: ${c.id} (published by Benana${c.transcript ? '' : ', metadata only'})` });
    await git(repoDir, ['update-ref', stage, commit]);
    pushed.push({ id: c.id, stage, ref: c.ref, transcript: c.transcript });
  }

  // The meta branch accumulates one folder per version. A first publish to a new repo starts it fresh.
  const remoteMeta = await remoteHas(repoDir, repo, META);
  const parent = remoteMeta ? remoteMeta : null;
  if (parent) await git(repoDir, ['fetch', '-q', '--no-tags', await remoteUrl(repoDir, repo), `+${META}:${STAGE}meta-base`]);
  const base = parent ? await refExists(repoDir, `${STAGE}meta-base`) : null;
  if (parent && base !== parent) throw new Error('The Entire metadata branch changed while publishing. Retry the publish.');
  const metaCommit = await commitFiles(repoDir, { parent: base, files: metaFiles, message: `${slug} v${number}` });
  await git(repoDir, ['update-ref', `${STAGE}meta`, metaCommit]);

  const url = await remoteUrl(repoDir, repo);
  const specs = [`+${commit}:refs/heads/main`, `${tag}:${tag}`, `${STAGE}meta:${META}`, ...pushed.map((p) => `+${p.stage}:${p.ref}`)];
  // --no-verify: Entire's pre-push hook would push every local (unsanitized) checkpoint ref.
  await git(repoDir, ['push', '--no-verify', `--force-with-lease=${META}:${parent || ''}`, url, ...specs]).catch((e) => { throw new Error(`Push to Entire failed: ${e.message.slice(0, 400)}`); });
  return { repo, url, tag: `marketplace/v${number}`, metaCommit, checkpoints: pushed.map(({ id, ref, transcript }) => ({ id, ref, transcript })) };
}

// The git URL for an Entire repo, via `entire repo remote add` (which only edits local config).
async function remoteUrl(repoDir, repo) {
  const has = await git(repoDir, ['remote', 'get-url', REMOTE]).then((s) => s.trim()).catch(() => null);
  if (has && has.endsWith(repo)) return has;
  const r = await entire(['repo', 'remote', 'add', REMOTE, repo, '--override'], { cwd: repoDir });
  if (!r.ok) throw fail(`Could not add the Entire remote for ${repo}`, r);
  return (await git(repoDir, ['remote', 'get-url', REMOTE])).trim();
}

async function remoteHas(repoDir, repo, ref) {
  const url = await remoteUrl(repoDir, repo);
  const out = await git(repoDir, ['ls-remote', url, ref]);
  return out.trim().split(/\s+/)[0] || null;
}

// Clones a published listing into `dir` with its checkpoints and meta branch, ready to check out a version or checkpoint.
async function cloneListing({ repo, dir }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const r = await entire(['repo', 'clone', repo, dir], { timeout: 10 * 60000 });
  if (!r.ok) throw fail(`Could not clone ${repo} from Entire`, r);
  await git(dir, ['fetch', '-q', 'origin', '+refs/entire/checkpoints/*:refs/entire/checkpoints/*', `+${META}:refs/remotes/origin/benana/meta`, '+refs/tags/marketplace/*:refs/tags/marketplace/*']);
  return dir;
}

const readMeta = (dir, rel) => git(dir, ['show', `refs/remotes/origin/benana/meta:${rel}`]).then((s) => JSON.parse(s)).catch(() => null);

module.exports = { status, ensureRepo, publishVersion, cloneListing, readMeta, repoPath, commitFiles, entire, REMOTE, META };

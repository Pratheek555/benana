// The intent repo on disk: one file per node / edge / event, versioned with git.
// Every write is a commit, so every commit is a full snapshot of the graph.
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git.cjs');
const { dataDir } = require('./env.cjs');

const slug = (repo) => repo.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

class RepoStore {
  constructor(kind, repo) {
    this.kind = kind; // 'intent' | 'harness'
    this.repo = repo;
    this.name = `${kind}-${slug(repo)}`;
    this.dir = path.join(dataDir, kind, slug(repo));
  }

  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(path.join(this.dir, '.git'))) {
      await git(this.dir, ['init', '-q', '-b', 'main']);
      await git(this.dir, ['config', 'user.name', 'benana']);
      await git(this.dir, ['config', 'user.email', 'benana@local']);
      fs.writeFileSync(path.join(this.dir, 'README.md'), `# ${this.name}\n\n${this.kind} store for ${this.repo}, managed by benana.\n`);
      await this.commit('init', 'system');
    }
    return this;
  }

  write(rel, content) {
    const file = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }

  remove(rel) {
    fs.rmSync(path.join(this.dir, rel), { force: true });
  }

  read(rel) {
    const file = path.join(this.dir, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  list(relDir) {
    const dir = path.join(this.dir, relDir);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => !fs.statSync(path.join(dir, f)).isDirectory())
      .map((f) => path.join(relDir, f));
  }

  // Commits staged changes; returns the new sha or null when nothing changed.
  async commit(message, actor = 'benana') {
    await git(this.dir, ['add', '-A']);
    const status = await git(this.dir, ['status', '--porcelain']);
    if (!status.trim()) return null;
    await git(this.dir, ['commit', '-q', '-m', `${message}\n\nActor: ${actor}`]);
    return (await git(this.dir, ['rev-parse', 'HEAD'])).trim();
  }

  async log(limit = 200) {
    const out = await git(this.dir, ['log', `-n${limit}`, '--reverse', '--no-merges', '--format=%H%x1f%ct%x1f%s%x1f%b%x1e']);
    return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
      const [sha, ts, subject, body] = r.split('\x1f');
      const actor = (body.match(/Actor: (.+)/) || [])[1] || 'benana';
      return { sha, ts: Number(ts) * 1000, subject, actor };
    });
  }

  // Read every file under relDir as it was at a given commit.
  async readAt(sha, relDir) {
    const names = (await git(this.dir, ['ls-tree', '-r', '--name-only', sha, '--', relDir])).split('\n').filter(Boolean);
    const out = [];
    for (const n of names) out.push([n, await git(this.dir, ['show', `${sha}:${n}`])]);
    return out;
  }
}

module.exports = { RepoStore, slug };

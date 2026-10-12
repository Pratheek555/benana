const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function remoteWith({ auth, git = async () => '' }) {
  const module = { exports: {} };
  const requireStub = name => {
    if (name === '../env.cjs') return { env: (_name, fallback) => fallback };
    if (name === '../git.cjs') return { git };
    if (name === 'node:child_process') return { execFile: (_bin, args, _opts, done) => {
      const out = args[0] === 'auth' ? auth : args.includes('visibility') ? { visibility: 'public' } : {};
      done(null, JSON.stringify(out), '');
    } };
    return require(name);
  };
  const source = fs.readFileSync(path.join(__dirname, '../electron/lib/marketplace/entire-remote.cjs'), 'utf8');
  vm.runInNewContext('(function(require, module, process) {' + source + '\n})', { setTimeout })(requireStub, module, process);
  return module.exports;
}

test('Entire account objects resolve to a string handle', async () => {
  const remote = remoteWith({ auth: { logged_in: true, user: { handle: 'alice' } } });
  assert.equal((await remote.status()).handle, 'alice');
});

test('a failed metadata fetch aborts publishing before any push', async () => {
  let pushes = 0;
  const remote = remoteWith({ git: async (_dir, args) => {
    if (args[0] === 'remote') return 'https://example.test/et/benana-market/example';
    if (args[0] === 'ls-remote') return 'a'.repeat(40) + '\trefs/heads/benana/meta';
    if (args[0] === 'fetch') throw new Error('Metadata fetch failed');
    if (args[0] === 'rev-parse') throw new Error('No staged base');
    if (args[0] === 'push') pushes++;
    return 'b'.repeat(40);
  } });
  await assert.rejects(remote.publishVersion({ repoDir: '.', commit: 'b'.repeat(40), slug: 'example', number: 2, bundleDir: '.', metaFiles: {}, checkpoints: [] }), /Metadata fetch failed/);
  assert.equal(pushes, 0);
});

test('publishing a second version preserves the first version metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benana-remote-'));
  const bare = path.join(dir, 'et', 'benana-market', 'example');
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  const command = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  command(dir, 'init', '-q', '--bare', bare);
  command(work, 'init', '-q');
  command(work, 'config', 'user.name', 'Test');
  command(work, 'config', 'user.email', 'test@example.test');
  command(work, 'remote', 'add', 'benana-market', bare.replaceAll('\\', '/'));
  const remote = remoteWith({ git: require('../electron/lib/git.cjs').git });
  const context = path.join(dir, 'context.json');
  for (const number of [1, 2]) {
    fs.writeFileSync(path.join(work, 'mod.txt'), `Version ${number}`);
    command(work, 'add', '.');
    command(work, 'commit', '-qm', `Version ${number}`);
    fs.writeFileSync(context, JSON.stringify({ version: number }));
    await remote.publishVersion({ repoDir: work, commit: command(work, 'rev-parse', 'HEAD'), slug: 'example', number, bundleDir: dir, metaFiles: { [`v${number}/context.json`]: context }, checkpoints: [] });
  }
  assert.equal(command(bare, 'show', 'refs/heads/benana/meta:v1/context.json'), '{"version":1}');
  assert.equal(command(bare, 'show', 'refs/heads/benana/meta:v2/context.json'), '{"version":2}');
});

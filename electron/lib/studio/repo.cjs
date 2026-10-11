// Mod repositories: one git repo per mod, created from templates/paper-plugin, with Entire and Neatlogs
// hooks installed at project scope so every agent session in the repo is checkpointed and traced.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { appRoot, dataDir, env } = require('../env.cjs');
const { resolveExecutable } = require('../processes.cjs');
const pack = require('./pack.cjs');

const TEMPLATE = path.join(appRoot, 'templates', 'paper-plugin');
const modsDir = path.join(dataDir, 'mods');

function exec(cmd, args, cwd, { timeoutMs = 120000, input } = {}) {
  return new Promise((resolve) => {
    const bin = resolveExecutable(cmd);
    // npm and Maven install .cmd shims on Windows, which only run through a shell. Their args here have no spaces.
    const shell = /\.(cmd|bat)$/i.test(bin);
    const child = execFile(shell ? `"${bin}"` : bin, args, { cwd, shell, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, ACCESSIBLE: '1' } },
      (error, stdout, stderr) => resolve({
        ok: !error,
        code: error?.code ?? 0,
        out: String(stdout || ''),
        err: String(stderr || error?.message || ''),
        missing: error?.code === 'ENOENT',
      }));
    child.stdin.end(input ?? '');
  });
}

const git = (cwd, ...args) => exec('git', args, cwd);

function fill(text, vars) {
  return text.replace(/__(NAME|ARTIFACT|SUMMARY)__/g, (_, k) => vars[k]);
}

function copyTemplate(dir, vars) {
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name);
      const name = entry.name === 'gitignore' ? '.gitignore' : fill(entry.name, vars);
      const to = path.join(dst, name);
      if (entry.isDirectory()) walk(from, to);
      else fs.writeFileSync(to, fill(fs.readFileSync(from, 'utf8'), vars));
    }
  };
  walk(TEMPLATE, dir);
}

// Creates the repo and installs partner hooks. Returns which integrations are active.
// Installs Neatlogs' Claude Code hooks in a directory, so every agent session started there is traced.
async function enableNeatlogs(dir) {
  const key = env('NEATLOGS_INGEST_KEY') || env('NEATLOGS_API_KEY');
  if (!key) return { enabled: false, error: 'Set NEATLOGS_INGEST_KEY (or NEATLOGS_API_KEY) in .env to trace agent sessions.' };
  const nl = await exec('neatlogs-claude-code', ['setup', '--project', '--api-key', key], dir, { timeoutMs: 60000 });
  return nl.ok ? { enabled: true } : { enabled: false, error: (nl.missing ? 'neatlogs-claude-code is not installed.' : nl.err || nl.out).trim().slice(0, 400) };
}

async function create({ slug, name, summary }) {
  const dir = path.join(modsDir, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  copyTemplate(dir, { NAME: name, ARTIFACT: slug, SUMMARY: summary.replace(/\r?\n/g, ' ').slice(0, 200) });
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.name', 'Benana Mod Studio');
  await git(dir, 'config', 'user.email', 'studio@benana.dev');
  await git(dir, 'config', 'core.autocrlf', 'false');

  const partners = { entire: { enabled: false }, neatlogs: { enabled: false } };

  const ent = await exec('entire', ['enable', '--agent', 'claude-code', '--project'], dir, { timeoutMs: 60000 });
  if (ent.ok) {
    const file = path.join(dir, '.entire', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Benana commits each attempt from a non-interactive process; prompting would hang the commit hook.
    Object.assign(settings, { commit_linking: 'always', telemetry: false });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    partners.entire = { enabled: true };
  } else {
    partners.entire = { enabled: false, error: ent.missing ? 'Entire CLI is not installed.' : (ent.err || ent.out).trim().slice(0, 400) };
  }

  partners.neatlogs = await enableNeatlogs(dir);

  await commit(dir, `Scaffold ${name} from the Benana Paper template`);
  return { dir, partners };
}

async function commit(dir, message) {
  await git(dir, 'add', '-A');
  const res = await git(dir, 'commit', '-q', '--allow-empty', '-m', message);
  const sha = (await git(dir, 'rev-parse', 'HEAD')).out.trim();
  const trailer = (await git(dir, 'log', '-1', '--format=%(trailers:key=Entire-Checkpoint,valueonly)')).out.trim();
  return { ok: res.ok, sha, checkpoint: trailer || null, error: res.ok ? null : res.err.trim() };
}

async function checkpoints(dir) {
  const res = await exec('entire', ['checkpoint', 'list', '--json', '--no-pager'], dir, { timeoutMs: 30000 });
  if (!res.ok) return { ok: false, items: [], error: (res.err || res.out).trim().slice(0, 400) };
  try { return { ok: true, items: JSON.parse(res.out) }; } catch { return { ok: false, items: [], error: 'Unrecognized checkpoint output.' }; }
}

async function history(dir) {
  return (await git(dir, 'log', '--format=%h %s%n%(trailers:key=Entire-Checkpoint)', '-20')).out.trim();
}

async function files(dir) {
  const res = await git(dir, 'ls-files', '-z');
  return res.out.split('\0').filter(Boolean);
}

async function readFile(dir, rel) {
  if (!(await files(dir)).includes(rel)) throw new Error('Not a tracked file in this mod repository.');
  return fs.readFileSync(path.join(dir, rel), 'utf8').slice(0, 200000);
}

async function diff(dir, sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha || '')) throw new Error('Unknown commit.');
  return (await git(dir, 'show', '--format=%s%n%n%b', '--patch', '--no-color', sha)).out.slice(0, 200000);
}

async function build(dir, name) {
  const res = await exec('mvn', ['-q', '-B', 'package'], dir, { timeoutMs: 6 * 60 * 1000 });
  const log = `${res.out}\n${res.err}`.trim();
  const jar = path.join(dir, 'target', `${name}.jar`);
  if (res.missing) return { ok: false, jar: null, log: 'Maven (mvn) is not on PATH.' };
  const ok = res.ok && fs.existsSync(jar);
  // The resource pack is checked even when Maven fails, so one fixer pass sees every problem.
  const p = pack.build(dir, path.join(dir, 'target', `${name}-pack.zip`));
  const assets = { ok: p.ok, errors: p.errors, warnings: p.warnings, items: p.assets, zip: p.zip };
  return { ok, jar: fs.existsSync(jar) ? jar : null, log: log.slice(-12000), assets };
}

module.exports = { modsDir, create, enableNeatlogs, commit, checkpoints, history, files, readFile, diff, build };

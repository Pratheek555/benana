#!/usr/bin/env node
// Replays a fixed benchmark against pinned harness versions and reports per-version numbers.
//   node scripts/eval.cjs --repo owner/name --path /local/checkout --versions 1,3 --trials 2 [--concurrency 3]
// Each run gets a fresh copy of the intent graph (no memory leaks between runs or versions),
// Artifacts sync is off, and results go to ~/.benana-evals so live run stats stay clean.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const liveDir = path.join(os.homedir(), '.benana');
process.env.BENANA_DATA_DIR = arg('data', path.join(os.homedir(), '.benana-evals'));
process.env.CLOUDFLARE_API_TOKEN = ''; // never push eval runs to the shared intent repo

const lib = path.join(__dirname, '..', 'electron', 'lib');
const { git } = require(path.join(lib, 'git.cjs'));
const { RepoStore, slug } = require(path.join(lib, 'store.cjs'));
const agents = require(path.join(lib, 'agents.cjs'));
const improve = require(path.join(lib, 'improve.cjs'));
const tracing = require(path.join(lib, 'tracing.cjs'));

const repo = arg('repo');
const repoPath = arg('path');
const versions = arg('versions', '1').split(',').map(Number);
const trials = Number(arg('trials', 1));
const concurrency = Number(arg('concurrency', 3));
const only = arg('tasks');

const harnessDir = path.join(liveDir, 'harness', slug(repo));
const intentDir = path.join(liveDir, 'intent', slug(repo));
const evalId = `e${Date.now().toString(36)}`;
const outDir = path.join(process.env.BENANA_DATA_DIR, 'evals', evalId);

async function harnessAt(version) {
  const log = await git(harnessDir, ['log', '--format=%H%x1f%s']);
  const line = log.split('\n').find((l) => new RegExp(`\\x1fharness v${version}(:| )`).test(l));
  if (!line) throw new Error(`harness v${version} not found`);
  return JSON.parse(await git(harnessDir, ['show', `${line.split('\x1f')[0]}:harness.json`]));
}

async function freshIntent(name) {
  const dir = path.join(outDir, 'intent', name);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(outDir, ['clone', '-q', intentDir, dir]);
  await git(dir, ['config', 'user.name', 'benana-eval']);
  await git(dir, ['config', 'user.email', 'eval@benana.local']);
  return Object.assign(Object.create(RepoStore.prototype), { kind: 'intent', repo, name: `intent-${slug(repo)}`, dir });
}

async function main() {
  const bench = JSON.parse(fs.readFileSync(path.join(harnessDir, 'benchmark.json'), 'utf8'));
  const tasks = bench.tasks.filter((t) => !only || only.split(',').includes(t.id));
  const harnesses = Object.fromEntries(await Promise.all(versions.map(async (v) => [v, await harnessAt(v)])));
  fs.mkdirSync(outDir, { recursive: true });
  await tracing.init();

  const jobs = [];
  for (const t of tasks) for (const v of versions) for (let i = 1; i <= trials; i++) jobs.push({ t, v, i });
  console.log(`${evalId}: ${tasks.length} tasks × v${versions.join(',v')} × ${trials} trials = ${jobs.length} runs`);

  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { t, v, i } = jobs[next++];
      const label = `${evalId}/${t.id}/v${v}/${i}`;
      const intent = await freshIntent(`${t.id}-v${v}-${i}`);
      const ctx = { repo, repoPath, intent, harnessStore: null };
      try {
        const r = await agents.start({ ctx, task: t.task, issue: t.issue || null, harness: harnesses[v], label }, () => {});
        const full = agents.get(r.id);
        results.push({ task: t.id, kind: t.kind, version: v, trial: i, ...pick(full) });
        console.log(`${label}: ${full.status} in ${full.verify.length} attempt(s), $${(full.usage?.costUsd || 0).toFixed(2)}`);
      } catch (e) {
        results.push({ task: t.id, kind: t.kind, version: v, trial: i, error: e.message });
        console.log(`${label}: error ${e.message}`);
      }
      fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const ok = results.filter((r) => !r.error);
  const report = { evalId, repo, versions, trials, at: Date.now(), stats: improve.stats(ok.map((r) => ({ ...r, harnessVersion: r.version }))), results };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.stats.byVersion, null, 2));
  console.log(`report: ${path.join(outDir, 'report.json')}`);
  await tracing.shutdown();
}

const pick = (r) => ({
  id: r.id, status: r.status, verify: r.verify, usage: r.usage, filesChanged: r.filesChanged,
  conflicts: (r.conflicts || []).map((c) => c.node), traceIds: r.traceIds, commit: r.commit || null,
  entireCheckpoint: r.entireCheckpoint || null, final: (r.final || '').slice(0, 600),
});

main().catch((e) => { console.error(e); process.exit(1); });

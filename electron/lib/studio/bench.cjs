// Benana Bench: fixed mod requests with hidden in-game checks. The spec agent writes its own test plan as usual; after the
// pipeline finishes, a grader playtests the final build against the task's gold checks, which no building agent ever sees.
// The score over repeated runs shows whether the builder (its prompts, tools and lessons) is getting better.
const fs = require('node:fs');
const path = require('node:path');
const { appRoot, dataDir } = require('../env.cjs');

const tasksDir = path.join(appRoot, 'bench');
const benchDir = path.join(dataDir, 'bench');
const resultsFile = path.join(benchDir, 'results.json');

function tasks() {
  if (!fs.existsSync(tasksDir)) return [];
  return fs.readdirSync(tasksDir)
    .map((d) => path.join(tasksDir, d, 'task.json'))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}

function task(id) {
  const t = tasks().find((x) => x.id === id);
  if (!t) throw new Error(`Unknown benchmark task ${id}.`);
  return t;
}

// The task's hidden checks as a test plan for the grader, named after the plugin that was built.
function goldPlan(t, mod) {
  return { version: 1, modName: mod.name, summary: mod.spec?.summary || t.summary, setup: t.gold.setup || [], checks: t.gold.checks.map(({ capability, ...c }) => c) };
}

// The asset check Benana runs itself: the final build ships a valid pack whose textures the code actually uses.
function assetCheck(t, build) {
  const a = build?.assets;
  const items = (a?.items || []).filter((i) => i.texture);
  const min = t.assets?.min ?? 1;
  const ok = Boolean(build?.ok && a?.ok && items.length >= min && !(a.warnings || []).some((w) => /no setItemModel/.test(w)));
  return {
    id: 'assets',
    capability: t.assets?.capability || 'asset',
    title: `Ships at least ${min} generated item texture${min === 1 ? '' : 's'} wired into the code`,
    status: ok ? 'pass' : 'fail',
    expected: `A valid resource pack with ${min}+ item texture(s), each used by setItemModel`,
    observed: !build?.ok ? 'No successful build.' : !a ? 'No asset report.' : a.errors?.length ? a.errors.join(' · ') : `${items.length} texture(s): ${items.map((i) => i.id).join(', ') || 'none'}${a.warnings?.length ? ` · ${a.warnings.join(' · ')}` : ''}`,
    by: 'benana',
  };
}

/** Scores a grader verdict (or none, when nothing built) against the task. */
function score(t, verdict, build) {
  const byId = new Map((verdict?.checks || []).map((c) => [c.id, c]));
  const checks = t.gold.checks.map((g) => {
    const v = byId.get(g.id);
    return {
      id: g.id,
      capability: g.capability,
      title: g.title,
      status: v?.status || 'blocked',
      expected: v?.expected || g.expect,
      observed: v?.observed || (build?.ok ? 'The grader did not report this check.' : 'Nothing was built, so it could not be tested.'),
      ...(v?.suspectedCause ? { suspectedCause: v.suspectedCause } : {}),
      by: 'grader',
    };
  });
  if (t.assets) checks.push(assetCheck(t, build));
  const passed = checks.filter((c) => c.status === 'pass').length;
  return { checks, passed, total: checks.length, score: checks.length ? passed / checks.length : 0 };
}

function results() {
  try { return JSON.parse(fs.readFileSync(resultsFile, 'utf8')); } catch { return []; }
}

function record(result) {
  const all = results().filter((r) => r.id !== result.id);
  all.push(result);
  fs.mkdirSync(benchDir, { recursive: true });
  fs.writeFileSync(resultsFile, JSON.stringify(all, null, 2));
  return result;
}

module.exports = { tasks, task, goldPlan, score, results, record, benchDir };

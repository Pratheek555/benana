// Mod Studio pipeline: prompt -> spec/test plan -> build -> deploy -> playtest -> fix -> retry.
// Interface with the game runtime: docs/hackathon/CONTRACTS.md.
const fs = require('node:fs');
const path = require('node:path');
const { appRoot, dataDir } = require('../env.cjs');
const game = require('../game/index.cjs');
const neatlogs = require('../neatlogs.cjs');
const repo = require('./repo.cjs');
const entire = require('../entire.cjs');
const prompts = require('./prompts.cjs');
const bench = require('./bench.cjs');
const { runClaude, MODELS } = require('./claude.cjs');

const MAX_ATTEMPTS = 3;
const studioDir = path.join(dataDir, 'studio');
const lessonsFile = path.join(studioDir, 'lessons.json');
const SEEDED = path.join(appRoot, 'fixtures', 'seeded');

const mods = new Map();
let active = null; // { modId, stop }
let emit = () => {};
let log = () => {};

const now = () => Date.now();
const modFile = (id) => path.join(studioDir, id, 'mod.json');

const latestBuild = (mod) => [...mod.attempts].reverse().find((a) => a.build?.ok && a.build.jar && fs.existsSync(a.build.jar))?.build || null;

// The newest jar this mod built (Maven overwrites target/<Name>.jar on every attempt).
function jarOf(mod) {
  const built = latestBuild(mod);
  if (built) return built.jar;
  const fallback = mod.repoDir && path.join(mod.repoDir, 'target', `${mod.name}.jar`);
  return fallback && fs.existsSync(fallback) ? fallback : null;
}

// The resource pack that goes with the newest jar, if that build drew any assets.
function packOf(mod) {
  const zip = latestBuild(mod)?.assets?.zip;
  return zip && fs.existsSync(zip) ? zip : null;
}

function publicMod(mod) {
  const { feed, ...rest } = mod;
  const jar = jarOf(mod);
  return { ...rest, feedCount: feed.length, running: active?.modId === mod.id, loadable: Boolean(jar), jar };
}

// Whether this mod's build is the one installed on the server (two mods can share a plugin name, so compare jars).
function isLoaded(mod) {
  const deployed = game.status().deployed;
  const jar = jarOf(mod);
  return Boolean(deployed && jar && (deployed.jar ? deployed.jar === jar : deployed.plugin === mod.name));
}

let saveTimers = new Map();
function save(mod) {
  mod.updatedAt = now();
  emit('studio:mod', publicMod(mod));
  clearTimeout(saveTimers.get(mod.id));
  saveTimers.set(mod.id, setTimeout(() => {
    fs.mkdirSync(path.dirname(modFile(mod.id)), { recursive: true });
    fs.writeFileSync(modFile(mod.id), JSON.stringify(mod, null, 2));
  }, 300));
}

function load() {
  if (!fs.existsSync(studioDir)) return;
  for (const id of fs.readdirSync(studioDir)) {
    try {
      const mod = JSON.parse(fs.readFileSync(modFile(id), 'utf8'));
      if (!['passed', 'failed', 'stopped'].includes(mod.status)) mod.status = 'stopped';
      // Attempts left "running" by an interrupted app are closed, so the timeline never shows ghost runs.
      for (const a of mod.attempts || []) if (a.status === 'running') { a.status = 'stopped'; a.failure ||= { kind: 'interrupted', summary: 'The app stopped before this attempt finished.' }; }
      if (mod.repoDir) repo.lockSessionPush?.(mod.repoDir);
      // Mods saved before chats had turns: their one request is the first turn.
      mod.turns ||= [{ prompt: mod.prompt, at: mod.createdAt, summary: mod.spec?.summary, checks: mod.testPlan?.checks, endPhase: mod.phase }];
      const last = mod.turns.at(-1);
      last.status ||= mod.status;
      last.endPhase ||= mod.phase;
      mods.set(mod.id, mod);
    } catch {}
  }
}

function feed(mod, entry) {
  const item = { at: now(), ...entry };
  mod.feed.push(item);
  if (mod.feed.length > 1500) mod.feed.splice(0, 300);
  emit('studio:feed', { modId: mod.id, item });
}

function setPhase(mod, phase, text) {
  mod.phase = phase;
  if (text) feed(mod, { role: 'benana', kind: 'phase', phase, text });
  save(mod);
}

function lessons() {
  try { return JSON.parse(fs.readFileSync(lessonsFile, 'utf8')); } catch { return []; }
}

// Lessons that share most of their words are the same lesson; keep the first one.
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
function similar(a, b) {
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.min(x.size, y.size)) > 0.7;
}

function addLesson(lesson, mod, source = 'fixer') {
  const all = lessons();
  if (all.some((l) => similar(l.lesson, lesson))) return false;
  all.push({ lesson, mod: mod.name, source, at: now() });
  fs.mkdirSync(studioDir, { recursive: true });
  fs.writeFileSync(lessonsFile, JSON.stringify(all.slice(-30), null, 2));
  return true;
}

function parseJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

const slugify = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 32);

// Runs one agent session for a mod and records it on the attempt.
async function agent(mod, attempt, role, options) {
  const session = { role, turn: mod.turns.length - 1, model: options.model, startedAt: now(), sessionId: null };
  if (attempt) attempt.sessions.push(session);
  else mod.sessions.push(session);
  save(mod);
  const handle = runClaude({
    ...options,
    onEvent: (ev) => {
      if (ev.kind === 'session') { session.sessionId = ev.sessionId; save(mod); return; }
      feed(mod, { attempt: attempt?.n ?? 0, role, ...ev, input: undefined });
      if (role === 'playtester' && ev.kind === 'tool') emit('studio:playtester', { modId: mod.id, tool: ev.name, input: ev.input });
    },
  });
  active.stop = handle.stop;
  const result = await handle.done;
  Object.assign(session, { endedAt: now(), ok: result.ok, error: result.error, usage: result.usage, sessionId: result.sessionId || session.sessionId });
  save(mod);
  if (active?.stopped) throw new Error('Stopped by user.');
  return result;
}

async function specPhase(mod, turn) {
  if (mod.seed && !turn.revision) {
    const seeded = JSON.parse(fs.readFileSync(path.join(SEEDED, 'spec.json'), 'utf8'));
    feed(mod, { role: 'benana', kind: 'note', text: 'Seeded bug fallback: using the labeled LaunchSword fixture spec instead of the spec agent.' });
    return seeded;
  }
  const work = path.join(studioDir, mod.id, 'spec');
  fs.mkdirSync(work, { recursive: true });
  // The spec agent runs before the mod repo exists, so it gets its own Neatlogs hooks.
  if (!fs.existsSync(path.join(work, '.claude', 'settings.json'))) await repo.enableNeatlogs(work);
  const prompt = turn.revision ? prompts.specRevision({ mod, request: turn.prompt }) : prompts.spec(prompts.requestOf(mod));
  const res = await agent(mod, null, 'spec', { cwd: work, prompt, model: MODELS.build, tools: [] });
  if (!res.ok) throw new Error(`Spec agent failed: ${res.error}`);
  const spec = parseJson(res.final);
  // A revised plugin keeps the name its repository, jar and main class already use.
  if (turn.revision) spec.modName = mod.name;
  else if (!/^[A-Za-z]{2,24}$/.test(spec.modName || '')) spec.modName = 'StudioMod';
  if (!spec.testPlan?.checks?.length) throw new Error('Spec agent returned no test checks.');
  spec.testPlan.modName = spec.modName;
  return spec;
}

// The hooks ship spans while a session runs, but the trace only finalizes shortly after it ends, so wait for it.
const TRACE_WAIT_MS = 90 * 1000;
async function playtestTrace(sessionId, wait = TRACE_WAIT_MS) {
  if (!neatlogs.configured()) return { state: 'unconfigured' };
  if (!sessionId) return { state: 'missing' };
  const until = now() + wait;
  let ev;
  for (;;) {
    ev = await neatlogs.evidence({ sessionId }).catch((e) => ({ matched: false, error: e.message }));
    if ((ev.matched && ev.traces[0].summary.finalized) || now() >= until || active?.stopped) break;
    await new Promise((r) => setTimeout(r, 8000));
  }
  if (!ev.matched) return { state: ev.error ? 'error' : 'notfound', error: ev.error };
  const t = ev.traces[0];
  const s = t.summary;
  const text = [
    `trace ${s.traceId} · ${s.status} · ${s.spans} spans · ${s.toolCalls} tool calls · ${s.errors.length} failed`,
    ...s.sequence.map((x) => `  - ${x.name}${x.n > 1 ? ` x${x.n}` : ''}${x.error ? ' (error)' : ''}`),
  ].join('\n').slice(0, 4000);
  return { state: 'read', sessionId, summary: s, text };
}

async function codePhase(mod, attempt, previous) {
  if (attempt.role === 'seeded') {
    fs.copyFileSync(path.join(SEEDED, 'LaunchSword.java'), path.join(mod.repoDir, 'src', 'main', 'java', 'dev', 'benana', 'mod', 'LaunchSword.java'));
    feed(mod, { attempt: attempt.n, role: 'benana', kind: 'note', text: 'Seeded bug fallback: attempt 1 uses the labeled fixture source (velocity set inside the damage event).' });
    return;
  }
  await Promise.resolve(repo.graphGuide?.(mod.repoDir)).catch(() => {});
  const lessonList = lessons().map((l) => l.lesson);
  if (attempt.role === 'builder') {
    const prompt = attempt.revision
      ? prompts.reviser({ mod, attempt, request: mod.turns[attempt.turn].prompt, lessons: lessonList })
      : prompts.builder({ mod, lessons: lessonList });
    const res = await agent(mod, attempt, 'builder', { cwd: mod.repoDir, prompt, model: MODELS.build, tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'], allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'] });
    if (!res.ok) throw new Error(`Builder failed: ${res.error}`);
    attempt.summary = res.final.slice(0, 2000);
    return;
  }
  // The chat shows this handoff as a card that fills in once the trace is read.
  const playtester = previous.sessions.filter((s) => s.role === 'playtester').at(-1);
  attempt.context = { from: previous.n, neatlogs: { state: 'waiting', sessionId: playtester?.sessionId || null } };
  feed(mod, { attempt: attempt.n, role: 'benana', kind: 'handoff', from: previous.n });
  save(mod);
  const [cps, nl, history] = await Promise.all([
    repo.checkpoints(mod.repoDir),
    playtestTrace(playtester?.sessionId).catch((e) => ({ state: 'error', error: e.message })),
    repo.history(mod.repoDir),
  ]);
  const context = {
    history,
    checkpoints: cps.ok ? cps.items.slice(0, 8).map((c) => `${c.checkpoint_id} "${c.message}" session ${c.session_id} (${c.agent})`).join('\n') : '',
    trace: nl.text || '',
  };
  const neatlogsRead = { ...nl };
  delete neatlogsRead.text;
  attempt.context = {
    from: previous.n,
    entireCheckpoints: cps.ok ? cps.items.length : 0,
    checkpoints: cps.ok ? cps.items.slice(0, 3).map((c) => ({ id: c.checkpoint_id, message: c.message })) : [],
    neatlogsTrace: Boolean(context.trace),
    neatlogs: { sessionId: playtester?.sessionId || null, ...neatlogsRead },
  };
  save(mod);
  const res = await agent(mod, attempt, 'fixer', { cwd: mod.repoDir, prompt: prompts.fixer({ mod, attempt, previous, context }), model: MODELS.build, tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'], allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'] });
  if (!res.ok) throw new Error(`Fixer failed: ${res.error}`);
  attempt.summary = res.final.slice(0, 2000);
  const lesson = res.final.match(/^LESSON:\s*(.+)$/m);
  if (lesson) attempt.lesson = lesson[1].trim();
}

async function playtestPhase(mod, attempt) {
  const dir = path.join(mod.repoDir, 'playtest', `attempt-${attempt.n}`);
  return playtestRun(mod, attempt, {
    plan: mod.testPlan, role: 'playtester', cwd: mod.repoDir, runId: `${mod.id}_${attempt.n}`,
    verdictFile: path.join(dir, 'verdict.json'),
    testPlanFile: path.join(mod.repoDir, 'playtest', 'test-plan.json'),
    mcpFile: path.join(studioDir, mod.id, `mcp-attempt-${attempt.n}.json`),
    onLive: (v) => { attempt.verdict = v; },
  });
}

// One in-game test session against a plan: the pipeline's playtester, or the benchmark grader with the hidden plan.
async function playtestRun(mod, attempt, { plan, role, cwd, runId, verdictFile, testPlanFile, mcpFile, onLive = () => {} }) {
  fs.mkdirSync(path.dirname(verdictFile), { recursive: true });
  fs.rmSync(verdictFile, { force: true });
  const n = attempt?.n ?? 0;

  if (game.status().mock) {
    const v = game.mockVerdict(plan, role === 'grader' ? 2 : n);
    fs.writeFileSync(verdictFile, JSON.stringify(v, null, 2));
    feed(mod, { attempt: n, role, kind: 'note', text: '[mock runtime] canned verdict' });
    return game.readVerdict(verdictFile, plan);
  }

  for (let run = 1; run <= 2; run++) {
    fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
    fs.writeFileSync(mcpFile, JSON.stringify(game.mcpConfig({ runId, verdictFile, testPlanFile })));
    const poll = setInterval(() => {
      if (!fs.existsSync(verdictFile)) return;
      onLive({ ...game.readVerdict(verdictFile, plan), live: true });
      save(mod);
    }, 1000);
    try {
      await agent(mod, attempt, role, { cwd, prompt: game.playtestPrompt(plan), model: MODELS.playtest, tools: [], allowedTools: game.playtesterTools, mcpConfigFile: mcpFile });
    } finally {
      clearInterval(poll);
    }
    const verdict = game.readVerdict(verdictFile, plan);
    if (verdict.finished) return verdict;
    feed(mod, { attempt: n, role: 'benana', kind: 'note', text: run === 1 ? `The ${role} stopped before finishing; running it again.` : `The ${role} did not finish the test plan.` });
  }
  return game.readVerdict(verdictFile, plan);
}

// Attempt numbers run across the whole chat (playtest folders and the UI key on them); `previous` is null for a turn's first attempt.
async function runAttempt(mod, turnIndex, n, previous) {
  const turn = mod.turns[turnIndex];
  const first = !previous;
  const attempt = {
    n, turn: turnIndex, revision: first && Boolean(turn.revision),
    role: !first ? 'fixer' : mod.seed && !turn.revision ? 'seeded' : 'builder',
    status: 'running', startedAt: now(), sessions: [],
  };
  mod.attempts.push(attempt);
  save(mod);

  setPhase(mod, first ? 'build' : 'fix', !first ? `Attempt ${n}: fixing what the playtester found` : `Attempt ${n}: ${attempt.revision ? 'changing' : 'writing'} ${mod.name}`);
  await codePhase(mod, attempt, previous);

  setPhase(mod, 'compile', `Attempt ${n}: compiling with Maven and packing assets`);
  attempt.build = await repo.build(mod.repoDir, mod.name);
  const assets = attempt.build.assets;
  if (assets?.items?.length || assets?.errors?.length) {
    feed(mod, { attempt: n, role: 'benana', kind: 'assets', items: assets.items, errors: assets.errors, warnings: assets.warnings, text: `${assets.items.length} asset(s) drawn${assets.errors.length ? `, ${assets.errors.length} problem(s)` : ''}` });
  }
  if (!attempt.build.ok) {
    attempt.failure = { kind: 'build', summary: 'The plugin did not compile.' };
    attempt.commit = await repo.commit(mod.repoDir, `Attempt ${n} (${attempt.role}): build failed`);
    return attempt;
  }
  if (assets && !assets.ok) {
    attempt.failure = { kind: 'assets', summary: `The resource pack is broken: ${assets.errors[0]}${assets.errors.length > 1 ? ` (+${assets.errors.length - 1} more)` : ''}` };
    attempt.commit = await repo.commit(mod.repoDir, `Attempt ${n} (${attempt.role}): broken assets`);
    return attempt;
  }
  const did = attempt.role === 'fixer' ? `fix ${mod.name} from playtest evidence` : attempt.revision ? `change ${mod.name}: ${turn.prompt.replace(/\s+/g, ' ').slice(0, 72)}` : `implement ${mod.name}`;
  attempt.commit = await repo.commit(mod.repoDir, `Attempt ${n} (${attempt.role}): ${did}`);
  feed(mod, { attempt: n, role: 'benana', kind: 'note', text: `Committed ${attempt.commit.sha.slice(0, 7)}${attempt.commit.checkpoint ? `, Entire checkpoint ${attempt.commit.checkpoint}` : ''}` });
  // An agent commit without a checkpoint has no record of the work behind it: say so, don't hide it.
  if (!attempt.commit.checkpoint && mod.partners?.entire?.enabled) {
    attempt.provenanceMissing = true;
    feed(mod, { attempt: n, role: 'benana', kind: 'failure', text: `Entire did not link commit ${attempt.commit.sha.slice(0, 7)} to the agent session, so this attempt has no checkpoint.` });
  }

  setPhase(mod, 'deploy', `Attempt ${n}: deploying to the Paper server`);
  attempt.deploy = await game.deployPlugin({ jarPath: attempt.build.jar, packPath: assets?.zip || null, emit });
  if (!attempt.deploy.loaded) {
    attempt.failure = { kind: 'load', summary: 'The plugin did not load on the server.' };
    return attempt;
  }

  setPhase(mod, 'playtest', `Attempt ${n}: the AI player is testing ${mod.name} in-game`);
  attempt.verdict = await playtestPhase(mod, attempt);
  const tally = attempt.verdict.checks.map((c) => `${c.id}=${c.status}`).join(', ');
  attempt.playtestCommit = await repo.commit(mod.repoDir, `Playtest attempt ${n}: ${attempt.verdict.passed ? 'PASS' : 'FAIL'}${tally ? ` (${tally})` : ''}`);
  if (!attempt.verdict.passed) {
    const failed = attempt.verdict.checks.filter((c) => c.status !== 'pass');
    attempt.failure = attempt.verdict.finished
      ? { kind: 'playtest', summary: failed.length ? failed.map((c) => `${c.id}: ${c.observed}`).join(' · ') : `${attempt.verdict.serverErrors.length} server error(s)` }
      : { kind: 'playtest', summary: attempt.verdict.error || 'The playtester did not finish.' };
  }
  return attempt;
}

// Benchmark grading: redeploy the final build on a fresh world, run the task's hidden checks with a grader session outside the
// mod repo (so no building agent can read them), score it, and have a coach turn the failures into lessons for future builders.
async function benchPhase(mod) {
  const task = bench.task(mod.bench.taskId);
  const started = now();
  const dir = path.join(studioDir, mod.id, 'bench');
  fs.mkdirSync(dir, { recursive: true });
  const build = latestBuild(mod);
  const plan = bench.goldPlan(task, mod);
  let verdict = null;
  if (build) {
    setPhase(mod, 'bench', `Benchmark: grading ${mod.name} with ${task.gold.checks.length} hidden checks`);
    const deploy = await game.deployPlugin({ jarPath: build.jar, packPath: packOf(mod), emit });
    if (deploy.loaded) {
      const testPlanFile = path.join(dir, 'test-plan.json');
      fs.writeFileSync(testPlanFile, JSON.stringify(plan, null, 2));
      verdict = await playtestRun(mod, null, {
        plan, role: 'grader', cwd: dir, runId: `${mod.id}_bench`,
        verdictFile: path.join(dir, 'verdict.json'), testPlanFile, mcpFile: path.join(dir, 'mcp.json'),
      });
    }
  }
  const scored = bench.score(task, verdict, build);
  const turnSessions = [...mod.sessions, ...mod.attempts.flatMap((a) => a.sessions)];
  const result = {
    id: `${mod.id}_bench`, taskId: task.id, modId: mod.id, modName: mod.name, at: now(), durationMs: now() - mod.createdAt,
    gradeMs: now() - started, attempts: mod.attempts.length, selfPassed: mod.attempts.some((a) => a.status === 'passed'),
    lessonsBefore: mod.bench.lessonsBefore, costUsd: turnSessions.reduce((n, s) => n + (s.usage?.costUsd || 0), 0),
    ...scored, lessonsLearned: [],
  };
  mod.bench.result = result;
  feed(mod, { role: 'benana', kind: 'bench', text: `Benchmark ${task.title}: ${scored.passed}/${scored.total} hidden checks passed`, result });
  save(mod);

  const failed = scored.checks.filter((c) => c.status !== 'pass' && c.by === 'grader' && c.status !== 'blocked');
  if (failed.length && build && !game.status().mock) {
    setPhase(mod, 'bench', 'Benchmark: the coach is turning failed checks into lessons');
    const res = await agent(mod, null, 'coach', {
      cwd: mod.repoDir, prompt: prompts.coach({ task, mod, gold: scored, lessons: lessons().map((l) => l.lesson) }),
      model: MODELS.build, tools: ['Read', 'Glob', 'Grep'], allowedTools: ['Read', 'Glob', 'Grep'],
    }).catch((e) => ({ ok: false, error: e.message }));
    if (res.ok) {
      for (const m of res.final.matchAll(/^LESSON:\s*(.+)$/gm)) {
        const lesson = m[1].trim();
        if (addLesson(lesson, mod, 'coach')) result.lessonsLearned.push(lesson);
      }
      if (result.lessonsLearned.length) feed(mod, { role: 'benana', kind: 'note', text: `Coach added ${result.lessonsLearned.length} lesson(s) for future builders` });
    }
  }
  bench.record(result);
  emit('studio:bench', result);
  save(mod);
  return result;
}

// Runs the mod's latest turn. The first turn builds the plugin from scratch; a revision turn (the repository already exists)
// updates the spec and test plan, changes the existing code, and playtests it again.
async function run(mod) {
  const turnIndex = mod.turns.length - 1;
  const turn = mod.turns[turnIndex];
  active = { modId: mod.id, stop: () => {}, stopped: false };
  // Records how the turn ended so older turns keep their own result once the chat moves on.
  const settle = (status, done) => {
    mod.status = status;
    turn.status = status;
    if (done) setPhase(mod, 'done', done);
    turn.endPhase = mod.phase;
  };
  try {
    if (game.status().bot !== 'online' && !game.status().mock) {
      setPhase(mod, 'game', 'Starting the Minecraft server');
      await game.start(emit);
    }
    mod.status = 'running';
    mod.error = null;
    setPhase(mod, 'spec', turn.revision ? 'Updating the spec and test plan for your change' : 'Writing the spec and an in-game test plan');
    const spec = await specPhase(mod, turn);
    mod.name = spec.modName;
    mod.spec = { summary: spec.summary, behavior: spec.behavior || [], assets: Array.isArray(spec.assets) ? spec.assets.filter((a) => a?.name) : [] };
    mod.testPlan = spec.testPlan;
    Object.assign(turn, { summary: spec.summary, checks: spec.testPlan.checks });
    feed(mod, { role: 'spec', kind: 'plan', text: `${mod.testPlan.checks.length} checks: ${mod.testPlan.checks.map((c) => c.title).join(' · ')}` });

    if (turn.revision) {
      fs.mkdirSync(path.join(mod.repoDir, 'playtest'), { recursive: true });
      fs.writeFileSync(path.join(mod.repoDir, 'playtest', 'test-plan.json'), JSON.stringify(mod.testPlan, null, 2));
      await repo.commit(mod.repoDir, 'Update the in-game test plan');
    } else {
      setPhase(mod, 'repo', 'Creating the mod repository with Entire and Neatlogs hooks');
      const created = await repo.create({ slug: `${slugify(mod.name)}-${mod.id.slice(-4)}`, name: mod.name, summary: mod.spec.summary });
      mod.repoDir = created.dir;
      mod.partners = created.partners;
      fs.mkdirSync(path.join(mod.repoDir, 'playtest'), { recursive: true });
      fs.writeFileSync(path.join(mod.repoDir, 'playtest', 'test-plan.json'), JSON.stringify(mod.testPlan, null, 2));
      await repo.commit(mod.repoDir, 'Add the in-game test plan');
    }
    save(mod);

    let previous = null;
    let used = 0;
    const firstN = (mod.attempts.at(-1)?.n ?? 0) + 1;
    for (let n = firstN; n < firstN + MAX_ATTEMPTS; n++) {
      const attempt = await runAttempt(mod, turnIndex, n, previous);
      attempt.status = attempt.failure ? 'failed' : 'passed';
      attempt.endedAt = now();
      save(mod);
      if (!attempt.failure) {
        if (attempt.lesson) addLesson(attempt.lesson, mod);
        used = n - firstN + 1;
        break;
      }
      feed(mod, { attempt: n, role: 'benana', kind: 'failure', text: `Attempt ${n} failed (${attempt.failure.kind}): ${attempt.failure.summary}` });
      previous = attempt;
    }
    // A benchmark run is graded on the final build whether or not it passed its own test plan.
    const graded = mod.bench && turnIndex === 0 ? await benchPhase(mod) : null;
    const tail = graded ? ` · benchmark ${graded.passed}/${graded.total}` : '';
    if (used) settle('passed', `${used === 1 ? `${mod.name} passed every check on the first attempt` : `${mod.name} passed after ${used} attempts`}${tail}`);
    else settle('failed', `${mod.name} still fails after ${MAX_ATTEMPTS} attempts${tail}`);
  } catch (e) {
    settle(active?.stopped ? 'stopped' : 'failed');
    mod.error = e.message;
    feed(mod, { role: 'benana', kind: 'error', text: e.message });
    log(`studio: ${e.message}`, 'error');
    save(mod);
  } finally {
    active = null;
    save(mod);
  }
}

// "Run mod": a short AI-driven showcase of the mod in the live view. Only one runs at a time.
let demoRun = null; // { modId, stop, stopped }

function emitDemo(extra = {}) {
  emit('studio:demo', { modId: demoRun?.modId || null, running: Boolean(demoRun), ...extra });
}

function stopDemo() {
  if (!demoRun) return false;
  demoRun.stopped = true;
  demoRun.stop();
  return true;
}

async function runDemo({ id }) {
  if (active) throw new Error('A mod is building. Run it after it finishes.');
  if (demoRun) throw new Error('A demo is already running.');
  const mod = mods.get(id);
  if (!mod?.testPlan) throw new Error('This mod has no spec yet.');
  const jar = jarOf(mod);
  if (!jar) throw new Error(`${mod.name} has no built jar yet.`);
  const run = { modId: id, stop: () => {}, stopped: false };
  demoRun = run;
  emitDemo();
  let summary = '';
  let error = null;
  try {
    if (!isLoaded(mod)) {
      const out = await game.deployPlugin({ jarPath: jar, packPath: packOf(mod), emit });
      if (!out.loaded) throw new Error(`${mod.name} did not load: ${out.errors[0] || 'see the server log'}`);
    } else if (game.status().bot !== 'online' && !game.status().mock) {
      await game.start(emit);
    }
    if (run.stopped) return { stopped: true };
    if (game.status().mock) return { summary: '[mock runtime] no demo' };
    game.clearShowcase();
    const dir = path.join(studioDir, mod.id, 'demo');
    fs.mkdirSync(dir, { recursive: true });
    const mcpFile = path.join(dir, 'mcp.json');
    fs.writeFileSync(mcpFile, JSON.stringify(game.mcpConfig({ runId: `${mod.id}_demo`, verdictFile: path.join(dir, 'verdict.json'), testPlanFile: path.join(dir, 'test-plan.json') })));
    // Runs outside the mod repo so a demo is never traced or checkpointed as part of the mod's history.
    const handle = runClaude({ cwd: dir, prompt: game.demoPrompt(mod), model: MODELS.playtest, tools: [], allowedTools: game.demoTools, mcpConfigFile: mcpFile, timeoutMs: 9 * 60 * 1000 });
    run.stop = handle.stop;
    if (run.stopped) handle.stop();
    const res = await handle.done;
    if (run.stopped) return { stopped: true };
    if (!res.ok) throw new Error(res.error);
    summary = res.final.trim();
    return { summary };
  } catch (e) {
    error = e.message;
    throw e;
  } finally {
    demoRun = null;
    emitDemo({ summary, error });
  }
}

function assertIdle() {
  if (active) throw new Error('Another mod is running. Stop it or wait for it to finish.');
  if (game.status().deploying || game.status().resetting) throw new Error('The game is being reloaded. Try again in a few seconds.');
  stopDemo();
}

function create({ prompt, seed = false, bench: benchRun = null }) {
  assertIdle();
  const text = String(prompt || '').trim();
  if (!seed && text.length < 8) throw new Error('Describe the mod in a sentence.');
  const id = `mod_${now().toString(36)}`;
  const request = seed ? text || 'A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown.' : text;
  const mod = {
    id, prompt: request, turns: [{ prompt: request, at: now() }],
    seed: Boolean(seed), bench: benchRun, name: 'New mod', status: 'queued', phase: 'queued', createdAt: now(), updatedAt: now(),
    spec: null, testPlan: null, repoDir: null, partners: null, sessions: [], attempts: [], feed: [], error: null,
  };
  mods.set(id, mod);
  save(mod);
  run(mod);
  return publicMod(mod);
}

// A follow-up message in a mod's chat. With a repository it changes the existing plugin; without one (the first build died
// before creating it) the message is folded into the original request and the build starts over.
function revise({ id, prompt }) {
  const mod = mods.get(id);
  if (!mod) throw new Error('Unknown mod.');
  assertIdle();
  const text = String(prompt || '').trim();
  if (text.length < 8) throw new Error('Describe the change in a sentence.');
  const turn = { prompt: text, at: now(), revision: Boolean(mod.repoDir) };
  mod.turns.push(turn);
  mod.status = 'queued';
  mod.phase = 'queued';
  mod.error = null;
  feed(mod, { role: 'user', kind: 'user', turn: mod.turns.length - 1, text });
  save(mod);
  run(mod);
  return publicMod(mod);
}

function repoOf(id) {
  const mod = mods.get(id);
  if (!mod?.repoDir) throw new Error('This mod has no repository yet.');
  return mod.repoDir;
}

function handlers(deps) {
  emit = deps.emit;
  log = deps.log;
  load();
  return {
    'studio:list': () => [...mods.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicMod),
    'studio:get': ({ id }) => {
      const mod = mods.get(id);
      if (!mod) throw new Error('Unknown mod.');
      return { ...publicMod(mod), feed: mod.feed };
    },
    'studio:create': create,
    'studio:revise': revise,
    // Puts a mod's latest build on the server so the user can play it or watch it in the live view.
    'studio:load': async ({ id }) => {
      if (active) throw new Error('A mod is building. Switch mods after it finishes.');
      const mod = mods.get(id);
      if (!mod) throw new Error('Unknown mod.');
      const jar = jarOf(mod);
      if (!jar) throw new Error(`${mod.name} has no built jar yet.`);
      stopDemo();
      const out = await game.deployPlugin({ jarPath: jar, packPath: packOf(mod), emit });
      if (!out.loaded) throw new Error(`${mod.name} did not load: ${out.errors[0] || 'see the server log'}`);
      return out;
    },
    'studio:demo': runDemo,
    'studio:demo-stop': () => stopDemo(),
    'studio:demo-state': () => ({ modId: demoRun?.modId || null, running: Boolean(demoRun) }),
    // Wipes the world back to its beginning and reloads the server with the same mod installed.
    'studio:reset-world': async () => {
      if (active) throw new Error('A mod is building. Reset the world after it finishes.');
      stopDemo();
      return game.resetWorld({ emit });
    },
    'studio:stop': ({ id }) => {
      if (active?.modId !== id) return false;
      active.stopped = true;
      active.stop();
      return true;
    },
    'studio:evidence': ({ sessionId }) => neatlogs.evidence({ sessionId }),
    'studio:checkpoints': async ({ id }) => {
      const mod = mods.get(id);
      return mod?.repoDir ? repo.checkpoints(mod.repoDir) : { ok: false, items: [], error: 'No repository yet.' };
    },
    'studio:files': ({ id }) => repo.files(repoOf(id)),
    'studio:checkpoint': ({ id, checkpointId }) => repo.checkpoint(repoOf(id), checkpointId),
    // The mod's code graph from entire-graph (files, symbols, relations), for the graph window.
    'studio:graph': ({ id }) => entire.graph(repoOf(id)),
    'studio:file': ({ id, path: rel }) => repo.readFile(repoOf(id), rel),
    'studio:diff': ({ id, sha }) => repo.diff(repoOf(id), sha),
    'studio:lessons': () => lessons(),
    'studio:bench-tasks': () => bench.tasks().map(({ gold, ...t }) => ({ ...t, checks: gold.checks.map(({ id, title, capability }) => ({ id, title, capability })) })),
    'studio:bench-results': () => bench.results(),
    // Builds the task's request through the normal pipeline, then grades the result with the hidden checks.
    'studio:bench-run': ({ taskId }) => create({ prompt: bench.task(taskId).prompt, bench: { taskId, lessonsBefore: lessons().length } }),
    'studio:partners': async () => ({ neatlogs: await neatlogs.status() }),
  };
}

const busy = () => Boolean(active);

module.exports = { handlers, busy };

// Mod Studio pipeline: prompt -> spec/test plan -> build -> deploy -> playtest -> fix -> retry.
// Interface with the game runtime: docs/hackathon/CONTRACTS.md.
const fs = require('node:fs');
const path = require('node:path');
const { appRoot, dataDir } = require('../env.cjs');
const game = require('../game/index.cjs');
const neatlogs = require('../neatlogs.cjs');
const repo = require('./repo.cjs');
const prompts = require('./prompts.cjs');
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

// The newest jar this mod built (Maven overwrites target/<Name>.jar on every attempt).
function jarOf(mod) {
  const built = [...mod.attempts].reverse().find((a) => a.build?.ok && a.build.jar && fs.existsSync(a.build.jar));
  if (built) return built.build.jar;
  const fallback = mod.repoDir && path.join(mod.repoDir, 'target', `${mod.name}.jar`);
  return fallback && fs.existsSync(fallback) ? fallback : null;
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

function addLesson(lesson, mod) {
  const all = lessons();
  all.push({ lesson, mod: mod.name, at: now() });
  fs.mkdirSync(studioDir, { recursive: true });
  fs.writeFileSync(lessonsFile, JSON.stringify(all.slice(-20), null, 2));
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

async function trace(sessionId) {
  if (!sessionId || !neatlogs.configured()) return '';
  const ev = await neatlogs.evidence({ sessionId });
  if (!ev.matched) return '';
  return ev.traces.map((t) => {
    const spans = (t.spans || []).slice(0, 25).map((s) => `  - ${s.name || s.span_name || 'span'}${s.status === 'error' || s.status_code === 'ERROR' ? ' (error)' : ''}`).join('\n');
    return `trace ${t.traceId || t.trace_id || t.id}\n${spans}`;
  }).join('\n').slice(0, 4000);
}

async function codePhase(mod, attempt, previous) {
  if (attempt.role === 'seeded') {
    fs.copyFileSync(path.join(SEEDED, 'LaunchSword.java'), path.join(mod.repoDir, 'src', 'main', 'java', 'dev', 'benana', 'mod', 'LaunchSword.java'));
    feed(mod, { attempt: attempt.n, role: 'benana', kind: 'note', text: 'Seeded bug fallback: attempt 1 uses the labeled fixture source (velocity set inside the damage event).' });
    return;
  }
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
  const cps = await repo.checkpoints(mod.repoDir);
  const context = {
    history: await repo.history(mod.repoDir),
    checkpoints: cps.ok ? cps.items.slice(0, 8).map((c) => `${c.checkpoint_id} "${c.message}" session ${c.session_id} (${c.agent})`).join('\n') : '',
    trace: await trace(previous.sessions.find((s) => s.role === 'playtester')?.sessionId).catch(() => ''),
  };
  attempt.context = { entireCheckpoints: cps.ok ? cps.items.length : 0, neatlogsTrace: Boolean(context.trace) };
  const res = await agent(mod, attempt, 'fixer', { cwd: mod.repoDir, prompt: prompts.fixer({ mod, attempt, previous, context }), model: MODELS.build, tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'], allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'] });
  if (!res.ok) throw new Error(`Fixer failed: ${res.error}`);
  attempt.summary = res.final.slice(0, 2000);
  const lesson = res.final.match(/^LESSON:\s*(.+)$/m);
  if (lesson) attempt.lesson = lesson[1].trim();
}

async function playtestPhase(mod, attempt) {
  const dir = path.join(mod.repoDir, 'playtest', `attempt-${attempt.n}`);
  fs.mkdirSync(dir, { recursive: true });
  const verdictFile = path.join(dir, 'verdict.json');
  const testPlanFile = path.join(mod.repoDir, 'playtest', 'test-plan.json');
  fs.rmSync(verdictFile, { force: true });

  if (game.status().mock) {
    const v = game.mockVerdict(mod.testPlan, attempt.n);
    fs.writeFileSync(verdictFile, JSON.stringify(v, null, 2));
    feed(mod, { attempt: attempt.n, role: 'playtester', kind: 'note', text: '[mock runtime] canned verdict' });
    return game.readVerdict(verdictFile, mod.testPlan);
  }

  for (let run = 1; run <= 2; run++) {
    const mcpFile = path.join(studioDir, mod.id, `mcp-attempt-${attempt.n}.json`);
    fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
    fs.writeFileSync(mcpFile, JSON.stringify(game.mcpConfig({ runId: `${mod.id}_${attempt.n}`, verdictFile, testPlanFile })));
    const poll = setInterval(() => {
      if (!fs.existsSync(verdictFile)) return;
      const live = game.readVerdict(verdictFile, mod.testPlan);
      attempt.verdict = { ...live, live: true };
      save(mod);
    }, 1000);
    try {
      await agent(mod, attempt, 'playtester', { cwd: mod.repoDir, prompt: game.playtestPrompt(mod.testPlan), model: MODELS.playtest, tools: [], allowedTools: game.playtesterTools, mcpConfigFile: mcpFile });
    } finally {
      clearInterval(poll);
    }
    const verdict = game.readVerdict(verdictFile, mod.testPlan);
    if (verdict.finished) return verdict;
    feed(mod, { attempt: attempt.n, role: 'benana', kind: 'note', text: run === 1 ? 'The playtester stopped before finishing; running it again.' : 'The playtester did not finish the test plan.' });
  }
  return game.readVerdict(verdictFile, mod.testPlan);
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

  setPhase(mod, 'compile', `Attempt ${n}: compiling with Maven`);
  attempt.build = await repo.build(mod.repoDir, mod.name);
  if (!attempt.build.ok) {
    attempt.failure = { kind: 'build', summary: 'The plugin did not compile.' };
    attempt.commit = await repo.commit(mod.repoDir, `Attempt ${n} (${attempt.role}): build failed`);
    return attempt;
  }
  const did = attempt.role === 'fixer' ? `fix ${mod.name} from playtest evidence` : attempt.revision ? `change ${mod.name}: ${turn.prompt.replace(/\s+/g, ' ').slice(0, 72)}` : `implement ${mod.name}`;
  attempt.commit = await repo.commit(mod.repoDir, `Attempt ${n} (${attempt.role}): ${did}`);
  feed(mod, { attempt: n, role: 'benana', kind: 'note', text: `Committed ${attempt.commit.sha.slice(0, 7)}${attempt.commit.checkpoint ? `, Entire checkpoint ${attempt.commit.checkpoint}` : ''}` });

  setPhase(mod, 'deploy', `Attempt ${n}: deploying to the Paper server`);
  attempt.deploy = await game.deployPlugin({ jarPath: attempt.build.jar, emit });
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
    mod.spec = { summary: spec.summary, behavior: spec.behavior || [] };
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
    const firstN = (mod.attempts.at(-1)?.n ?? 0) + 1;
    for (let n = firstN; n < firstN + MAX_ATTEMPTS; n++) {
      const attempt = await runAttempt(mod, turnIndex, n, previous);
      attempt.status = attempt.failure ? 'failed' : 'passed';
      attempt.endedAt = now();
      save(mod);
      if (!attempt.failure) {
        if (attempt.lesson) addLesson(attempt.lesson, mod);
        const used = n - firstN + 1;
        settle('passed', used === 1 ? `${mod.name} passed every check on the first attempt` : `${mod.name} passed after ${used} attempts`);
        return;
      }
      feed(mod, { attempt: n, role: 'benana', kind: 'failure', text: `Attempt ${n} failed (${attempt.failure.kind}): ${attempt.failure.summary}` });
      previous = attempt;
    }
    settle('failed', `${mod.name} still fails after ${MAX_ATTEMPTS} attempts`);
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
      const out = await game.deployPlugin({ jarPath: jar, emit });
      if (!out.loaded) throw new Error(`${mod.name} did not load: ${out.errors[0] || 'see the server log'}`);
    } else if (game.status().bot !== 'online' && !game.status().mock) {
      await game.start(emit);
    }
    if (run.stopped) return { stopped: true };
    if (game.status().mock) return { summary: '[mock runtime] no demo' };
    const dir = path.join(studioDir, mod.id, 'demo');
    fs.mkdirSync(dir, { recursive: true });
    const mcpFile = path.join(dir, 'mcp.json');
    fs.writeFileSync(mcpFile, JSON.stringify(game.mcpConfig({ runId: `${mod.id}_demo`, verdictFile: path.join(dir, 'verdict.json'), testPlanFile: path.join(dir, 'test-plan.json') })));
    // Runs outside the mod repo so a demo is never traced or checkpointed as part of the mod's history.
    const handle = runClaude({ cwd: dir, prompt: game.demoPrompt(mod), model: MODELS.playtest, tools: [], allowedTools: game.demoTools, mcpConfigFile: mcpFile, timeoutMs: 5 * 60 * 1000 });
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

function create({ prompt, seed = false }) {
  assertIdle();
  const text = String(prompt || '').trim();
  if (!seed && text.length < 8) throw new Error('Describe the mod in a sentence.');
  const id = `mod_${now().toString(36)}`;
  const request = seed ? text || 'A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown.' : text;
  const mod = {
    id, prompt: request, turns: [{ prompt: request, at: now() }],
    seed: Boolean(seed), name: 'New mod', status: 'queued', phase: 'queued', createdAt: now(), updatedAt: now(),
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
      const out = await game.deployPlugin({ jarPath: jar, emit });
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
    'studio:file': ({ id, path: rel }) => repo.readFile(repoOf(id), rel),
    'studio:diff': ({ id, sha }) => repo.diff(repoOf(id), sha),
    'studio:lessons': () => lessons(),
    'studio:partners': async () => ({ neatlogs: await neatlogs.status() }),
  };
}

const busy = () => Boolean(active);

module.exports = { handlers, busy };

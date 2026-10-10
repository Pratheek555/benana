// Benana main process: owns credentials, git, agent processes, and the four loops.
// The renderer only talks to it over IPC.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { dataDir, appRoot, env } = require('./lib/env.cjs');
const { RepoStore } = require('./lib/store.cjs');
const github = require('./lib/github.cjs');
const { extract } = require('./lib/extract.cjs');
const graph = require('./lib/graph.cjs');
const harnessLib = require('./lib/harness.cjs');
const agents = require('./lib/agents.cjs');
const sessions = require('./lib/sessions.cjs');
const improve = require('./lib/improve.cjs');
const neatlogs = require('./lib/neatlogs.cjs');
const entire = require('./lib/entire.cjs');
const artifacts = require('./lib/artifacts.cjs');
const budget = require('./lib/budget.cjs');
const pr = require('./lib/pr.cjs');

let win;
let ctx = null; // { repo, repoPath, intent, harnessStore }
const inbox = new Map();
let pollTimer = null;
const configFile = path.join(dataDir, 'config.json');

const emit = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);
const log = (text, level = 'info') => emit('log', { text, level, at: Date.now() });

function readConfig() { try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return {}; } }
function writeConfig(c) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(configFile, JSON.stringify(c, null, 2)); }

async function openProject({ repo, repoPath }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Repo must look like owner/name');
  const intent = await new RepoStore('intent', repo).init();
  const harnessStore = await new RepoStore('harness', repo).init();
  await harnessLib.ensure(harnessStore);
  ctx = { repo, repoPath: repoPath || '', intent, harnessStore, onRunFinished };
  writeConfig({ ...readConfig(), last: { repo, repoPath } });
  if (artifacts.configured()) {
    Promise.all([artifacts.pull(intent), artifacts.pull(harnessStore)])
      .then(() => { log('synced intent + harness from Artifacts'); emit('graph-changed', {}); })
      .catch((e) => log(`Artifacts sync: ${e.message}`, 'warn'));
  }
  startPolling();
  return summary();
}

function summary() {
  if (!ctx) return null;
  const g = graph.loadGraph(ctx.intent);
  return { repo: ctx.repo, repoPath: ctx.repoPath, nodes: g.nodes.length, edges: g.edges.length, harness: harnessLib.load(ctx.harnessStore), intentDir: ctx.intent.dir, intentRepo: ctx.intent.name };
}

async function ingest({ deep = false, max = 200 } = {}) {
  need();
  log(`ingesting GitHub history for ${ctx.repo}…`);
  const hist = await github.history(ctx.repo, { max });
  log(`${hist.issues.length} issues, ${hist.pulls.length} PRs fetched; extracting intent`);
  const g = await extract(ctx.repo, hist, { deep, log });
  graph.writeGraph(ctx.intent, g);
  graph.writeEvent(ctx.intent, { type: 'ingest', source: 'github', issues: hist.issues.length, pulls: hist.pulls.length, at: Date.now() });
  const sha = await ctx.intent.commit(`${deep ? 'deep ' : ''}extraction from GitHub: ${g.nodes.length} nodes, ${g.edges.length} edges`, 'extractor');
  log(sha ? `committed graph snapshot ${sha.slice(0, 7)}` : 'graph unchanged');
  artifacts.schedulePush(ctx.intent, (e) => log(`Artifacts push: ${e.message}`, 'warn'));
  artifacts.schedulePush(ctx.harnessStore, (e) => log(`Artifacts push: ${e.message}`, 'warn'));
  emit('graph-changed', {});
  return summary();
}

// Loop 3: poll GitHub for new issues. Issues labelled benana:auto start a run automatically,
// within the concurrency and daily token budget; the rest wait in the queue.
const emitInbox = () => emit('inbox', [...inbox.values()].sort((a, b) => b.at - a.at));

function startQueued() {
  if (!ctx?.repoPath) return;
  const limits = harnessLib.load(ctx.harnessStore).budget;
  for (const item of [...inbox.values()].filter((i) => i.auto && ['new', 'queued'].includes(i.state)).sort((a, b) => a.at - b.at)) {
    const gate = budget.canStart(limits, agents.allRuns());
    if (!gate.ok) {
      if (item.state !== 'queued') { item.state = 'queued'; item.waiting = gate.reason; }
      continue;
    }
    item.state = 'started';
    agents.start({ ctx, task: `Resolve issue #${item.number}: ${item.title}`, issue: item }, emit)
      .then((r) => { item.run = r.id; emitInbox(); })
      .catch((e) => { item.state = 'error'; item.waiting = e.message; log(e.message, 'warn'); emitInbox(); });
  }
  emitInbox();
}

function startPolling() {
  clearInterval(pollTimer);
  const tick = async () => {
    if (!ctx) return;
    try {
      const issues = await github.openIssues(ctx.repo);
      for (const i of issues) {
        if (inbox.has(i.number)) continue;
        const auto = i.labels.some((l) => l.name === 'benana:auto');
        inbox.set(i.number, { number: i.number, title: i.title, body: (i.body || '').slice(0, 2000), url: i.html_url, labels: i.labels.map((l) => l.name), auto, state: 'new', at: Date.parse(i.created_at) });
      }
      startQueued();
    } catch (e) { log(`inbox poll: ${e.message}`, 'warn'); }
  };
  tick();
  pollTimer = setInterval(tick, 2 * 60 * 1000);
}

// After every run: link provenance, open a PR if allowed, score the running trial,
// analyse every N runs, and start queued issues now that a slot is free.
let finishedSinceAnalysis = 0;
async function onRunFinished(r) {
  if (!ctx) return;
  const h = harnessLib.load(ctx.harnessStore);
  try {
    const cps = await entire.attach(r.worktree);
    if (cps) { r.entire = cps; agents.saveRun(r); }
  } catch { /* entire is optional */ }
  if (r.status === 'passed' && h.auto.openPRs && r.origin === 'native') {
    try { r.pr = await pr.openForRun(r, ctx.repo); agents.saveRun(r); emit('run', agents.get(r.id)); log(`opened draft PR ${r.pr.url}`); }
    catch (e) { log(`PR for ${r.id}: ${e.message}`, 'warn'); }
  }
  try {
    const t = await improve.tick(ctx.harnessStore, agents.allRuns());
    if (t?.applied) log(`trial ${t.applied.id} ${t.applied.status.replace('_', ' ')} (${t.ev.verdict} on held-out runs)`, t.ev.verdict === 'fail' ? 'warn' : 'info');
    finishedSinceAnalysis += 1;
    if (h.auto.analyzeEvery > 0 && finishedSinceAnalysis >= h.auto.analyzeEvery) {
      finishedSinceAnalysis = 0;
      const a = await improve.analyze({ harnessStore: ctx.harnessStore, runs: agents.allRuns() });
      if (a.created?.length) log(`analyst proposed ${a.created.length} idea(s)`);
    }
  } catch (e) { log(`improve: ${e.message}`, 'warn'); }
  artifacts.schedulePush(ctx.harnessStore, (e) => log(`Artifacts push: ${e.message}`, 'warn'));
  emitImprove();
  startQueued();
}

function emitImprove() {
  if (!ctx) return;
  emit('proposals', improve.proposals(ctx.harnessStore));
  emit('improve', improve.overview(ctx.harnessStore, agents.allRuns()));
  emit('project', summary());
}

// Wraps an L4 action: run it, sync the harness repo, refresh the UI.
async function l4(fn) {
  need();
  const out = await fn();
  artifacts.schedulePush(ctx.harnessStore, (e) => log(`Artifacts push: ${e.message}`, 'warn'));
  emitImprove();
  return out;
}

function need() { if (!ctx) throw new Error('Open a project first'); }

const handlers = {
  'config:get': () => ({ ...readConfig(), autoOpen: Boolean(process.env.BENANA_AUTOOPEN), env: {
    cloudflare: artifacts.configured(), github: github.authenticated(), neatlogs: neatlogs.configured(), anthropic: Boolean(env('ANTHROPIC_API_KEY')),
  } }),
  'project:open': openProject,
  'project:summary': summary,
  'project:pick-path': async () => (await dialog.showOpenDialog(win, { properties: ['openDirectory'] })).filePaths[0] || '',
  'graph:ingest': ingest,
  'graph:load': async ({ sha } = {}) => { need(); return sha ? graph.loadGraphAt(ctx.intent, sha) : graph.loadGraph(ctx.intent); },
  'graph:history': async () => { need(); return ctx.intent.log(); },
  'graph:context': ({ text, files }) => { need(); return graph.context(graph.loadGraph(ctx.intent), { text, files }); },
  'inbox:list': () => [...inbox.values()].sort((a, b) => b.at - a.at),
  'run:start': async ({ task, issueNumber, agent }) => {
    need();
    const issue = issueNumber ? inbox.get(issueNumber) : null;
    if (issue) issue.state = 'started';
    emit('inbox', [...inbox.values()].sort((a, b) => b.at - a.at));
    return agents.start({ ctx, task, issue, agent }, emit);
  },
  'run:list': () => agents.list(),
  'run:get': ({ id }) => agents.get(id),
  'run:stop': ({ id }) => agents.stop(id, emit),
  'run:pr': async ({ id }) => {
    need();
    const r = agents.allRuns().find((x) => x.id === id);
    if (!r) throw new Error('unknown run');
    r.pr = await pr.openForRun(r, ctx.repo);
    agents.saveRun(r);
    emit('run', agents.get(id));
    return r.pr;
  },
  'budget:status': () => { need(); return budget.status(harnessLib.load(ctx.harnessStore).budget, agents.allRuns()); },
  'run:brief': ({ id, text }) => { need(); return agents.continueRun(id, text, ctx, emit); },
  'sessions:detect': ({ all } = {}) => sessions.detect(all || !ctx ? '' : ctx.repoPath),
  'sessions:transcript': ({ kind, id }) => sessions.transcript(kind, id),
  'sessions:plan': () => { need(); return sessions.plan(ctx.intent.dir); },
  'sessions:install': () => { need(); return sessions.install(ctx.intent.dir); },
  'sessions:uninstall': () => sessions.uninstall(),
  'sessions:resume': ({ kind, id, cwd, brief }) => { need(); return agents.resumeExternal({ ctx, kind, sessionId: id, cwd, brief }, emit); },
  'improve:analyze': ({ useLLM = true } = {}) => l4(() => improve.analyze({ harnessStore: ctx.harnessStore, runs: agents.allRuns(), useLLM, force: true })),
  'improve:list': () => { need(); return improve.proposals(ctx.harnessStore); },
  'improve:overview': () => { need(); return improve.overview(ctx.harnessStore, agents.allRuns()); },
  'improve:decide': ({ id, approve, direct }) => l4(() => improve.decide({ harnessStore: ctx.harnessStore, id, approve, direct })),
  'improve:promote': () => l4(() => improve.promote(ctx.harnessStore, 'human')),
  'improve:rollback': () => l4(() => improve.rollback(ctx.harnessStore, 'human', 'rolled back by human')),
  'improve:stats': () => improve.stats(agents.allRuns()),
  // Settings edits (auto, budget, mechanisms, graders). Unknown keys are dropped.
  'harness:update': (patch) => l4(async () => {
    const h = harnessLib.load(ctx.harnessStore);
    const pick = (k) => ({ ...h[k], ...(patch[k] || {}) });
    const next = harnessLib.normalize({ ...h, agent: patch.agent || h.agent, graders: pick('graders'), auto: pick('auto'), budget: pick('budget'), mechanisms: pick('mechanisms') });
    // Only changes that alter agent behaviour make a new version; budget/auto do not, so they
    // never invalidate the baseline a running trial is compared against.
    const behaviour = (x) => JSON.stringify([x.agent, x.graders, x.mechanisms]);
    if (behaviour(next) !== behaviour(h)) {
      if (improve.overview(ctx.harnessStore, []).state.trial) throw new Error('A trial is running; promote or roll it back before changing graders or mechanisms.');
      next.version = h.version + 1;
    }
    ctx.harnessStore.write('harness.json', next);
    await ctx.harnessStore.commit(`harness v${next.version}: settings`, 'human');
    return next;
  }),
  'status:integrations': async () => ({
    artifacts: artifacts.configured() ? { configured: true, namespace: artifacts.namespace(), repo: ctx?.intent.name, lastPush: artifacts.lastPush?.() } : { configured: false },
    neatlogs: await neatlogs.status(),
    entire: await entire.status(ctx?.repoPath),
  }),
  'open-external': (url) => shell.openExternal(url),
  'open-path': (p) => shell.openPath(p),
};

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, payload) => {
    try { return { ok: true, data: await fn(payload || {}) }; }
    catch (e) { log(e.message, 'error'); return { ok: false, error: e.message }; }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 680, backgroundColor: '#000000',
    title: 'benana', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  // Dev aid: BENANA_SCREENSHOT=/path.png captures the window after BENANA_SCREENSHOT_DELAY ms.
  if (process.env.BENANA_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      fs.writeFileSync(process.env.BENANA_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    }, Number(process.env.BENANA_SCREENSHOT_DELAY || 6000)));
  }
  if (process.env.BENANA_DEV) win.loadURL('http://127.0.0.1:5199');
  else win.loadFile(path.join(appRoot, 'dist', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

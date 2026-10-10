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
  repo = String(repo || '').trim();
  if (repo.includes('://')) {
    const match = repo.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i);
    if (!match) throw new Error('Repository must be owner/name or an HTTPS GitHub URL.');
    repo = `${match[1]}/${match[2]}`;
  }
  repo = repo.replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository must be owner/name or an HTTPS GitHub URL.');
  const intent = await new RepoStore('intent', repo).init();
  const harnessStore = await new RepoStore('harness', repo).init();
  await harnessLib.ensure(harnessStore);
  inbox.clear();
  ctx = { repo, repoPath: repoPath || '', intent, harnessStore };
  agents.hydrate(repo);
  writeConfig({ ...readConfig(), last: { repo, repoPath } });
  const openedRepo = repo;
  if (artifacts.configured()) {
    Promise.all([artifacts.pull(intent), artifacts.pull(harnessStore)])
      .then(() => { if (ctx?.repo === openedRepo) { log('synced intent + harness from Artifacts'); emit('graph-changed', {}); } })
      .catch((e) => { if (ctx?.repo === openedRepo) log(`Artifacts sync: ${e.message}`, 'warn'); });
  }
  startPolling();
  const opened = summary();
  emit('project', opened);
  emit('inbox', []);
  return opened;
}

function summary() {
  if (!ctx) return null;
  const g = graph.loadGraph(ctx.intent);
  return { repo: ctx.repo, repoPath: ctx.repoPath, nodes: g.nodes.length, edges: g.edges.length, harness: harnessLib.load(ctx.harnessStore), intentDir: ctx.intent.dir, intentRepo: ctx.intent.name };
}

async function ingest({ deep = false, max = 200 } = {}) {
  need();
  const owner = ctx;
  log(`ingesting GitHub history for ${ctx.repo}…`);
  const hist = await github.history(owner.repo, { max });
  if (ctx !== owner) throw new Error('The open project changed during ingestion. Run ingestion again.');
  log(`${hist.issues.length} issues, ${hist.pulls.length} PRs fetched; extracting intent`);
  const g = await extract(owner.repo, hist, { deep, log });
  if (ctx !== owner) throw new Error('The open project changed during ingestion. Run ingestion again.');
  graph.writeGraph(owner.intent, g);
  graph.writeEvent(owner.intent, { type: 'ingest', source: 'github', issues: hist.issues.length, pulls: hist.pulls.length, at: Date.now() });
  const sha = await owner.intent.commit(`${deep ? 'deep ' : ''}extraction from GitHub: ${g.nodes.length} nodes, ${g.edges.length} edges`, 'extractor');
  log(sha ? `committed graph snapshot ${sha.slice(0, 7)}` : 'graph unchanged');
  if (artifacts.configured()) {
    artifacts.push(owner.intent).then((r) => { if (ctx === owner) log(`pushed to Artifacts ${artifacts.namespace()}/${r.name}`); }).catch((e) => { if (ctx === owner) log(`Artifacts push: ${e.message}`, 'warn'); });
    artifacts.push(owner.harnessStore).catch(() => {});
  }
  if (ctx !== owner) throw new Error('The open project changed during ingestion.');
  emit('graph-changed', {});
  return summary();
}

// Loop 3: poll GitHub for new issues. Issues labelled benana:auto start a run automatically.
function startPolling() {
  clearInterval(pollTimer);
  const tick = async () => {
    if (!ctx) return;
    const owner = ctx;
    try {
      const issues = await github.openIssues(owner.repo);
      if (ctx !== owner) return;
      for (const i of issues) {
        if (inbox.has(i.number)) continue;
        const auto = i.labels.some((l) => l.name === 'benana:auto');
        inbox.set(i.number, { number: i.number, title: i.title, body: (i.body || '').slice(0, 2000), url: i.html_url, labels: i.labels.map((l) => l.name), auto, state: 'new', at: Date.parse(i.created_at) });
        if (auto && ctx.repoPath) {
          inbox.get(i.number).state = 'started';
          agents.start({ ctx, task: `Resolve issue #${i.number}: ${i.title}`, issue: inbox.get(i.number) }, emit).catch((e) => log(e.message, 'warn'));
        }
      }
      emit('inbox', [...inbox.values()].sort((a, b) => b.at - a.at));
    } catch (e) { log(`inbox poll: ${e.message}`, 'warn'); }
  };
  tick();
  pollTimer = setInterval(tick, 2 * 60 * 1000);
}

function need() { if (!ctx) throw new Error('Open a project first'); }
function scopedRun(id) {
  need();
  const run = agents.get(id, ctx.repo);
  if (!run) throw new Error('unknown run for the open project');
  return run;
}

const handlers = {
  'config:get': () => ({ ...readConfig(), autoOpen: process.env.BENANA_AUTOOPEN === '1', env: {
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
  'run:list': () => agents.list(ctx?.repo),
  'run:get': ({ id }) => scopedRun(id),
  'run:stop': ({ id }) => { scopedRun(id); return agents.stop(id, emit); },
  'run:brief': ({ id, text }) => { scopedRun(id); return agents.continueRun(id, text, ctx, emit); },
  'run:retry': ({ id, recoveryId }) => { scopedRun(id); return agents.retry(id, recoveryId, ctx, emit); },
  'run:diff': ({ id }) => { scopedRun(id); return agents.diff(id); },
  'neatlogs:evidence': ({ id }) => neatlogs.evidence(scopedRun(id)),
  'entire:overview': () => entire.overview(ctx?.repoPath),
  'entire:context': ({ text }) => entire.context(ctx?.repoPath, text),
  'entire:graph': () => entire.graph(ctx?.repoPath),
  'sessions:detect': () => { need(); return ctx.repoPath ? sessions.detect(ctx.repoPath) : []; },
  'sessions:transcript': ({ kind, id }) => { need(); return sessions.transcript(kind, id, ctx.repoPath); },
  'sessions:plan': () => { need(); return sessions.plan(ctx.intent.dir); },
  'sessions:install': () => { need(); return sessions.install(ctx.intent.dir); },
  'sessions:uninstall': () => sessions.uninstall(),
  'sessions:resume': ({ kind, id, brief }) => {
    need();
    const session = sessions.resolveForRepo(kind, id, ctx.repoPath);
    return agents.resumeExternal({ ctx, kind: session.kind, sessionId: session.id, cwd: session.cwd, brief }, emit);
  },
  'improve:analyze': async ({ useLLM = true } = {}) => { need(); const owner = ctx; const r = await improve.analyze({ harnessStore: owner.harnessStore, runs: agents.allRuns(owner.repo), useLLM }); if (ctx === owner) emit('proposals', improve.proposals(owner.harnessStore)); return r; },
  'improve:list': () => { need(); return improve.proposals(ctx.harnessStore); },
  'improve:decide': async ({ id, approve }) => {
    need();
    const owner = ctx;
    const p = await improve.decide({ harnessStore: owner.harnessStore, id, approve });
    if (artifacts.configured()) artifacts.push(owner.harnessStore).catch(() => {});
    if (ctx === owner) {
      emit('proposals', improve.proposals(owner.harnessStore));
      emit('project', summary());
    }
    return p;
  },
  'improve:stats': () => improve.stats(agents.allRuns(ctx?.repo)),
  'harness:update': async (patch) => {
    need();
    const owner = ctx;
    const h = harnessLib.load(owner.harnessStore);
    const next = { ...h, ...patch, graders: { ...h.graders, ...(patch.graders || {}) }, version: h.version + 1 };
    owner.harnessStore.write('harness.json', next);
    await owner.harnessStore.commit(`harness v${next.version}: manual edit`, 'human');
    if (ctx === owner) emit('project', summary());
    return next;
  },
  'status:integrations': async () => ({
    artifacts: artifacts.configured() ? { configured: true, namespace: artifacts.namespace(), repo: ctx?.intent.name } : { configured: false },
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
    width: 1480, height: 920, minWidth: 1100, minHeight: 680, backgroundColor: '#f4f1ea',
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

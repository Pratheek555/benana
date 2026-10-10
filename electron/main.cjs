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
const tracing = require('./lib/tracing.cjs');

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
  ctx = { repo, repoPath: repoPath || '', intent, harnessStore };
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

// Entry point: GitHub history -> intent graph (one WORKFLOW trace per ingest).
function ingest(opts = {}) {
  need();
  return tracing.workflow('intent-extraction', { input: { repo: ctx.repo, ...opts }, entryPoint: opts.deep ? 'deep-extraction' : 'extraction' }, async () => {
    const s = await ingestGraph(opts);
    tracing.setOutput({ nodes: s.nodes, edges: s.edges });
    return s;
  });
}

async function ingestGraph({ deep = false, max = 200 } = {}) {
  log(`ingesting GitHub history for ${ctx.repo}…`);
  const hist = await github.history(ctx.repo, { max });
  log(`${hist.issues.length} issues, ${hist.pulls.length} PRs fetched; extracting intent`);
  const g = await extract(ctx.repo, hist, { deep, log });
  graph.writeGraph(ctx.intent, g);
  graph.writeEvent(ctx.intent, { type: 'ingest', source: 'github', issues: hist.issues.length, pulls: hist.pulls.length, at: Date.now() });
  const sha = await ctx.intent.commit(`${deep ? 'deep ' : ''}extraction from GitHub: ${g.nodes.length} nodes, ${g.edges.length} edges`, 'extractor');
  log(sha ? `committed graph snapshot ${sha.slice(0, 7)}` : 'graph unchanged');
  if (artifacts.configured()) {
    artifacts.push(ctx.intent).then((r) => log(`pushed to Artifacts ${artifacts.namespace()}/${r.name}`)).catch((e) => log(`Artifacts push: ${e.message}`, 'warn'));
    artifacts.push(ctx.harnessStore).catch(() => {});
  }
  emit('graph-changed', {});
  return summary();
}

// Loop 3: poll GitHub for new issues. Issues labelled benana:auto start a run automatically.
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

const handlers = {
  'config:get': () => ({ ...readConfig(), autoOpen: Boolean(process.env.BENANA_AUTOOPEN), env: {
    cloudflare: artifacts.configured(), github: github.authenticated(), neatlogs: neatlogs.tracing(), anthropic: Boolean(env('ANTHROPIC_API_KEY')),
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
  'run:stop': ({ id }) => agents.stop(id),
  'run:brief': ({ id, text }) => { need(); return agents.continueRun(id, text, ctx, emit); },
  'sessions:detect': ({ all } = {}) => sessions.detect(all || !ctx ? '' : ctx.repoPath),
  'sessions:transcript': ({ kind, id }) => sessions.transcript(kind, id),
  'sessions:plan': () => { need(); return sessions.plan(ctx.intent.dir); },
  'sessions:install': () => { need(); return sessions.install(ctx.intent.dir); },
  'sessions:uninstall': () => sessions.uninstall(),
  'sessions:resume': ({ kind, id, cwd, brief }) => { need(); return agents.resumeExternal({ ctx, kind, sessionId: id, cwd, brief }, emit); },
  'improve:analyze': async ({ useLLM = true } = {}) => {
    need();
    const r = await tracing.workflow('harness-analyst', { input: { harnessVersion: harnessLib.load(ctx.harnessStore).version }, entryPoint: 'run-analyst' }, async () => {
      const out = await improve.analyze({ harnessStore: ctx.harnessStore, runs: agents.allRuns(), useLLM });
      tracing.setOutput({ stats: out.stats, proposal: out.proposal?.title || null });
      return out;
    });
    emit('proposals', improve.proposals(ctx.harnessStore));
    return r;
  },
  'improve:list': () => { need(); return improve.proposals(ctx.harnessStore); },
  'improve:decide': async ({ id, approve }) => {
    need();
    const p = await improve.decide({ harnessStore: ctx.harnessStore, id, approve });
    if (artifacts.configured()) artifacts.push(ctx.harnessStore).catch(() => {});
    emit('proposals', improve.proposals(ctx.harnessStore));
    emit('project', summary());
    return p;
  },
  'improve:stats': () => improve.stats(agents.allRuns()),
  'harness:update': async (patch) => {
    need();
    const h = harnessLib.load(ctx.harnessStore);
    const next = { ...h, ...patch, graders: { ...h.graders, ...(patch.graders || {}) }, version: h.version + 1 };
    ctx.harnessStore.write('harness.json', next);
    await ctx.harnessStore.commit(`harness v${next.version}: manual edit`, 'human');
    emit('project', summary());
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

app.whenReady().then(async () => {
  await tracing.init();
  createWindow();
});
let flushed = false;
app.on('before-quit', (e) => {
  if (flushed) return;
  e.preventDefault();
  flushed = true;
  tracing.shutdown().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());

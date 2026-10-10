// Session bridge: finds Claude Code and Codex sessions already running on this machine
// (Level 1: observe), can wire the intent MCP server into the user's own agents
// (Level 2: assist), and resume a detected session inside Benana (Level 3: control).
// Transcript formats are not official APIs, so each tool has its own small adapter.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { appRoot } = require('./env.cjs');

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');
const ACTIVE_MS = 3 * 60 * 1000;
const RECENT_MS = 24 * 60 * 60 * 1000;

function readLines(file, maxBytes = 512 * 1024) {
  const { size } = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  const len = Math.min(size, maxBytes);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  return buf.toString('utf8').split('\n').slice(size > len ? 1 : 0).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function firstLine(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(64 * 1024);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const lines = buf.toString('utf8', 0, n).split('\n');
  for (const l of lines) { try { return JSON.parse(l); } catch { /* partial */ } }
  return null;
}

const text = (content) => (typeof content === 'string' ? content
  : (content || []).map((c) => c.text || c.input_text || (c.type === 'tool_use' ? `⚙ ${c.name}` : '')).filter(Boolean).join(' '));

const claudeAdapter = {
  kind: 'claude',
  files() {
    if (!fs.existsSync(CLAUDE_DIR)) return [];
    return fs.readdirSync(CLAUDE_DIR).flatMap((d) => {
      const dir = path.join(CLAUDE_DIR, d);
      if (!fs.statSync(dir).isDirectory()) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
    });
  },
  describe(file) {
    const lines = readLines(file, 256 * 1024);
    const withCwd = lines.find((l) => l.cwd);
    return { id: path.basename(file, '.jsonl'), cwd: withCwd?.cwd || '', messages: this.messages(lines) };
  },
  messages(lines) {
    return lines.filter((l) => (l.type === 'user' || l.type === 'assistant') && l.message && !l.isSidechain)
      .map((l) => ({ role: l.type === 'user' ? (Array.isArray(l.message.content) && l.message.content[0]?.type === 'tool_result' ? 'tool' : 'user') : 'agent', text: text(l.message.content).slice(0, 1200), at: Date.parse(l.timestamp) || 0 }))
      .filter((m) => m.text.trim() && !m.text.startsWith('<'));
  },
};

const codexAdapter = {
  kind: 'codex',
  files() {
    if (!fs.existsSync(CODEX_DIR)) return [];
    return fs.readdirSync(CODEX_DIR, { recursive: true }).map(String).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(CODEX_DIR, f));
  },
  describe(file) {
    const meta = firstLine(file);
    const lines = readLines(file, 256 * 1024);
    return { id: meta?.payload?.id || meta?.payload?.session_id || path.basename(file), cwd: meta?.payload?.cwd || '', messages: this.messages(lines) };
  },
  messages(lines) {
    return lines.filter((l) => l.type === 'response_item' && l.payload?.type === 'message' && l.payload.role !== 'developer')
      .map((l) => ({ role: l.payload.role === 'user' ? 'user' : 'agent', text: text(l.payload.content).slice(0, 1200), at: Date.parse(l.timestamp) || 0 }))
      .filter((m) => m.text.trim() && !m.text.startsWith('<'));
  },
};

const adapters = [claudeAdapter, codexAdapter];
const index = new Map();

// Detect sessions touched in the last day, optionally only those inside a given repo path.
function detect(repoPath) {
  const now = Date.now();
  const out = [];
  for (const a of adapters) {
    for (const file of a.files()) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (now - st.mtimeMs > RECENT_MS) continue;
      try {
        const d = a.describe(file);
        if (repoPath && d.cwd && !d.cwd.startsWith(repoPath)) continue;
        if (repoPath && !d.cwd) continue;
        const last = d.messages.at(-1);
        const s = { id: d.id, kind: a.kind, origin: 'attached', cwd: d.cwd, file, updatedAt: st.mtimeMs, active: now - st.mtimeMs < ACTIVE_MS, lastMessage: last?.text?.slice(0, 160) || '', title: d.messages.find((m) => m.role === 'user')?.text.slice(0, 80) || d.id };
        index.set(`${a.kind}:${d.id}`, { ...s, adapter: a });
        out.push(s);
      } catch { /* unreadable session file */ }
    }
  }
  return out.sort((x, y) => y.updatedAt - x.updatedAt).slice(0, 20);
}

function transcript(kind, id) {
  const s = index.get(`${kind}:${id}`);
  if (!s) return [];
  return s.adapter.messages(readLines(s.file)).slice(-80);
}

// Level 2: register the intent MCP server with the user's own Claude Code / Codex.
// Every change is shown to the user first and can be removed with uninstall().
function plan(intentDir) {
  const server = path.join(appRoot, 'electron', 'mcp-server.cjs');
  return {
    claude: `claude mcp add --scope user benana-intent -e BENANA_INTENT_DIR=${intentDir} -- node ${server}`,
    codex: `[mcp_servers.benana-intent]\ncommand = "node"\nargs = [${JSON.stringify(server)}]\nenv = { BENANA_INTENT_DIR = ${JSON.stringify(intentDir)} }`,
    codexFile: path.join(os.homedir(), '.codex', 'config.toml'),
  };
}

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || stderr || err?.message || '').trim() })));

async function install(intentDir) {
  const p = plan(intentDir);
  const server = path.join(appRoot, 'electron', 'mcp-server.cjs');
  await run('claude', ['mcp', 'remove', '--scope', 'user', 'benana-intent']);
  const claude = await run('claude', ['mcp', 'add', '--scope', 'user', 'benana-intent', '-e', `BENANA_INTENT_DIR=${intentDir}`, '--', 'node', server]);
  let codex = { ok: false, out: 'codex config not found' };
  if (fs.existsSync(path.dirname(p.codexFile))) {
    const cur = fs.existsSync(p.codexFile) ? fs.readFileSync(p.codexFile, 'utf8') : '';
    if (cur && !fs.existsSync(`${p.codexFile}.benana-backup`)) fs.writeFileSync(`${p.codexFile}.benana-backup`, cur);
    fs.writeFileSync(p.codexFile, `${stripBlock(cur).trimEnd()}\n\n# >>> benana\n${p.codex}\n# <<< benana\n`);
    codex = { ok: true, out: `updated ${p.codexFile}` };
  }
  return { claude, codex };
}

async function uninstall() {
  const claude = await run('claude', ['mcp', 'remove', '--scope', 'user', 'benana-intent']);
  const file = plan('').codexFile;
  if (fs.existsSync(file)) fs.writeFileSync(file, `${stripBlock(fs.readFileSync(file, 'utf8')).trimEnd()}\n`);
  return { claude, codex: { ok: true, out: 'removed benana block' } };
}

const stripBlock = (s) => s.replace(/\n*# >>> benana[\s\S]*?# <<< benana\n?/g, '\n');

module.exports = { detect, transcript, plan, install, uninstall };

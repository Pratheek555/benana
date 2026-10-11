// Builds the publish bundle for one mod version: checkpoint metadata, the selected transcripts
// (sanitized, then secret-gated), the graph changelog and code map, token totals, and a manifest
// that hashes every file. The jar is hashed but never modified or bundled with transcripts.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { git } = require('../git.cjs');
const { sanitize } = require('./sanitize.cjs');
const secrets = require('./secrets.cjs');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Before publishing, drop what readers don't need and what describes the creator's machine:
// thinking-block signatures (opaque model data) and the agent's embedded system prompt
// (local environment: memory paths, settings). The conversation itself is kept.
const DROP_KEYS = new Set(['signature', 'systemPrompt']);
function stripTranscript(text) {
  const clean = (v) => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) if (!DROP_KEYS.has(k)) out[k] = clean(val);
      return out;
    }
    return v;
  };
  return String(text).split('\n').map((line) => {
    if (!line.trim()) return line;
    try { return JSON.stringify(clean(JSON.parse(line))); } catch { return line; }
  }).join('\n');
}

function entire(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.env.BENANA_ENTIRE || 'entire', args, { cwd, timeout: 180000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout || ''), err: String(stderr || '') }));
  });
}

// Checkpoint IDs from Entire-Checkpoint trailers on commits in (previous, version].
async function checkpointsIn(repoDir, version, previous) {
  const range = previous ? `${previous}..${version}` : version;
  const out = await git(repoDir, ['log', '--format=%(trailers:key=Entire-Checkpoint,valueonly)', range]);
  return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
}

async function build({ repoDir, version, previous = null, jarPath, sessions = [], outDir, identity, execute = entire }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'checkpoints'), { recursive: true });
  const write = (rel, data) => { const f = path.join(outDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

  const ids = await checkpointsIn(repoDir, version, previous);
  const checkpoints = [];
  const suspicious = [];
  const tokens = { input: 0, output: 0, cacheRead: 0 };
  for (const id of ids) {
    const meta = await execute(['checkpoint', 'explain', id, '--json'], repoDir);
    if (!meta.ok) throw new Error(`Could not read checkpoint ${id}`);
    const m = JSON.parse(meta.out);
    for (const s of m.sessions || []) {
      tokens.input += s.token_usage?.input_tokens || 0;
      tokens.output += s.token_usage?.output_tokens || 0;
      tokens.cacheRead += s.token_usage?.cache_read_tokens || 0;
    }
    const metaClean = sanitize(meta.out, identity);
    write(`checkpoints/${id}/metadata.json`, metaClean.text);
    const sessionIds = (m.sessions || []).map((s) => s.session_id);
    // sessions: list of session IDs to publish transcripts for, or '*' for every session.
    const include = sessions === '*' || sessionIds.some((sid) => sessions.includes(sid));
    if (include) {
      const t = await execute(['checkpoint', 'explain', id, '--transcript'], repoDir);
      if (!t.ok) throw new Error(`Could not read transcript for checkpoint ${id}`);
      const clean = sanitize(stripTranscript(t.out), identity);
      write(`checkpoints/${id}/transcript.jsonl`, clean.text);
      suspicious.push(...clean.suspicious.map((x) => ({ checkpointId: id, file: 'transcript.jsonl', ...x })));
    }
    suspicious.push(...metaClean.suspicious.map((x) => ({ checkpointId: id, file: 'metadata.json', ...x })));
    checkpoints.push({ id, sessions: sessionIds, transcript: include, files: m.files_touched || [] });
  }

  // Graph: changelog against the previous version, code map of this version's tree.
  const diff = previous
    ? await execute(['graph', 'diff', '--base', previous, '--head', version, '--json', '--repo', repoDir], repoDir)
    : await execute(['graph', 'commit', version, '--json', '--repo', repoDir], repoDir);
  if (diff.ok) write('changelog.json', diff.out);
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'benana-version-'));
  try {
    await git(repoDir, ['worktree', 'add', '-q', '--detach', path.join(tree, 'w'), version]);
    const report = path.join(outDir, 'code-map.md');
    const idx = await execute(['graph', 'index', '--repo', path.join(tree, 'w'), '--head', '--report', report, '--format', 'json'], path.join(tree, 'w'));
    if (!idx.ok) fs.rmSync(report, { force: true });
  } finally {
    await git(repoDir, ['worktree', 'remove', '--force', path.join(tree, 'w')]).catch(() => {});
    fs.rmSync(tree, { recursive: true, force: true });
  }

  // Gate: secret scan over everything that will be published. Any finding blocks.
  const scan = await secrets.scanDir(outDir);
  const blocked = !scan.clean || suspicious.length > 0;

  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else files.push({ path: path.relative(outDir, f), sha256: sha256(fs.readFileSync(f)), bytes: fs.statSync(f).size });
    }
  };
  walk(outDir);
  const manifest = {
    version: 1,
    commit: version,
    previous,
    jar: jarPath ? { file: path.basename(jarPath), sha256: sha256(fs.readFileSync(jarPath)), bytes: fs.statSync(jarPath).size } : null,
    checkpoints,
    tokens,
    changelog: diff.ok,
    codeMap: files.some((f) => f.path === 'code-map.md'),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    gate: { clean: !blocked, findings: scan.findings, error: scan.error, suspicious },
  };
  write('manifest.json', JSON.stringify(manifest, null, 2));
  return { ok: !blocked, manifest, outDir };
}

module.exports = { build, checkpointsIn, stripTranscript };

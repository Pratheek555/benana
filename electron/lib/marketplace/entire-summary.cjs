// Entire provenance for one version, as metadata only (no transcripts, no prompts): the checkpoints
// behind the version, its changelog and its code map. Stored on the version row so the website and the
// app can show it without any files.
const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function codeMapStats(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  const completeness = (text.match(/Completeness: \*\*([a-z]+)\*\*/) || [])[1] || null;
  const languages = [...text.matchAll(/^\| ([A-Za-z+#.\- ]+) \| (\w+) \| (\d+) \| (\d+) \|$/gm)]
    .filter((m) => m[1] !== 'Language')
    .map((m) => ({ language: m[1].trim(), tier: m[2], files: Number(m[3]), symbols: Number(m[4]) }));
  return { symbols: num(/\*\*(\d+) symbols\*\*/), relations: num(/\*\*(\d+) relations\*\*/), completeness, languages };
}

// One file of the changelog, compact: status, what kind of change, and the symbols it touched.
function summarizeFile(f) {
  const changes = f.changes || [];
  const count = (t) => changes.filter((c) => c.type === t).length;
  const names = [];
  for (const c of changes) if (c.name && !names.includes(c.name)) names.push(c.name);
  return {
    path: f.path,
    status: f.status || 'M',
    language: f.language || null,
    added: count('added'),
    removed: count('removed'),
    changed: changes.filter((c) => c.type !== 'added' && c.type !== 'removed').length,
    signatureChanged: changes.filter((c) => c.type === 'signature_changed' || c.type === 'renamed').length,
    dependents: changes.reduce((n, c) => n + (c.dependents_count || 0), 0),
    names: names.slice(0, 6),
  };
}

// bundleDir: the version's bundle folder (manifest.json, checkpoints/, changelog.json, code-map.md).
// checkpoint id -> commit that carries its Entire-Checkpoint trailer, read from a repo (or a clone of the source bundle).
function commitsByCheckpoint(repoDir) {
  const { execFileSync } = require('node:child_process');
  const out = new Map();
  try {
    const log = execFileSync('git', ['-C', repoDir, 'log', '--all', '--format=%H %(trailers:key=Entire-Checkpoint,valueonly)'], { encoding: 'utf8' });
    for (const line of log.split('\n')) {
      const [sha, ...ids] = line.trim().split(/\s+/);
      for (const id of ids) if (sha && id) out.set(id, sha);
    }
  } catch { /* no repo */ }
  return out;
}

function entireSummary(bundleDir, { repoDir = null } = {}) {
  const manifest = readJson(path.join(bundleDir, 'manifest.json'));
  if (!manifest) return null;
  const commits = repoDir ? commitsByCheckpoint(repoDir) : new Map();
  const checkpoints = (manifest.checkpoints || []).map((c) => {
    const meta = readJson(path.join(bundleDir, 'checkpoints', c.id, 'metadata.json')) || {};
    const sessions = meta.sessions || [];
    const first = sessions[0] || {};
    const tokens = sessions.reduce((n, s) => n + (s.token_usage?.input_tokens || 0) + (s.token_usage?.output_tokens || 0) + (s.token_usage?.cache_read_tokens || 0), 0);
    return {
      id: c.id,
      commit: commits.get(c.id) || null,
      agent: first.agent || null,
      model: first.model || null,
      createdAt: first.created_at || null,
      sessions: sessions.length,
      files: meta.files_touched || c.files || [],
      tokens,
      hasTranscript: Boolean(c.transcript),
    };
  });
  const changelog = readJson(path.join(bundleDir, 'changelog.json'));
  return {
    provenance: { commit: manifest.commit, previous: manifest.previous || null, checkpointCount: checkpoints.length },
    checkpoints,
    changelog: changelog ? {
      base: changelog.base || null,
      head: changelog.head || null,
      filesChanged: (changelog.files || []).length,
      files: (changelog.files || []).slice(0, 60).map(summarizeFile),
    } : null,
    codeMap: codeMapStats(path.join(bundleDir, 'code-map.md')),
    publishedAt: manifest.gate?.clean ? new Date().toISOString() : null,
  };
}

module.exports = { entireSummary, codeMapStats, commitsByCheckpoint };

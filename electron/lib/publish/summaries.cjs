// AI summaries of checkpoints, for hover text on the marketplace. Opt-in per publish: Entire writes the
// summary from the transcript on the creator's machine, with the creator's own summarizer credits.
// Each summary is sanitized, then scanned for secrets; a summary that fails is dropped, never shown.
const { execFile } = require('node:child_process');
const { sanitize } = require('./sanitize.cjs');
const secrets = require('./secrets.cjs');

const SECTIONS = ['Intent', 'Outcome', 'Learnings'];

// Plain text for display: headings and list markers become sentences and bullets.
function plain(text) {
  return String(text).replace(/^#{1,6}\s*(.+)$/gm, '$1:').replace(/^\s*[-*]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
}

// Parse "## Intent / ## Outcome / ## Learnings" into { intent, outcome, learnings }.
function parseSummary(text) {
  const out = {};
  const parts = String(text).split(/^## /m).slice(1);
  for (const part of parts) {
    const [head, ...body] = part.split('\n');
    const key = head.trim().toLowerCase();
    if (SECTIONS.map((s) => s.toLowerCase()).includes(key)) out[key] = plain(body.join('\n'));
  }
  return { intent: out.intent || '', outcome: out.outcome || '', learnings: out.learnings || '' };
}

function generate(repoDir, checkpointId) {
  return new Promise((resolve) => {
    execFile(process.env.BENANA_ENTIRE || 'entire', ['checkpoint', 'explain', checkpointId, '--generate', '--force', '--short'], { cwd: repoDir, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : String(stdout || '')));
  });
}

// Returns { [checkpointId]: { intent, outcome, learnings } | null, dropped: [{checkpointId, reason}] }.
async function summariesFor(repoDir, checkpointIds, { generateFn = generate } = {}) {
  const out = {};
  const dropped = [];
  for (const id of checkpointIds) {
    const raw = await generateFn(repoDir, id);
    if (!raw) { dropped.push({ checkpointId: id, reason: 'could not generate' }); out[id] = null; continue; }
    const clean = sanitize(parsed(raw));
    const scan = await secrets.scanText('summary.md', clean.text);
    if (!scan.clean) { dropped.push({ checkpointId: id, reason: scan.error || 'secret-like content' }); out[id] = null; continue; }
    if (clean.suspicious.length) { dropped.push({ checkpointId: id, reason: 'random-looking token' }); out[id] = null; continue; }
    out[id] = parseSummary(clean.text);
  }
  return { summaries: out, dropped };
}
const parsed = (raw) => raw; // kept for symmetry: the summary is sanitized as text before parsing

module.exports = { parseSummary, plain, summariesFor, generate };

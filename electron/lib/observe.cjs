// Observation-side token mechanisms, adapted from SoL-Pi (arXiv:2609.20519):
//
//  - Evidence-Preserving Reducer: build/test logs >= 4 KiB are reduced to a compact receipt of
//    exact quoted lines. A deterministic verifier checks the receipt (schema, source hash, exact
//    quotes, smaller than the original) and we fall back to the original when it fails.
//    The paper uses a cheap model for extraction; we use a deterministic extractor, which costs
//    no tokens and keeps the same verifier contract.
//  - ObservationPack: outputs > 10 KiB are archived locally and replaced by a stable handle plus
//    a short head/tail excerpt. The exact text stays retrievable page by page.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REDUCE_MIN = 4 * 1024;
const PACK_MIN = 10 * 1024;
const EXCERPT = 1024;
const RECEIPT = 'benana.receipt/1';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ERROR_RE = /\b(error|fail(ed|ure|ing)?|exception|panic|assert(ion)?|expected|received|traceback|cannot|undefined|not found|ENOENT|TypeError|ReferenceError|SyntaxError)\b|✖|✗|FAIL\b|^\s+at\s/i;
const SUMMARY_RE = /\b(\d+\s+(passed|failed|skipped|tests?|errors?|warnings?)|Tests?:|Test Suites?:|exit code)\b/i;

// Picks the lines a reader needs to diagnose the run: error lines with one line of context,
// summary lines, and the last few lines. Every quote is an exact line of the original.
function extractEvidence(text, { maxQuotes = 40, contextLines = 1 } = {}) {
  const lines = text.split('\n');
  const keep = new Set();
  lines.forEach((l, i) => {
    if (ERROR_RE.test(l)) for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) keep.add(j);
    else if (SUMMARY_RE.test(l)) keep.add(i);
  });
  for (let i = Math.max(0, lines.length - 5); i < lines.length; i++) keep.add(i);
  const idx = [...keep].sort((a, b) => a - b).filter((i) => lines[i].trim());
  // Prefer the earliest errors (root causes) and the tail (summary) when over budget.
  const chosen = idx.length > maxQuotes ? [...idx.slice(0, maxQuotes - 5), ...idx.slice(-5)] : idx;
  return [...new Set(chosen)].map((i) => ({ line: i + 1, text: lines[i].slice(0, 400) }));
}

function reduce(text, { command = '', exitCode = null } = {}) {
  const original = String(text ?? '');
  if (Buffer.byteLength(original) < REDUCE_MIN) return { reduced: false, text: original };
  const receipt = {
    schema: RECEIPT, command, exitCode, sourceSha256: sha(original),
    bytes: Buffer.byteLength(original), lines: original.split('\n').length, quotes: extractEvidence(original),
  };
  const v = verifyReceipt(receipt, original);
  if (!v.ok) return { reduced: false, text: original, fallback: v.reason };
  return { reduced: true, receipt, text: renderReceipt(receipt) };
}

// Deterministic verifier: any failure means the caller must use the original text.
function verifyReceipt(r, original) {
  if (!r || r.schema !== RECEIPT) return { ok: false, reason: 'schema' };
  if (r.sourceSha256 !== sha(original)) return { ok: false, reason: 'source hash' };
  if (!Array.isArray(r.quotes) || !r.quotes.length) return { ok: false, reason: 'no evidence' };
  const lines = original.split('\n');
  for (const q of r.quotes) if (!lines[q.line - 1]?.startsWith(q.text)) return { ok: false, reason: `quote ${q.line} not exact` };
  if (Buffer.byteLength(renderReceipt(r)) >= Buffer.byteLength(original)) return { ok: false, reason: 'no size reduction' };
  if (/(api[_-]?key|secret|token|password)\s*[:=]\s*\S{8,}/i.test(renderReceipt(r))) return { ok: false, reason: 'credential suspected' };
  return { ok: true };
}

function renderReceipt(r) {
  let prev = 0;
  const body = r.quotes.map((q) => { const gap = q.line > prev + 1 ? '  ⋯\n' : ''; prev = q.line; return `${gap}${String(q.line).padStart(5)}│ ${q.text}`; }).join('\n');
  return `[receipt ${r.sourceSha256.slice(0, 12)} · ${r.command || 'output'} · exit ${r.exitCode ?? '?'} · ${r.lines} lines/${r.bytes} B reduced to exact evidence]\n${body}`;
}

// ObservationPack store. Handles are content-addressed so repeats share one archive.
class Pack {
  constructor(dir) { this.dir = dir; }

  pack(text, { label = 'output' } = {}) {
    const s = String(text ?? '');
    const bytes = Buffer.byteLength(s);
    if (bytes <= PACK_MIN) return { packed: false, text: s };
    const handle = `obs_${sha(s).slice(0, 16)}`;
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${handle}.txt`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, s);
    const head = s.slice(0, EXCERPT / 2);
    const tail = s.slice(-EXCERPT / 2);
    return {
      packed: true, handle, bytes,
      text: `[${label} archived as ${handle} · ${bytes} B · call bench_page with this handle for exact text]\n${head.slice(0, head.lastIndexOf('\n') + 1 || head.length)}  ⋯\n${tail.slice(tail.indexOf('\n') + 1)}`,
    };
  }

  page(handle, { offset = 0, length = 8000 } = {}) {
    if (!/^obs_[0-9a-f]{16}$/.test(handle)) throw new Error('bad handle');
    const file = path.join(this.dir, `${handle}.txt`);
    if (!fs.existsSync(file)) throw new Error(`unknown handle ${handle}`);
    const s = fs.readFileSync(file, 'utf8');
    const len = Math.min(Math.max(1, length), 20000);
    return { handle, offset, length: len, total: s.length, text: s.slice(offset, offset + len), more: offset + len < s.length };
  }
}

// Reduce first (receipts are kept whole), then pack whatever is still large.
function observe(text, { pack, command, exitCode, label } = {}) {
  const r = reduce(text, { command, exitCode });
  if (r.reduced || !pack) return { ...r, packed: false };
  const p = pack.pack(r.text, { label });
  return { ...r, ...p };
}

// Online Context Compact cost gate, applied at our natural boundary: a grader retry.
// Resuming re-reads the whole session (mostly from cache); a fresh session pays for a short
// handoff, but loses the warm cache. Compact only if projected savings beat the rewrite cost
// by a margin.
function compactGate({ contextTokens = 0, expectedTurns = 4, handoffTokens = 1500, cacheReadPrice = 0.1, cacheWritePrice = 1.25, margin = 1.3 }) {
  const resume = contextTokens * expectedTurns * cacheReadPrice;
  const fresh = handoffTokens * cacheWritePrice + handoffTokens * (expectedTurns - 1) * cacheReadPrice;
  return { compact: resume > fresh * margin, resume: Math.round(resume), fresh: Math.round(fresh) };
}

module.exports = { reduce, verifyReceipt, renderReceipt, extractEvidence, Pack, observe, compactGate, REDUCE_MIN, PACK_MIN };

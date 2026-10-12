// Secret scanning before anything is published. Wraps gitleaks (https://github.com/gitleaks/gitleaks).
// Fails closed: if the scanner is missing or errors, the publish is blocked, never waved through.
// Findings report rule, file and line only. The secret value is redacted by gitleaks and never stored.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const BIN = () => process.env.BENANA_GITLEAKS || 'gitleaks';

// gitleaks exit codes: 0 = no leaks, 1 = leaks found, anything else = the scan itself failed.
function run(args, { bin = BIN(), timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') return resolve({ code: -1, error: 'gitleaks is not installed (brew install gitleaks).' });
      if (error && typeof error.code !== 'number') return resolve({ code: -1, error: `gitleaks failed to run: ${String(error.message).slice(0, 200)}` });
      resolve({ code: error ? error.code : 0, stderr: String(stderr || '') });
    });
  });
}

// Scan a directory. Returns { clean, findings, error }.
async function scanDir(dir, opts = {}) {
  const report = path.join(os.tmpdir(), `benana-gitleaks-${process.pid}-${Date.now()}.json`);
  try {
    const res = await run(['dir', dir, '--report-format', 'json', '--report-path', report, '--redact', '--no-banner'], opts);
    if (res.code === -1) return { clean: false, findings: [], error: res.error };
    if (res.code !== 0 && res.code !== 1) return { clean: false, findings: [], error: `gitleaks exited with ${res.code}: ${res.stderr.slice(0, 200)}` };
    const raw = res.code === 1 && fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : [];
    const findings = raw.map((f) => ({
      rule: f.RuleID,
      file: path.relative(dir, f.File || '') || f.File,
      line: f.StartLine,
    }));
    // Exit 1 without a readable report would be a silent pass; treat it as a failed scan.
    if (res.code === 1 && findings.length === 0) return { clean: false, findings: [], error: 'gitleaks reported leaks but wrote no findings.' };
    return { clean: findings.length === 0, findings, error: null };
  } finally {
    fs.rmSync(report, { force: true });
  }
}

// Scan one piece of text (for example, a checkpoint transcript) under a given file name.
async function scanText(name, text, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benana-scan-'));
  try {
    fs.writeFileSync(path.join(dir, name), text);
    return await scanDir(dir, opts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Scan a checkpoint's metadata and transcript together. Entire can carry secrets in transcripts
// that its own redaction misses (see docs/marketplace/SPEC.md), so both are checked.
async function scanCheckpoint(repoDir, checkpointId, { execute, ...opts } = {}) {
  const entire = execute || defaultExecute;
  const meta = await entire(['checkpoint', 'explain', checkpointId, '--json'], repoDir);
  const transcript = await entire(['checkpoint', 'explain', checkpointId, '--transcript'], repoDir);
  if (!meta.ok || !transcript.ok) {
    return { checkpointId, clean: false, findings: [], error: `could not read checkpoint ${checkpointId}` };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benana-ckpt-'));
  try {
    fs.writeFileSync(path.join(dir, 'metadata.json'), meta.out);
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), transcript.out);
    const res = await scanDir(dir, opts);
    return { checkpointId, ...res };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The publish gate: every checkpoint must be clean. Returns { ok, blocked }.
async function publishGate(repoDir, checkpointIds, opts = {}) {
  const blocked = [];
  for (const id of checkpointIds) {
    const res = await scanCheckpoint(repoDir, id, opts);
    if (!res.clean) blocked.push({ checkpointId: id, findings: res.findings, error: res.error });
  }
  return { ok: blocked.length === 0, blocked };
}

function defaultExecute(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.env.BENANA_ENTIRE || 'entire', args, { cwd, timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, out: String(stdout || '') });
    });
  });
}

module.exports = { scanDir, scanText, scanCheckpoint, publishGate };

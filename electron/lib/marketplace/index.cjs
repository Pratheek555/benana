// Marketplace, local storage mode: files stay on this machine under ~/.benana/marketplace;
// Supabase holds only rows (listings, versions, checkpoints, votes, reviews, reports).
// Publishing goes through the publish gate: sanitize → secret scan → evidence bundle.
//
// Until GitHub sign-in is configured, the main process publishes as one local publisher account
// (BENANA_PUBLISHER_ID) with the service key. The key never reaches the renderer.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { dataDir, env } = require('../env.cjs');
const { git } = require('../git.cjs');
const bundle = require('../publish/bundle.cjs');
const { entireSummary } = require('./entire-summary.cjs');
const summaries = require('../publish/summaries.cjs');
const { sanitize } = require('../publish/sanitize.cjs');
const secrets = require('../publish/secrets.cjs');
const remote = require('./entire-remote.cjs');

const storeDir = path.join(dataDir, 'marketplace');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const slugOf = (name) => name.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 48);

function configured() {
  return Boolean(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY') && env('BENANA_PUBLISHER_ID'));
}

async function sb(p, init = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1${p}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Marketplace ${init.method || 'GET'} ${p.split('?')[0]}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function jarOf(mod) {
  const target = path.join(mod.repoDir, 'target');
  const named = path.join(target, `${mod.name}.jar`);
  if (fs.existsSync(named)) return named;
  const any = fs.existsSync(target) ? fs.readdirSync(target).find((f) => f.endsWith('.jar') && !f.startsWith('original-')) : null;
  return any ? path.join(target, any) : null;
}

function playtestOf(mod) {
  const last = [...(mod.attempts || [])].reverse().find((a) => a.verdict);
  if (!last) return { status: 'not_tested', summary: 'Not playtested yet.' };
  const v = last.verdict;
  const tally = (v.checks || []).map((c) => `${c.id}: ${c.status}`).join(', ');
  return { status: v.passed ? 'passed' : 'failed', summary: `${v.summary || ''}${tally ? ` (${tally})` : ''}`.trim().slice(0, 2000) };
}

// A remix publishes as its own listing, never as a new version of the listing it came from.
const slugFor = (mod) => (mod.origin ? `${slugOf(mod.name)}-remix-${mod.id.slice(-4)}` : slugOf(mod.name));

const originOf = (mod) => (mod.origin ? { slug: mod.origin.marketplace, name: mod.origin.name || null, version: mod.origin.version, checkpoint: mod.origin.checkpoint, commit: mod.origin.commit, repo: mod.origin.repo || null } : null);

// Everything a remixer's agents need to continue the mod: what it does, how it is tested, how it got here.
// Prompts and summaries only; transcripts travel as checkpoint refs, gated separately.
function contextOf(mod, { slug, number, head, entire, play }) {
  const turns = (mod.turns?.length ? mod.turns : [{ prompt: mod.prompt }]).map((t) => ({ prompt: t.prompt, summary: t.summary || null, status: t.status || null, revision: Boolean(t.revision) }));
  const attempts = (mod.attempts || []).map((a) => ({
    n: a.n, turn: a.turn ?? 0, role: a.role, status: a.status || null,
    failure: a.failure ? { kind: a.failure.kind, summary: String(a.failure.summary || '').slice(0, 600) } : null,
    verdict: a.verdict ? { passed: a.verdict.passed, summary: String(a.verdict.summary || '').slice(0, 600) } : null,
    lesson: a.lesson || null, summary: a.summary ? String(a.summary).slice(0, 800) : null,
  }));
  return {
    schema: 1, slug, number, name: mod.name, commit: head,
    spec: mod.spec || null, testPlan: mod.testPlan || null, playtest: play,
    turns, attempts,
    checkpoints: (entire?.checkpoints || []).map(({ id, commit, agent, model, files, summary, hasTranscript }) => ({ id, commit, agent, model, files, summary: summary || null, hasTranscript })),
    lineage: [...(mod.origin?.lineage || []), ...(mod.origin ? [originOf(mod)] : [])],
  };
}

// Publish the mod's current commit as a new version. Returns { ok, skipped?, blocked?, listing, version }.
// sessions: '*' (all), an array of session IDs to include transcripts for, or [] for metadata only.
async function publish(mod, { log = () => {}, sessions = '*', withSummaries = false, useEntire = true } = {}) {
  if (!configured()) throw new Error('Marketplace is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BENANA_PUBLISHER_ID).');
  if (!mod.repoDir) throw new Error(`${mod.name} has no repository yet.`);
  const jar = jarOf(mod);
  if (!jar) throw new Error(`${mod.name} has no built jar yet.`);
  const slug = slugFor(mod);
  const head = (await git(mod.repoDir, ['rev-parse', 'HEAD'])).trim();

  let [listing] = await sb(`/listings?slug=eq.${slug}&select=*`);
  const [prev] = listing ? await sb(`/versions?listing_id=eq.${listing.id}&order=number.desc&limit=1&select=*`) : [];
  if (prev?.commit_sha === head) return { ok: true, skipped: 'This commit is already published.', listing, version: prev };
  const number = (prev?.number || 0) + 1;

  const out = path.join(storeDir, slug, `v${number}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  log(`${mod.name} v${number}: building the evidence bundle and running the secret gate`);
  // The previous version may come from another machine's repo; without its commit here, the changelog starts from scratch.
  const previous = prev?.commit_sha && await git(mod.repoDir, ['cat-file', '-e', `${prev.commit_sha}^{commit}`]).then(() => true, () => false) ? prev.commit_sha : null;
  const built = await bundle.build({ repoDir: mod.repoDir, version: head, previous, jarPath: jar, sessions, outDir: path.join(out, 'bundle') });
  if (!built.ok) {
    fs.rmSync(out, { recursive: true, force: true });
    return { ok: false, blocked: true, gate: built.manifest.gate, metadataOnlyPossible: !built.manifest.gate.error && built.manifest.gate.suspicious.length > 0 && built.manifest.gate.suspicious.every((x) => x.file === 'transcript.jsonl' || x.transcript) && built.manifest.gate.findings.length === 0 };
  }

  // The jar, and without Entire a local copy of the source. The local checkpoint refs are raw (unsanitized), so they
  // never go in it; on Entire the sanitized ones are pushed instead.
  fs.copyFileSync(jar, path.join(out, path.basename(jar)));
  if (!useEntire) await git(mod.repoDir, ['bundle', 'create', path.join(out, 'source.bundle'), 'HEAD']);

  const play = playtestOf(mod);
  const m = built.manifest;
  // Opt-in AI summaries: generated on this machine with the creator's summarizer, sanitized and scanned.
  let entire = entireSummary(path.join(out, 'bundle'), { repoDir: mod.repoDir });
  if (withSummaries && entire) {
    log(`${mod.name}: writing summaries for ${m.checkpoints.length} checkpoint${m.checkpoints.length === 1 ? '' : 's'} (uses your summarizer credits)`);
    const got = await summaries.summariesFor(mod.repoDir, m.checkpoints.map((c) => c.id));
    entire = { ...entire, checkpoints: entire.checkpoints.map((c) => ({ ...c, summary: got.summaries[c.id] || null })) };
    for (const d of got.dropped) log(`${mod.name}: summary for ${d.checkpointId.slice(0, 10)} not published (${d.reason})`);
  }

  // The remix context, sanitized and scanned like the bundle. A finding blocks the publish.
  const context = sanitize(JSON.stringify(contextOf(mod, { slug, number, head, entire, play }), null, 2));
  fs.writeFileSync(path.join(out, 'context.json'), context.text);
  const contextScan = await secrets.scanText('context.json', context.text);
  if (!contextScan.clean || context.suspicious.length) {
    fs.rmSync(out, { recursive: true, force: true });
    return { ok: false, blocked: true, gate: { findings: contextScan.findings || [], suspicious: context.suspicious.map((x) => ({ file: 'context.json', ...x })) }, metadataOnlyPossible: false };
  }

  // Push to Entire: source, sanitized checkpoints, and the meta branch (context, evidence bundle, jar).
  let entireRemote = null;
  if (useEntire) {
    const metaFiles = { [`v${number}/context.json`]: path.join(out, 'context.json'), [`v${number}/${path.basename(jar)}`]: path.join(out, path.basename(jar)) };
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'ref') walk(f, `${rel}/${e.name}`); } else metaFiles[`${rel}/${e.name}`] = f;
      }
    };
    walk(path.join(out, 'bundle'), `v${number}/bundle`);
    const listingFile = path.join(out, 'listing.json');
    fs.writeFileSync(listingFile, JSON.stringify({ slug, name: mod.name, summary: (mod.spec?.summary || '').slice(0, 500), latest: number, origin: originOf(mod) }, null, 2));
    metaFiles['listing.json'] = listingFile;
    const finalScan = await secrets.scanDir(out);
    if (!finalScan.clean) {
      fs.rmSync(out, { recursive: true, force: true });
      return { ok: false, blocked: true, gate: { findings: finalScan.findings, error: finalScan.error, suspicious: [] }, metadataOnlyPossible: false };
    }
    entireRemote = await remote.publishVersion({ repoDir: mod.repoDir, commit: head, slug, number, bundleDir: path.join(out, 'bundle'), metaFiles, checkpoints: m.checkpoints, log });
    log(`${mod.name} v${number}: on Entire at ${entireRemote.repo} (${entireRemote.checkpoints.length} checkpoint${entireRemote.checkpoints.length === 1 ? '' : 's'})`);
  }
  entire = { ...(entire || {}), remote: entireRemote, origin: originOf(mod) };

  if (!listing) {
    [listing] = await sb('/listings', { method: 'POST', body: JSON.stringify({
      owner_id: env('BENANA_PUBLISHER_ID'), slug, name: mod.name, summary: (mod.spec?.summary || mod.prompt || '').slice(0, 500),
      source_repo_url: `benana-local://${slug}`,
    }) });
  }
  const at = entireRemote ? `entire:${entireRemote.repo}#benana/meta:v${number}` : `local:${slug}/v${number}`;
  const manifestSha = sha256(fs.readFileSync(path.join(out, 'bundle', 'manifest.json')));
  const [version] = await sb('/versions', { method: 'POST', body: JSON.stringify({
    listing_id: listing.id, number, jar_path: `${at}/${path.basename(jar)}`,
    jar_sha256: m.jar.sha256, jar_bytes: m.jar.bytes, bundle_path: `${at}/bundle`,
    bundle_manifest_sha256: manifestSha, commit_sha: head, playtest_summary: play.summary, playtest_status: play.status,
    checkpoint_count: m.checkpoints.length, tokens: m.tokens.input + m.tokens.output + m.tokens.cacheRead,
    transcripts: m.checkpoints.filter((c) => c.transcript).length,
    entire,
  }) });
  if (m.checkpoints.length) {
    await sb('/version_checkpoints', { method: 'POST', body: JSON.stringify(m.checkpoints.map((c) => ({ version_id: version.id, checkpoint_id: c.id, has_transcript: c.transcript }))) });
  }
  log(`${mod.name} v${number} published (${m.checkpoints.length} checkpoints, local files in ${out})`);
  return { ok: true, listing, version, dir: out };
}

// Existing versions published before the Entire summary existed: fill it from their local bundles.
async function backfillEntire() {
  const rows = await sb('/versions?select=id,number,listing_id,bundle_path');
  const out = [];
  for (const v of rows) {
    const [l] = await sb(`/listings?id=eq.${v.listing_id}&select=slug`);
    const dir = path.join(storeDir, l.slug, `v${v.number}`, 'bundle');
    // Clone the source bundle so the checkpoint → commit map can be read from its history.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'benana-backfill-'));
    const bundleFile = path.join(storeDir, l.slug, `v${v.number}`, 'source.bundle');
    let summary = null;
    if (fs.existsSync(dir) && fs.existsSync(bundleFile)) {
      await git(work, ['clone', '-q', bundleFile, 'w']).catch(() => {});
      summary = entireSummary(dir, { repoDir: path.join(work, 'w') });
    }
    fs.rmSync(work, { recursive: true, force: true });
    if (!summary) { out.push({ slug: l.slug, number: v.number, skipped: 'no local bundle' }); continue; }
    await sb(`/versions?id=eq.${v.id}`, { method: 'PATCH', body: JSON.stringify({ entire: summary }) });
    out.push({ slug: l.slug, number: v.number, checkpoints: summary.checkpoints.length });
  }
  return out;
}

async function list() {
  if (!configured()) return { configured: false, listings: [] };
  const listings = await sb('/listings?status=eq.live&select=*,versions(*,version_checkpoints(*))&order=created_at.desc');
  const stats = await sb('/listing_stats?select=*');
  const byId = new Map(stats.map((s) => [s.listing_id, s]));
  return {
    configured: true,
    listings: listings.map((l) => ({
      ...l,
      stats: byId.get(l.id) || { votes: 0, stars: null, reviews: 0 },
      versions: (l.versions || []).sort((a, b) => b.number - a.number).map((v) => ({ ...v, localDir: path.join(storeDir, l.slug, `v${v.number}`) })),
    })),
  };
}

// Where to clone one published version from, at one of its checkpoints (or at the version itself when checkpointId is null).
// Versions on Entire clone from there; older ones only from this machine's local copy.
async function checkpointOf(slug, number, checkpointId) {
  const [l] = await sb(`/listings?slug=eq.${encodeURIComponent(slug)}&select=id,name`);
  if (!l) throw new Error('Unknown listing.');
  const [v] = await sb(`/versions?listing_id=eq.${l.id}&number=eq.${Number(number)}&select=id,number,commit_sha,entire`);
  if (!v) throw new Error('Unknown version.');
  let commit = v.commit_sha;
  if (checkpointId) {
    const cp = (v.entire?.checkpoints || []).find((c) => c.id === checkpointId);
    if (!cp?.commit) throw new Error('This checkpoint has no commit in the published source.');
    commit = cp.commit;
  }
  const base = { slug, number: v.number, checkpointId: checkpointId || null, name: l.name, commit, lineage: v.entire?.origin ? [v.entire.origin] : [] };
  if (v.entire?.remote?.repo) return { ...base, repo: v.entire.remote.repo };
  const source = path.join(storeDir, slug, `v${v.number}`, 'source.bundle');
  if (!fs.existsSync(source)) throw new Error('This version was published before mods were stored on Entire, and its source is not on this machine. Publish it again to remix it.');
  return { ...base, source };
}

module.exports = { configured, publish, list, backfillEntire, checkpointOf, storeDir, slugOf, slugFor, remote };

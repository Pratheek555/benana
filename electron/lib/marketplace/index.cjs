// Marketplace, local storage mode: files stay on this machine under ~/.benana/marketplace;
// Supabase holds only rows (listings, versions, checkpoints, votes, reviews, reports).
// Publishing goes through the publish gate: sanitize → secret scan → evidence bundle.
//
// Until GitHub sign-in is configured, the main process publishes as one local publisher account
// (BENANA_PUBLISHER_ID) with the service key. The key never reaches the renderer.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { dataDir, env } = require('../env.cjs');
const { git } = require('../git.cjs');
const bundle = require('../publish/bundle.cjs');

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

// Publish the mod's current commit as a new version. Returns { ok, skipped?, blocked?, listing, version }.
// sessions: '*' (all), an array of session IDs to include transcripts for, or [] for metadata only.
async function publish(mod, { log = () => {}, sessions = '*' } = {}) {
  if (!configured()) throw new Error('Marketplace is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BENANA_PUBLISHER_ID).');
  if (!mod.repoDir) throw new Error(`${mod.name} has no repository yet.`);
  const jar = jarOf(mod);
  if (!jar) throw new Error(`${mod.name} has no built jar yet.`);
  const slug = slugOf(mod.name);
  const head = (await git(mod.repoDir, ['rev-parse', 'HEAD'])).trim();

  let [listing] = await sb(`/listings?slug=eq.${slug}&select=*`);
  const [prev] = listing ? await sb(`/versions?listing_id=eq.${listing.id}&order=number.desc&limit=1&select=*`) : [];
  if (prev?.commit_sha === head) return { ok: true, skipped: 'This commit is already published.', listing, version: prev };
  const number = (prev?.number || 0) + 1;

  const out = path.join(storeDir, slug, `v${number}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  log(`${mod.name} v${number}: building the evidence bundle and running the secret gate`);
  const built = await bundle.build({ repoDir: mod.repoDir, version: head, previous: prev?.commit_sha || null, jarPath: jar, sessions, outDir: path.join(out, 'bundle') });
  if (!built.ok) {
    fs.rmSync(out, { recursive: true, force: true });
    return { ok: false, blocked: true, gate: built.manifest.gate, metadataOnlyPossible: built.manifest.gate.suspicious.every((x) => x.file === 'transcript.jsonl') && built.manifest.gate.findings.length === 0 };
  }

  // The jar and the source (as a git bundle carrying this version's checkpoint refs).
  fs.copyFileSync(jar, path.join(out, path.basename(jar)));
  const refs = [];
  for (const c of built.manifest.checkpoints) {
    const r = (await git(mod.repoDir, ['for-each-ref', '--format=%(refname)', `refs/entire/checkpoints/*/${c.id}`])).trim();
    if (r) refs.push(r);
  }
  await git(mod.repoDir, ['bundle', 'create', path.join(out, 'source.bundle'), 'HEAD', ...refs]);

  if (!listing) {
    [listing] = await sb('/listings', { method: 'POST', body: JSON.stringify({
      owner_id: env('BENANA_PUBLISHER_ID'), slug, name: mod.name, summary: (mod.spec?.summary || mod.prompt || '').slice(0, 500),
      source_repo_url: `benana-local://${slug}`,
    }) });
  }
  const play = playtestOf(mod);
  const m = built.manifest;
  const manifestSha = sha256(fs.readFileSync(path.join(out, 'bundle', 'manifest.json')));
  const [version] = await sb('/versions', { method: 'POST', body: JSON.stringify({
    listing_id: listing.id, number, jar_path: `local:${slug}/v${number}/${path.basename(jar)}`,
    jar_sha256: m.jar.sha256, jar_bytes: m.jar.bytes, bundle_path: `local:${slug}/v${number}/bundle`,
    bundle_manifest_sha256: manifestSha, commit_sha: head, playtest_summary: play.summary, playtest_status: play.status,
    checkpoint_count: m.checkpoints.length, tokens: m.tokens.input + m.tokens.output + m.tokens.cacheRead,
    transcripts: m.checkpoints.filter((c) => c.transcript).length,
  }) });
  if (m.checkpoints.length) {
    await sb('/version_checkpoints', { method: 'POST', body: JSON.stringify(m.checkpoints.map((c) => ({ version_id: version.id, checkpoint_id: c.id, has_transcript: c.transcript }))) });
  }
  log(`${mod.name} v${number} published (${m.checkpoints.length} checkpoints, local files in ${out})`);
  return { ok: true, listing, version, dir: out };
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

module.exports = { configured, publish, list, storeDir, slugOf };

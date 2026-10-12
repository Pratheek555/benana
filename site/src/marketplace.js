// Lists live mods straight from the marketplace tables. Reads use the public anon key; row-level
// security exposes only live listings and their visible reviews.
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const grid = document.getElementById('grid');
const status = document.getElementById('status');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const playtest = (s) => (s === 'passed' ? ['ok', 'Playtest passed'] : s === 'failed' ? ['bad', 'Playtest failed'] : ['', 'Not playtested']);

async function load() {
  if (!URL || !KEY) { status.textContent = ''; grid.innerHTML = '<p class="err">The marketplace is not configured.</p>'; return; }
  const select = 'id,name,slug,summary,created_at,versions(number,playtest_status,checkpoint_count,transcripts,commit_sha,jar_sha256)';
  try {
    const res = await fetch(`${URL}/rest/v1/listings?status=eq.live&select=${encodeURIComponent(select)}&order=created_at.desc`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mods = await res.json();
    // Votes and stars come from a view with no foreign key, so it's fetched separately and joined here.
    const stats = mods.length ? await (await fetch(`${URL}/rest/v1/listing_stats?select=listing_id,votes,stars,reviews`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json() : [];
    const byId = new Map(stats.map((x) => [x.listing_id, x]));
    status.textContent = `${mods.length} mod${mods.length === 1 ? '' : 's'}`;
    if (!mods.length) { grid.innerHTML = '<p class="empty">No mods yet.</p>'; return; }
    grid.innerHTML = mods.map((m) => {
      const v = (m.versions || []).sort((a, b) => b.number - a.number)[0] || {};
      const stats = byId.get(m.id) || {};
      const [tone, label] = playtest(v.playtest_status);
      return `<article class="card">
        <h2>${esc(m.name)}</h2>
        <p>${esc(m.summary) || 'No description.'}</p>
        <div class="meta">
          <span class="pill">v${esc(v.number || 1)}</span>
          <span class="pill ${tone}">${label}</span>
          <span class="pill">${esc(v.checkpoint_count || 0)} checkpoints</span>
          <span class="pill">${esc(stats.votes || 0)} votes</span>
          ${stats.stars ? `<span class="pill">${Number(stats.stars).toFixed(1)} ★</span>` : ''}
        </div>
        <div class="actions">
          <a class="btn" href="benana://install?slug=${encodeURIComponent(m.slug)}&version=${esc(v.number || 1)}">Open in Benana</a>
          <a class="btn ghost" href="marketplace.html?mod=${encodeURIComponent(m.slug)}">Details</a>
        </div>
      </article>`;
    }).join('');
  } catch (e) {
    status.textContent = '';
    grid.innerHTML = `<p class="err">Could not load the marketplace (${esc(e.message)}).</p>`;
  }
}
// Detail page: marketplace.html?mod=<slug>
const slug = new URLSearchParams(location.search).get('mod');
if (slug) detail(slug); else load();

async function detail(slug) {
  document.querySelector('h1').textContent = 'Mod';
  document.querySelector('.lede').textContent = '';
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const [m] = await (await fetch(`${URL}/rest/v1/listings?slug=eq.${encodeURIComponent(slug)}&status=eq.live&select=id,name,slug,summary,versions(number,playtest_status,playtest_summary,checkpoint_count,transcripts,tokens,commit_sha,jar_sha256,created_at,entire)`, { headers })).json();
  if (!m) { status.textContent = ''; grid.innerHTML = '<p class="err">This mod is not listed.</p>'; return; }
  const versions = (m.versions || []).sort((a, b) => b.number - a.number);
  const v = versions[0] || {};
  const e = v.entire || {};
  const stats = (await (await fetch(`${URL}/rest/v1/listing_stats?listing_id=eq.${m.id}&select=votes,stars,reviews`, { headers })).json())[0] || {};
  const [tone, label] = playtest(v.playtest_status);
  const cps = e.checkpoints || [];
  const lang = (e.codeMap?.languages || []).map((l) => `${esc(l.language)} (${l.files} files, ${l.symbols} symbols)`).join(' · ');
  document.querySelector('h1').textContent = m.name;
  document.querySelector('.lede').innerHTML = `${esc(m.summary)}<br><a href="marketplace.html" class="pill">← all mods</a>`;
  status.textContent = `v${v.number} · ${stats.votes || 0} votes${stats.stars ? ` · ${Number(stats.stars).toFixed(1)} ★` : ''}`;
  grid.className = 'detail';
  grid.innerHTML = `
    <section class="panel"><h2>Playtest</h2>
      <p><span class="pill ${tone}">${label}</span> ${esc(v.playtest_summary || '')}</p>
      <div class="meta"><span class="pill">${esc(v.checkpoint_count || 0)} checkpoints</span><span class="pill">${esc(v.transcripts || 0)} with transcripts</span><span class="pill">${Number(v.tokens || 0).toLocaleString()} tokens</span></div>
    </section>
    <section class="panel entire"><h2>Built with Entire</h2>
      <p class="muted">Every agent commit in this mod is linked to an Entire checkpoint. Each checkpoint records the agent, model, session and files that produced it.</p>
      <div class="meta"><span class="pill">${esc(e.provenance?.checkpointCount ?? cps.length)} checkpoints</span><span class="pill">${e.changelog ? esc(e.changelog.filesChanged) + ' files changed' : 'no changelog'}</span>${e.codeMap ? `<span class="pill">${e.codeMap.symbols} symbols · ${e.codeMap.relations} relations</span>` : ''}</div>
      <h3>Checkpoints</h3>
      ${cps.length ? `<ol class="timeline">${cps.map((c) => `<li>
        <div class="row"><code>${esc(c.id)}</code><span class="pill">${esc(c.agent || 'agent')}</span>${c.model ? `<span class="pill">${esc(c.model)}</span>` : ''}${c.hasTranscript ? '<span class="pill ok">transcript</span>' : '<span class="pill">metadata only</span>'}</div>
        <div class="muted">${c.createdAt ? new Date(c.createdAt).toLocaleString() : ''} · ${Number(c.tokens || 0).toLocaleString()} tokens · ${esc(c.sessions)} session${c.sessions === 1 ? '' : 's'}</div>
        ${c.files?.length ? `<div class="files">${c.files.map((f) => `<code>${esc(f)}</code>`).join(' ')}</div>` : ''}
      </li>`).join('')}</ol>` : '<p class="muted">No checkpoints recorded for this version.</p>'}
      <h3>Provenance</h3>
      <dl class="facts"><dt>Commit</dt><dd><code>${esc(v.commit_sha || e.provenance?.commit || '')}</code></dd>
        <dt>Previous</dt><dd><code>${esc(e.provenance?.previous || 'first version')}</code></dd>
        <dt>Jar SHA-256</dt><dd><code>${esc(v.jar_sha256 || '')}</code></dd></dl>
    </section>
    <section class="panel"><h2>Changelog</h2>
      ${e.changelog ? `<p>${e.changelog.filesChanged} file${e.changelog.filesChanged === 1 ? '' : 's'} changed${e.changelog.base ? ` since <code>${esc(String(e.changelog.base).slice(0, 7))}</code>` : ' (first version)'}.</p>
        <ul class="changes">${(e.changelog.files || []).map((f) => `<li>
          <div class="row"><span class="status s-${esc(f.status)}">${({ A: 'added', M: 'changed', D: 'deleted' })[f.status] || esc(f.status)}</span><code>${esc(f.path)}</code>${f.language ? `<span class="pill">${esc(f.language)}</span>` : ''}</div>
          <div class="muted">${f.added ? `+${f.added} ` : ''}${f.removed ? `−${f.removed} ` : ''}${f.changed ? `~${f.changed} ` : ''}${f.signatureChanged ? `· <b>${f.signatureChanged} signature change${f.signatureChanged === 1 ? '' : 's'}</b> ` : ''}${f.dependents ? `· ${f.dependents} dependents` : ''}</div>
          ${f.names?.length ? `<div class="files">${f.names.map((n) => `<code>${esc(n)}</code>`).join(' ')}</div>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">No changelog yet.</p>'}
    </section>
    <section class="panel"><h2>Code map</h2>
      ${e.codeMap ? `<p>${e.codeMap.symbols} symbols and ${e.codeMap.relations} relations (completeness: ${esc(e.codeMap.completeness)}).</p><p class="muted">${lang}</p>` : '<p class="muted">No code map yet.</p>'}
      <p class="muted">Generated by entire-graph. It maps what the mod contains, not whether it is correct.</p>
    </section>`;
  // Commit ids for the sidebar CLI links are shown once the source repository is published.
}

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
          <a class="btn ghost" href="#${esc(m.slug)}" title="Jar SHA-256: ${esc(v.jar_sha256 || '')}">Details</a>
        </div>
      </article>`;
    }).join('');
  } catch (e) {
    status.textContent = '';
    grid.innerHTML = `<p class="err">Could not load the marketplace (${esc(e.message)}).</p>`;
  }
}
load();

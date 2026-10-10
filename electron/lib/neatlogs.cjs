// Neatlogs: read side of run quality for Loop 4 (public API), plus status for the UI.
// Ingestion is done by Neatlogs' own Claude Code plugin / Codex hooks (see execute_yourself.md).
const { env } = require('./env.cjs');

const base = () => (env('NEATLOGS_REGION') === 'eu' ? 'https://eu.app.neatlogs.com' : 'https://app.neatlogs.com') + '/api/v1/public';
const configured = () => Boolean(env('NEATLOGS_API_KEY') && env('NEATLOGS_PROJECT_ID'));

async function api(p, init = {}) {
  const res = await fetch(`${base()}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${env('NEATLOGS_API_KEY')}`, 'x-project-id': env('NEATLOGS_PROJECT_ID'), 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Neatlogs ${p}: ${res.status}`);
  const j = await res.json();
  return j.data ?? j;
}

async function recentTraces(limit = 20) {
  if (!configured()) return [];
  const d = await api(`/traces?limit=${limit}`);
  return Array.isArray(d) ? d : d.items || d.traces || [];
}

async function searchTraces(query) {
  if (!configured()) return [];
  return api('/search/traces', { method: 'POST', body: JSON.stringify({ query }) });
}

async function status() {
  if (!configured()) return { configured: false };
  try { const t = await recentTraces(5); return { configured: true, ok: true, recent: t.length }; }
  catch (e) { return { configured: true, ok: false, error: e.message }; }
}

module.exports = { configured, recentTraces, searchTraces, status };

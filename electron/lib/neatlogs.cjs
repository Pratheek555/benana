// Neatlogs read side for Loop 4 (public API), plus status for the UI.
// Two credentials: NEATLOGS_API_KEY is the SDK project key used by tracing.cjs to export spans;
// reading traces back needs a service-account token in NEATLOGS_TOKEN (the SDK key can't read).
const { env } = require('./env.cjs');

const base = () => (env('NEATLOGS_REGION') === 'eu' ? 'https://eu.app.neatlogs.com' : 'https://app.neatlogs.com') + '/api/v1/public';
const tracing = () => Boolean(env('NEATLOGS_API_KEY'));
const configured = () => Boolean(env('NEATLOGS_TOKEN') && env('NEATLOGS_PROJECT_ID'));

async function api(p, init = {}) {
  const res = await fetch(`${base()}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${env('NEATLOGS_TOKEN')}`, 'x-project-id': env('NEATLOGS_PROJECT_ID'), 'Content-Type': 'application/json', ...(init.headers || {}) },
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
  const base = { tracing: tracing(), configured: configured() };
  if (!base.configured) return { ...base, ok: base.tracing };
  try { const t = await recentTraces(5); return { ...base, ok: true, recent: t.length }; }
  catch (e) { return { ...base, ok: false, error: e.message }; }
}

module.exports = { configured, tracing, recentTraces, searchTraces, status };

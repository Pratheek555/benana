// Every IPC call returns { ok, data | error }; unwrap it into a promise.
export async function call(channel, payload) {
  const res = await window.benana.invoke(channel, payload);
  if (!res?.ok) throw new Error(res?.error || `${channel} failed`);
  return res.data;
}

export const on = (channel, fn) => window.benana.on(channel, fn);

export function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const fmtTokens = (n) => (n > 999 ? `${(n / 1000).toFixed(n > 99999 ? 0 : 1)}k` : String(n || 0));

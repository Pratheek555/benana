// Every IPC call returns { ok, data | error }; unwrap it into a promise.
export const isDemo =
  new URLSearchParams(window.location.search).get("demo") === "1";
let demoBridgePromise;

async function getBridge() {
  if (!isDemo) return window.benana;
  demoBridgePromise ||= import("./demo/bridge.js").then(
    (module) => module.demoBridge,
  );
  return demoBridgePromise;
}

export function hasDesktopBridge() {
  return Boolean(window.benana?.invoke);
}

export async function call(channel, payload) {
  const bridge = await getBridge();
  if (!bridge?.invoke) throw new Error("Benana needs the desktop runtime.");
  const res = await bridge.invoke(channel, payload);
  if (!res?.ok) throw new Error(res?.error || `${channel} failed`);
  return res.data;
}

export const on = (channel, fn) => {
  if (!isDemo) return window.benana?.on?.(channel, fn) || (() => {});
  let off;
  getBridge().then((bridge) => {
    off = bridge.on(channel, fn);
  });
  return () => off?.();
};

export function ago(ts) {
  if (!ts) return "";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const fmtTokens = (n) =>
  n > 999 ? `${(n / 1000).toFixed(n > 99999 ? 0 : 1)}k` : String(n || 0);

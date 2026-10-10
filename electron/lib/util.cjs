// Small shared helpers for the integrations: fetch with timeout + retry, per-key serial
// queues (so two pushes to the same git remote never race), and a debounced scheduler.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch with a hard timeout; retries network errors, 429 and 5xx with exponential backoff.
async function fetchRetry(url, init = {}, { timeoutMs = 15000, retries = 2, backoffMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && i < retries) {
        lastErr = new Error(`${res.status} ${res.statusText}`);
      } else {
        return res;
      }
    } catch (e) {
      lastErr = e.name === 'TimeoutError' ? new Error(`timed out after ${timeoutMs}ms`) : e;
      if (i === retries) break;
    }
    await sleep(backoffMs * 2 ** i);
  }
  throw lastErr;
}

const queues = new Map();
// Runs fn after every earlier task with the same key has settled.
function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

const timers = new Map();
// Coalesces bursts of calls with the same key into one call after `ms` of quiet.
function debounce(key, ms, fn) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms));
}

// Caches an async result for ttlMs; concurrent callers share one in-flight promise.
function cached(ttlMs, fn) {
  let at = 0;
  let value;
  let inflight = null;
  return async (...args) => {
    if (inflight) return inflight;
    if (Date.now() - at < ttlMs) return value;
    inflight = fn(...args).then((v) => { value = v; at = Date.now(); return v; }).finally(() => { inflight = null; });
    return inflight;
  };
}

module.exports = { sleep, fetchRetry, serial, debounce, cached };

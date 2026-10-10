// Neatlogs: read side of run quality for Loop 4 (public API), plus status for the UI.
// Ingestion is done by Neatlogs' own Claude Code plugin / Codex hooks (see execute_yourself.md).
const { env } = require("./env.cjs");

const base = () =>
  (env("NEATLOGS_REGION") === "eu"
    ? "https://eu.app.neatlogs.com"
    : "https://app.neatlogs.com") + "/api/v1/public";
const configured = () =>
  Boolean(env("NEATLOGS_API_KEY") && env("NEATLOGS_PROJECT_ID"));

async function api(p, init = {}) {
  const timeoutMs = init.timeoutMs || 15000;
  const request = { ...init };
  delete request.timeoutMs;
  const res = await fetch(`${base()}${p}`, {
    ...request,
    signal: request.signal || AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${env("NEATLOGS_API_KEY")}`,
      "x-project-id": env("NEATLOGS_PROJECT_ID"),
      "Content-Type": "application/json",
      ...(request.headers || {}),
    },
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
  return api("/search/traces", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

function traceItems(value) {
  return Array.isArray(value)
    ? value
    : value?.traces || value?.spans || value?.items || value?.results || [];
}

async function evidence(run, deps = {}) {
  if (!configured())
    return {
      source: "neatlogs",
      configured: false,
      matched: false,
      traces: [],
      error: "Set NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to link traces.",
    };
  if (!run.sessionId)
    return {
      source: "neatlogs",
      configured: true,
      matched: false,
      traces: [],
      matchReason:
        "The agent did not report a session identifier, so Benana cannot attribute a trace.",
    };
  const request = deps.api || api;
  try {
    const listed = traceItems(
      await request(
        `/traces?limit=20&sessionId=${encodeURIComponent(run.sessionId)}`,
      ),
    );
    const exact = listed.filter(
      (trace) =>
        String(trace.sessionId || trace.session_id || "") ===
        String(run.sessionId),
    );
    const traces = [];
    for (const trace of exact) {
      const id = trace.traceId || trace.trace_id || trace.id;
      let spans = [];
      let spansError;
      if (id) {
        try {
          spans = traceItems(
            await request(`/traces/${encodeURIComponent(id)}/spans?limit=50`),
          );
        } catch (error) {
          spansError = error.message;
        }
      }
      traces.push({ ...trace, spans, ...(spansError ? { spansError } : {}), raw: { trace, spans } });
    }
    return {
      source: "neatlogs",
      configured: true,
      matched: traces.length > 0,
      traces,
      matchReason: traces.length
        ? `Matched exact agent session ${run.sessionId}.`
        : `No trace matched exact agent session ${run.sessionId}.`,
    };
  } catch (error) {
    return {
      source: "neatlogs",
      configured: true,
      matched: false,
      traces: [],
      error: error.message,
    };
  }
}

async function status() {
  if (!configured()) return { configured: false };
  try {
    const t = await recentTraces(5);
    return { configured: true, ok: true, recent: t.length };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

module.exports = {
  configured,
  evidence,
  recentTraces,
  searchTraces,
  status,
  traceItems,
};

// Neatlogs: read side of run quality for Loop 4 (public API), plus status for the UI.
// Two credentials: NEATLOGS_API_KEY is the SDK project key tracing.cjs exports spans with;
// reading traces back needs a service-account token in NEATLOGS_TOKEN (the SDK key can't read).
const { env } = require("./env.cjs");

const base = () =>
  (env("NEATLOGS_REGION") === "eu"
    ? "https://eu.app.neatlogs.com"
    : "https://app.neatlogs.com") + "/api/v1/public";
const tracing = () => Boolean(env("NEATLOGS_API_KEY"));
const configured = () =>
  Boolean(env("NEATLOGS_TOKEN") && env("NEATLOGS_PROJECT_ID"));

async function api(p, init = {}) {
  const timeoutMs = init.timeoutMs || 15000;
  const request = { ...init };
  delete request.timeoutMs;
  const res = await fetch(`${base()}${p}`, {
    ...request,
    signal: request.signal || AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${env("NEATLOGS_TOKEN")}`,
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
      error: "Set NEATLOGS_TOKEN (service account) and NEATLOGS_PROJECT_ID to read traces back.",
    };
  if (run.traceIds?.length) return byTraceIds(run, deps.api || api);
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

// Benana's own run traces: the ids were recorded when the run started, so the match is exact.
async function byTraceIds(run, request) {
  const traces = [];
  for (const id of run.traceIds) {
    try {
      const spans = traceItems(await request(`/traces/${encodeURIComponent(id)}/spans?limit=100`));
      traces.push({ traceId: id, spans, raw: { spans } });
    } catch (error) {
      traces.push({ traceId: id, spans: [], spansError: error.message });
    }
  }
  return {
    source: "neatlogs",
    configured: true,
    matched: traces.some((t) => t.spans.length),
    traces,
    matchReason: `Benana recorded trace ${run.traceIds.join(", ")} for this run.`,
  };
}

async function status() {
  const out = { tracing: tracing(), configured: configured() };
  if (!out.configured) return { ...out, ok: out.tracing };
  try {
    const t = await recentTraces(5);
    return { ...out, ok: true, recent: t.length };
  } catch (e) {
    return { ...out, ok: false, error: e.message };
  }
}

module.exports = {
  configured,
  evidence,
  recentTraces,
  searchTraces,
  status,
  traceItems,
  tracing,
};

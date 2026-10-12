// Neatlogs: read side of run quality for Loop 4 (public API), plus status for the UI.
// Ingestion is done by Neatlogs' own Claude Code plugin / Codex hooks (see execute_yourself.md).
const { env } = require("./env.cjs");

const app = () =>
  env("NEATLOGS_REGION") === "eu"
    ? "https://eu.app.neatlogs.com"
    : "https://app.neatlogs.com";
const base = () => app() + "/api/v1/public";
// Reading needs a service-account token: NEATLOGS_TOKEN, or NEATLOGS_API_KEY when that already holds one
// (the read API answers an export-only key with 401, which is reported below).
const tokenOf = () => env("NEATLOGS_TOKEN") || env("NEATLOGS_API_KEY");
const configured = () => Boolean(tokenOf() && env("NEATLOGS_PROJECT_ID"));

async function api(p, init = {}) {
  const timeoutMs = init.timeoutMs || 15000;
  const request = { ...init };
  delete request.timeoutMs;
  const res = await fetch(`${base()}${p}`, {
    ...request,
    signal: request.signal || AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${tokenOf()}`,
      "x-project-id": env("NEATLOGS_PROJECT_ID"),
      "Content-Type": "application/json",
      ...(request.headers || {}),
    },
  });
  if (res.status === 401) throw new Error("Neatlogs rejected NEATLOGS_TOKEN (401). Use a service-account token; the export key cannot read traces.");
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

// Spans come 50 to a page; a playtest can run past one page.
async function allSpans(request, id, pages = 4) {
  const spans = [];
  let cursor = "";
  for (let i = 0; i < pages; i++) {
    const value = await request(
      `/traces/${encodeURIComponent(id)}/spans?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    spans.push(...traceItems(value));
    cursor = value?.page?.hasMore ? value.page.nextCursor : "";
    if (!cursor) break;
  }
  return spans;
}

// The public API returns no dashboard links, so a trace deep link comes from NEATLOGS_TRACE_URL,
// e.g. https://app.neatlogs.com/<path>/{traceId}. Without it the link opens the dashboard.
function traceUrl(traceId) {
  const template = env("NEATLOGS_TRACE_URL");
  if (!template || !traceId) return { url: app(), deepLink: false };
  return {
    url: template
      .replaceAll("{traceId}", encodeURIComponent(traceId))
      .replaceAll("{projectId}", encodeURIComponent(env("NEATLOGS_PROJECT_ID") || "")),
    deepLink: true,
  };
}

const failed = (span) => String(span.status || span.status_code || "").toUpperCase() === "ERROR";
const spanName = (span) => String(span.spanName || span.name || span.span_name || "span").replace(/^mcp__\w+?__/, "");

// What the chat shows for one trace, and what the fixer is told it read.
function summarize(trace, spans) {
  const ordered = [...spans].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const sequence = [];
  for (const span of ordered.filter((s) => s.spanType === "TOOL")) {
    const name = spanName(span);
    const last = sequence.at(-1);
    if (last?.name === name && last.error === failed(span)) last.n++;
    else sequence.push({ name, n: 1, error: failed(span) });
  }
  const traceId = trace.traceId || trace.trace_id || trace.id;
  return {
    traceId,
    ...traceUrl(traceId),
    status: trace.status,
    finalized: trace.finalizationStatus === "finalized",
    spans: trace.spansCount ?? spans.length,
    toolCalls: trace.toolCallsCount ?? ordered.filter((s) => s.spanType === "TOOL").length,
    llmCalls: trace.llmCallsCount ?? ordered.filter((s) => s.spanType === "LLM").length,
    tokens: trace.totalTokens ?? null,
    costUsd: trace.totalCostUsd ?? null,
    durationMs: trace.durationMs ?? null,
    errors: ordered.filter(failed).map((s) => ({ name: spanName(s), type: s.spanType, durationMs: s.durationMs })),
    sequence: sequence.slice(0, 40),
  };
}

async function evidence(run, deps = {}) {
  if (!configured())
    return {
      source: "neatlogs",
      configured: false,
      matched: false,
      traces: [],
      error: "Set NEATLOGS_TOKEN (service account) and NEATLOGS_PROJECT_ID to read traces.",
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
          spans = await allSpans(request, id);
        } catch (error) {
          spansError = error.message;
        }
      }
      traces.push({ ...trace, spans, summary: summarize(trace, spans), ...(spansError ? { spansError } : {}), raw: { trace, spans } });
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
  summarize,
  traceItems,
  traceUrl,
};

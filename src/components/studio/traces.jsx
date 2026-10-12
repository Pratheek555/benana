import React from "react";
import { call } from "../../api.js";
import { CheckIcon, fmtDuration, fmtMoney, shortSha } from "./shared.jsx";

/* Neatlogs traces for agent sessions. The repo hooks ship spans while a session runs and the trace finalizes
   shortly after it ends, so one shared poller per session feeds the chat chips, the handoff card and the lane. */

const LIVE_MS = 6000;
const SETTLE_MS = 10000;
const SETTLE_TRIES = 12;

const entries = new Map();

function entry(id) {
  if (!entries.has(id)) entries.set(id, { ev: null, after: 0, live: false, timer: null, inflight: false, subs: new Set() });
  return entries.get(id);
}

const finalized = (ev) => Boolean(ev?.matched && ev.traces[0]?.summary?.finalized);

function settled(e) {
  if (e.ev?.configured === false) return true;
  if (e.live) return false;
  return finalized(e.ev) || e.after >= SETTLE_TRIES;
}

function schedule(id) {
  const e = entry(id);
  if (e.timer || e.inflight || !e.subs.size || settled(e)) return;
  e.timer = setTimeout(() => {
    e.timer = null;
    e.inflight = true;
    call("studio:evidence", { sessionId: id })
      .catch((err) => ({ matched: false, traces: [], error: err.message }))
      .then((ev) => {
        e.inflight = false;
        e.ev = ev;
        if (!e.live) e.after++;
        e.subs.forEach((fn) => fn());
        schedule(id);
      });
  }, e.ev ? (e.live ? LIVE_MS : SETTLE_MS) : 0);
}

function watch(id, live, fn) {
  const e = entry(id);
  e.live = live;
  e.subs.add(fn);
  schedule(id);
  return () => {
    e.subs.delete(fn);
    if (!e.subs.size) {
      clearTimeout(e.timer);
      e.timer = null;
    }
  };
}

export function retryTrace(id) {
  const e = entry(id);
  e.after = 0;
  schedule(id);
}

function view(id) {
  const e = entries.get(id);
  const ev = e?.ev;
  const trace = ev?.matched ? ev.traces[0] : null;
  let state;
  if (ev?.configured === false) state = "off";
  else if (e?.live) state = "live";
  else if (finalized(ev)) state = "matched";
  else if (trace) state = "finalizing";
  else if (!ev || e.after < SETTLE_TRIES) state = "looking";
  else state = ev.error ? "error" : "none";
  return { state, ev, trace, summary: trace?.summary || null };
}

/** `sessions`: [{ sessionId, live }]. Returns { [sessionId]: { state, ev, trace, summary } }. */
export function useTraces(sessions) {
  const [, bump] = React.useReducer((x) => x + 1, 0);
  const list = sessions.filter((s) => s.sessionId);
  const key = list.map((s) => `${s.sessionId}:${s.live ? 1 : 0}`).join(",");
  React.useEffect(() => {
    const offs = list.map((s) => watch(s.sessionId, s.live, bump));
    return () => offs.forEach((off) => off());
  }, [key]);
  return Object.fromEntries(list.map((s) => [s.sessionId, view(s.sessionId)]));
}

export const useTrace = (sessionId, live) => useTraces([{ sessionId, live }])[sessionId] || null;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------- Chat: per-turn chip and span drawer ---------- */

export function TraceChip({ sessionId, live, open, onToggle }) {
  const t = useTrace(sessionId, live);
  if (!sessionId || !t) return null;
  const s = t.summary;
  const failed = s?.errors.length || 0;
  const label = {
    off: "Not configured",
    live: s ? `Tracing · ${plural(s.spans, "span")}` : "Tracing",
    looking: "Syncing trace…",
    finalizing: s ? `${plural(s.spans, "span")} · finalizing` : "Finalizing",
    matched: s ? plural(s.spans, "span") : "Traced",
    none: "No trace yet",
    error: "Unreachable",
  }[t.state];
  const canOpen = Boolean(t.trace);
  const canRetry = t.state === "none" || t.state === "error";
  return (
    <button
      className={`nl-chip ${t.state} ${open ? "open" : ""}`}
      disabled={!canOpen && !canRetry}
      aria-expanded={canOpen ? open : undefined}
      title={
        t.state === "off"
          ? t.ev?.error
          : t.state === "error"
            ? `${t.ev?.error || "Neatlogs could not be reached"}. Click to retry.`
            : t.state === "none"
              ? "Neatlogs has no trace for this session yet. Click to check again."
              : `Neatlogs session ${sessionId}`
      }
      onClick={() => (canOpen ? onToggle() : canRetry && retryTrace(sessionId))}
    >
      <i />
      <span className="nl-chip-brand">Neatlogs</span>
      <span>{label}</span>
      {failed > 0 && <span className="nl-chip-err">{failed} failed</span>}
      {canOpen && <span className="nl-chip-caret" />}
    </button>
  );
}

export function TraceDrawer({ sessionId, live }) {
  const t = useTrace(sessionId, live);
  if (!t?.trace) return null;
  const s = t.summary;
  const spans = [...(t.trace.spans || [])]
    .filter((sp) => sp.spanType !== "WORKFLOW")
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const t0 = Date.parse(t.trace.startedAt || spans[0]?.startedAt) || 0;
  const t1 = Math.max(Date.parse(t.trace.completedAt) || 0, ...spans.map((sp) => Date.parse(sp.endedAt) || 0), t0 + 1);
  const pct = (ms) => `${Math.max(0, Math.min(100, ((ms - t0) / (t1 - t0)) * 100))}%`;

  return (
    <div className="nl-drawer">
      <div className="nl-drawer-stats">
        {s.durationMs != null && <span>{fmtDuration(s.durationMs)}</span>}
        <span>{plural(s.toolCalls, "tool call")}</span>
        <span>{plural(s.llmCalls, "LLM call")}</span>
        {s.tokens != null && <span>{s.tokens.toLocaleString()} tokens</span>}
        {s.costUsd != null && <span>{fmtMoney(s.costUsd)}</span>}
        <code title={s.traceId}>trace {String(s.traceId).slice(0, 10)}</code>
      </div>
      <ol className="nl-spans">
        {spans.map((sp) => {
          const start = Date.parse(sp.startedAt) || t0;
          const end = Math.max(Date.parse(sp.endedAt) || start, start);
          const err = String(sp.status).toUpperCase() === "ERROR";
          return (
            <li key={sp.spanId} className={`${err ? "err" : ""} ${sp.spanType === "LLM" ? "llm" : ""}`}>
              <span className="nl-span-type">{sp.spanType === "LLM" ? "LLM" : "tool"}</span>
              <span className="nl-span-name">{String(sp.spanName || "").replace(/^mcp__\w+?__/, "")}</span>
              <span className="nl-span-track">
                <i style={{ left: pct(start), width: `max(2px, calc(${pct(end)} - ${pct(start)}))` }} />
              </span>
              <span className="nl-span-ms">{sp.durationMs >= 1000 ? fmtDuration(sp.durationMs) : `${sp.durationMs || 0}ms`}</span>
            </li>
          );
        })}
      </ol>
      {s.spans > spans.length + 1 && <p className="nl-drawer-more">Showing {spans.length} of {s.spans} spans.</p>}
    </div>
  );
}

/* ---------- Chat: playtest -> fixer handoff ---------- */

const NO_TRACE = {
  unconfigured: "Neatlogs is not configured, so the fixer works from the verdict and Entire checkpoints.",
  notfound: "Neatlogs had not finalized the playtest trace in time, so the fixer works from the verdict and Entire checkpoints.",
};

// Summaries saved before links were recorded fall back to the dashboard.
function TraceLink({ summary }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () =>
    navigator.clipboard.writeText(summary.traceId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="handoff-link">
      <button onClick={() => window.benana?.openExternal(summary.url || "https://app.neatlogs.com")} title={summary.deepLink ? "Open this trace in the Neatlogs dashboard" : "Open the Neatlogs dashboard, then search for the trace ID"}>
        Open in Neatlogs ↗
      </button>
      <code title={summary.traceId}>trace {String(summary.traceId).slice(0, 12)}</code>
      <button className="ghost" onClick={copy}>{copied ? "Copied" : "Copy ID"}</button>
    </div>
  );
}

export function HandoffCard({ mod, n }) {
  const attempt = mod.attempts.find((a) => a.n === n);
  const ctx = attempt?.context;
  const from = mod.attempts.find((a) => a.n === (ctx?.from ?? n - 1));
  const nl = ctx?.neatlogs;
  // Older mods only recorded a trace flag. A late lookup can display the trace, but cannot prove the fixer read it.
  const legacy = useTrace(!nl && ctx?.neatlogsTrace ? from?.sessions.filter((s) => s.role === "playtester").at(-1)?.sessionId : null, false);
  const waiting = !ctx || nl?.state === "waiting";
  const summary = nl?.summary || legacy?.summary;
  const reason = from?.failure?.kind === "build" ? "the build failed" : from?.failure?.kind === "load" ? "the plugin did not load" : null;

  const failedCalls = [];
  for (const e of summary?.errors || []) {
    const last = failedCalls.at(-1);
    if (last?.name === e.name) last.n++;
    else failedCalls.push({ name: e.name, n: 1 });
  }
  const seq = summary?.sequence || [];
  const pain = from?.failure?.summary || from?.verdict?.checks?.find((check) => check.status === "fail")?.observed || "The previous attempt did not pass.";
  const evidenceState = waiting ? "waiting" : summary ? "ready" : "unavailable";
  const entireCount = ctx?.entireCheckpoints || 0;
  const entireReady = entireCount > 0;

  return (
    <div className={`handoff ${waiting ? "waiting" : ""}`}>
      <div className="handoff-head">
        <span className="handoff-mark" aria-hidden="true" />
        <strong>Handoff to the fixer</strong>
        <span className="meta">
          attempt {from?.n ?? n - 1} → attempt {n}
        </span>
      </div>

      <div className="handoff-problem">
        <span>Failure to fix</span>
        <strong>{pain}</strong>
      </div>

      <div className="handoff-src nl">
        <span className="handoff-brand">Neatlogs</span>
        <span className={`evidence-state ${evidenceState}`}>{evidenceState}</span>
        {waiting ? (
          <span className="handoff-wait">
            <span className="spinner" />
            Waiting for the playtest trace to finalize…
          </span>
        ) : summary ? (
          <span>
            {nl?.summary ? "Fixer read" : "Playtest trace found later"}: {plural(summary.spans, "span")}, {plural(summary.toolCalls, "tool call")}
            {summary.errors.length ? (
              <>
                , <b className="bad">{summary.errors.length} failed</b>
              </>
            ) : (
              ", none failed"
            )}
          </span>
        ) : (
          <span className="muted">
            {reason
              ? `No playtest ran in attempt ${from?.n ?? n - 1} because ${reason}, so there is no trace to read.`
              : NO_TRACE[nl?.state] || (nl?.error ? `Could not read the trace: ${nl.error}` : "No playtest trace was read.")}
          </span>
        )}
      </div>

      {summary?.traceId && <TraceLink summary={summary} />}

      {summary && failedCalls.length > 0 && (
        <ul className="handoff-errors">
          {failedCalls.map((c, i) => (
            <li key={i}>
              <CheckIcon status="fail" />
              <code>{c.name}</code>
              {c.n > 1 && <span className="meta">×{c.n}</span>}
            </li>
          ))}
        </ul>
      )}

      {summary && seq.length > 0 && (
        <details className="handoff-sequence">
          <summary>Evidence sequence <span>{seq.length} steps</span></summary>
          <div className="handoff-seq" aria-label="Playtester tool calls in order">
            {seq.map((x, i) => (
              <span key={i} className={x.error ? "err" : ""}>
                {x.name}
                {x.n > 1 && <em>×{x.n}</em>}
              </span>
            ))}
          </div>
        </details>
      )}

      {!waiting && ctx && (
        <div className="handoff-src entire">
          <span className="handoff-brand">Entire</span>
          <span className={`evidence-state ${entireReady ? "ready" : "unavailable"}`}>{entireReady ? "ready" : "unavailable"}</span>
          <span>
            {entireReady ? `Read ${plural(entireCount, "checkpoint")}` : "No Entire checkpoints were available"}
            {ctx.checkpoints?.length > 0 && (
              <>
                {" "}
                {ctx.checkpoints.map((c) => (
                  <code key={c.id} title={c.message}>
                    {shortSha(c.id)}
                  </code>
                ))}
              </>
            )}
          </span>
          {ctx.checkpoints?.length > 0 && (
            <details className="checkpoint-list">
              <summary>Checkpoint messages</summary>
              {ctx.checkpoints.map((c) => (
                <p key={c.id}><code>{shortSha(c.id)}</code><span>{c.message}</span></p>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

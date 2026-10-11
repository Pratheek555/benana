import React from "react";
import { call } from "../../api.js";
import { ROLE, allSessions, fmtDuration, fmtMoney, sessionMs, shortModel } from "./shared.jsx";
import "./neatlogs.css";

const CHECK_LIMIT = 25;
const IDLE = Object.freeze({ state: "idle" });

function Icon({ name, size = 16 }) {
  const paths = {
    search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.1 3.1" /></>,
    trace: <><path d="M3 3.5h2.5V6H3zM10.5 10h2.5v2.5h-2.5zM5.5 4.75h2.2c2.1 0 3.8 1.7 3.8 3.8V10M3.5 10.5H6V13H3.5zM4.75 10.5V8.75" /></>,
    arrow: <path d="M4 8h8m-3.5-3.5L12 8l-3.5 3.5" />,
    retry: <><path d="M12.5 6A5 5 0 1 0 13 9" /><path d="M9.5 3.5h3v3" /></>,
    chevron: <path d="m5 6.5 3 3 3-3" />,
  };
  return <svg className="nl-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">{paths[name]}</svg>;
}

const traceId = (trace) => trace.traceId || trace.trace_id || trace.id || "";
const spanName = (span) => span.spanName || span.span_name || span.name || "Unnamed span";
const failedSpan = (span) => span.status === "error" || span.status_code === "ERROR" || span.statusCode === "ERROR";

function statusFor(session, lookup) {
  if (!session.sessionId) return { key: "missing", label: "Missing session" };
  if (lookup.state === "loading") return { key: "loading", label: "Checking" };
  if (lookup.state === "unconfigured") return { key: "unconfigured", label: "Not configured" };
  if (lookup.state === "error") return { key: "error", label: "Lookup error" };
  if (lookup.state === "ready") {
    if (lookup.evidence.matched) {
      const count = lookup.evidence.traces?.length || 0;
      return { key: "matched", label: `${count} trace${count === 1 ? "" : "s"}` };
    }
    return { key: "none", label: "No trace" };
  }
  return { key: "unchecked", label: "Unchecked" };
}

function Outcome({ session }) {
  const value = session.ok === false ? "failed" : session.endedAt ? "complete" : "running";
  return <span className={`nl-outcome ${value}`}><i />{value === "failed" ? "Failed" : value === "complete" ? "Completed" : "Running"}</span>;
}

function TraceCard({ trace, index }) {
  const spans = trace.spans || [];
  const failures = spans.filter(failedSpan).length;
  const id = traceId(trace);
  return (
    <details className="nl-trace-card" open={index === 0}>
      <summary>
        <span className="nl-trace-glyph"><Icon name="trace" size={15} /></span>
        <span className="nl-trace-title"><strong>{trace.traceName || trace.name || "Trace"}</strong>{id && <small>{id}</small>}</span>
        <span className="nl-trace-meta">{spans.length} step{spans.length === 1 ? "" : "s"}{trace.durationMs != null && <> · {fmtDuration(trace.durationMs)}</>}</span>
        <Icon name="chevron" size={14} />
      </summary>
      {trace.spansError && <div className="nl-inline-error">Span details unavailable. {trace.spansError}</div>}
      {spans.length ? (
        <ol className="nl-span-list">
          {spans.map((span, spanIndex) => (
            <li className={failedSpan(span) ? "failed" : ""} key={span.spanId || span.span_id || `${id}:${spanIndex}`}>
              <i className="nl-span-node" />
              <div><span>{spanName(span)}</span>{span.failure && <small>{span.failure}</small>}</div>
              {span.durationMs != null && <time>{fmtDuration(span.durationMs)}</time>}
            </li>
          ))}
        </ol>
      ) : !trace.spansError ? <p className="nl-trace-empty">This trace has no span details.</p> : null}
      {failures > 0 && <p className="nl-failure-count">{failures} failed span{failures === 1 ? "" : "s"}</p>}
    </details>
  );
}

export default function NeatlogsPage({ mods, onOpenMod }) {
  const [connection, setConnection] = React.useState({ state: "loading" });
  const [lookups, setLookups] = React.useState({});
  const [selectedKey, setSelectedKey] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [role, setRole] = React.useState("all");
  const [traceFilter, setTraceFilter] = React.useState("all");
  const [bulkChecking, setBulkChecking] = React.useState(false);
  const inFlight = React.useRef(new Map());
  const lookupSnapshot = React.useRef(lookups);
  const sessions = React.useMemo(() => allSessions(mods), [mods]);
  const selected = sessions.find((session) => session.key === selectedKey) || null;

  React.useEffect(() => {
    call("studio:partners").then((partners) => setConnection({ state: "ready", value: partners.neatlogs }))
      .catch((error) => setConnection({ state: "error", error: error.message }));
  }, []);

  const updateLookup = React.useCallback((key, value) => {
    const next = { ...lookupSnapshot.current, [key]: value };
    lookupSnapshot.current = next;
    setLookups(next);
  }, []);

  const check = React.useCallback((session) => {
    if (!session?.sessionId) return Promise.resolve(null);
    const active = inFlight.current.get(session.key);
    if (active) return active;
    updateLookup(session.key, { state: "loading" });
    const request = call("studio:evidence", { sessionId: session.sessionId })
      .then((evidence) => {
        if (evidence?.configured === false) setConnection({ state: "ready", value: { configured: false } });
        const next = evidence?.configured === false
          ? { state: "unconfigured", error: evidence.error, evidence }
          : evidence?.error ? { state: "error", error: evidence.error, evidence } : { state: "ready", evidence: evidence || { matched: false, traces: [] } };
        updateLookup(session.key, next);
        return next;
      })
      .catch((error) => {
        const next = { state: "error", error: error.message };
        updateLookup(session.key, next);
        return next;
      })
      .finally(() => inFlight.current.delete(session.key));
    inFlight.current.set(session.key, request);
    return request;
  }, [updateLookup]);

  React.useEffect(() => {
    if (selected?.sessionId && connection.state !== "loading" && connection.value?.configured !== false && (lookups[selected.key] || IDLE).state === "idle") check(selected);
  }, [selected?.key, selected?.sessionId, check, lookups, connection]);

  const successful = Object.values(lookups).filter((item) => item.state === "ready");
  const matched = successful.filter((item) => item.evidence.matched).length;
  const linked = sessions.filter((session) => session.sessionId);
  const pending = linked.filter((session) => (lookups[session.key] || IDLE).state === "idle");
  const totalTokens = sessions.reduce((sum, session) => sum + (session.usage?.inputTokens || 0) + (session.usage?.outputTokens || 0), 0);
  const totalSpend = sessions.reduce((sum, session) => sum + (session.usage?.costUsd || 0), 0);
  const roles = [...new Set(sessions.map((session) => session.role).filter(Boolean))];
  const filtered = sessions.filter((session) => {
    const status = statusFor(session, lookups[session.key] || IDLE).key;
    const haystack = [session.mod.name, ROLE[session.role] || session.role, session.model, session.sessionId, session.attemptN ? `attempt ${session.attemptN}` : "spec"].filter(Boolean).join(" ").toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (role === "all" || session.role === role) && (traceFilter === "all" || status === traceFilter);
  });

  const checkAll = async () => {
    const batch = pending.slice(0, CHECK_LIMIT);
    if (!batch.length) return;
    setBulkChecking(true);
    for (const session of batch) {
      if ((lookupSnapshot.current[session.key] || IDLE).state === "idle") {
        const result = await check(session);
        if (result?.state === "unconfigured") break;
      }
    }
    setBulkChecking(false);
  };
  const clearFilters = () => { setQuery(""); setRole("all"); setTraceFilter("all"); };
  const connectionValue = connection.state === "ready" ? connection.value : null;
  const connectionKind = connection.state === "loading" ? "loading" : connection.state === "error" || connectionValue?.ok === false ? "unreachable" : connectionValue?.configured === false ? "unconfigured" : "connected";
  const connectionLabel = { loading: "Checking connection", unreachable: "Neatlogs unreachable", unconfigured: "Neatlogs not configured", connected: "Connected to Neatlogs" }[connectionKind];
  const connectionDetail = connection.state === "error" ? connection.error : connectionValue?.error || (connectionValue?.configured === false ? "Add NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to link sessions." : null);
  const selectedLookup = selected ? lookups[selected.key] || IDLE : IDLE;
  const selectedEvidence = selectedLookup.evidence || null;

  return (
    <div className="view neatlogs-page">
      <header className="nl-header">
        <div className="nl-heading"><span className="nl-mark" aria-hidden="true">N</span><div><h1>Neatlogs</h1><p>Trace every agent session from build to fix.</p></div></div>
        <div className={`nl-connection ${connectionKind}`} title={connectionDetail || "Neatlogs is available"}><i /><span>{connectionLabel}</span></div>
      </header>
      {connectionDetail && <div className={`nl-connection-detail ${connectionKind}`}>{connectionDetail}</div>}

      <section className="nl-kpis" aria-label="Session summary">
        <article><span>Agent sessions</span><strong>{sessions.length.toLocaleString()}</strong><small>Across {mods.length} mod{mods.length === 1 ? "" : "s"}</small></article>
        <article><span>Trace matches</span><strong>{successful.length ? matched.toLocaleString() : "—"}</strong><small>{successful.length ? `${matched} of ${successful.length} successful checks` : "No successful checks"}</small></article>
        <article><span>Total tokens</span><strong>{totalTokens.toLocaleString()}</strong><small>{linked.length} linked session{linked.length === 1 ? "" : "s"}</small></article>
        <article><span>Session spend</span><strong>{fmtMoney(totalSpend)}</strong><small>Reported by agent sessions</small></article>
      </section>

      <div className="nl-workspace">
        <section className="nl-browser" aria-label="Agent sessions">
          <div className="nl-browser-head"><div><h2>Sessions</h2><span>{filtered.length} of {sessions.length}</span></div><button className="nl-check-button" onClick={checkAll} disabled={bulkChecking || connection.state === "loading" || connectionValue?.configured === false || pending.length === 0}><Icon name={bulkChecking ? "retry" : "trace"} size={15} />{connectionValue?.configured === false ? "Neatlogs not configured" : bulkChecking ? "Checking traces" : pending.length ? `Check ${Math.min(pending.length, CHECK_LIMIT)} traces` : linked.length ? "All linked checked" : "No linked sessions"}</button></div>
          <div className="nl-toolbar">
            <label className="nl-search"><Icon name="search" size={15} /><span className="sr-only">Search sessions</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" /></label>
            <label className="nl-select"><span className="sr-only">Filter by role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option>{roles.map((value) => <option value={value} key={value}>{ROLE[value] || value}</option>)}</select><Icon name="chevron" size={13} /></label>
            <div className="nl-segments" aria-label="Filter by trace status">{[["all", "All"], ["matched", "Matched"], ["none", "No trace"], ["unchecked", "Unchecked"], ["error", "Errors"]].map(([value, label]) => <button className={traceFilter === value ? "active" : ""} aria-pressed={traceFilter === value} onClick={() => setTraceFilter(value)} key={value}>{label}</button>)}</div>
          </div>
          <div className="nl-table-scroll">
            {sessions.length ? filtered.length ? (
              <table className="nl-table"><thead><tr><th>Session</th><th>Model</th><th className="num">Duration</th><th className="num">Cost</th><th>Trace</th></tr></thead><tbody>{filtered.map((session) => {
                const status = statusFor(session, lookups[session.key] || IDLE);
                return <tr className={session.key === selectedKey ? "active" : ""} key={session.key} onClick={() => setSelectedKey(session.key)}>
                  <td><button className="nl-session-button" onClick={() => setSelectedKey(session.key)} aria-pressed={session.key === selectedKey}><span className="nl-session-name">{session.mod.name}</span><span>{ROLE[session.role] || session.role} · {session.attemptN ? `Attempt ${session.attemptN}` : "Spec"}</span></button></td>
                  <td className="nl-model">{shortModel(session.model) || "—"}</td><td className="num">{fmtDuration(sessionMs(session)) || (session.endedAt ? "—" : "Running")}</td><td className="num">{fmtMoney(session.usage?.costUsd)}</td><td><span className={`nl-trace-status ${status.key}`}><i />{status.label}</span></td>
                </tr>;
              })}</tbody></table>
            ) : <div className="nl-empty nl-filter-empty"><Icon name="search" size={22} /><h3>No sessions match</h3><p>Clear the filters to see all agent sessions.</p><button onClick={clearFilters}>Clear filters</button></div>
              : <div className="nl-empty nl-filter-empty"><Icon name="trace" size={24} /><h3>No sessions yet</h3><p>Agent sessions appear here after a mod starts building.</p></div>}
          </div>
        </section>

        <aside className="nl-inspector" aria-label="Session trace details">
          {!selected ? <div className="nl-empty nl-inspector-empty"><span className="nl-empty-icon"><Icon name="trace" size={25} /></span><h2>Inspect a session</h2><p>Select a session to see its outcome, usage, and connected Neatlogs spans.</p><small>Use the session list to move between agent runs.</small></div> : (
            <div className="nl-detail">
              <div className="nl-detail-head"><div><span>{selected.mod.name}</span><h2>{ROLE[selected.role] || selected.role}</h2></div><button onClick={() => onOpenMod(selected.mod.id)}>Open mod <Icon name="arrow" size={14} /></button></div>
              <div className="nl-detail-line"><span>{selected.attemptN ? `Attempt ${selected.attemptN}` : "Spec"}</span><Outcome session={selected} /></div>
              {selected.ok === false && selected.error && <div className="nl-session-error">{selected.error}</div>}
              <dl className="nl-facts"><div><dt>Tokens</dt><dd>{((selected.usage?.inputTokens || 0) + (selected.usage?.outputTokens || 0)).toLocaleString()}</dd><small>{(selected.usage?.inputTokens || 0).toLocaleString()} in · {(selected.usage?.outputTokens || 0).toLocaleString()} out</small></div><div><dt>Duration</dt><dd>{fmtDuration(sessionMs(selected)) || (selected.endedAt ? "—" : "Running")}</dd><small>{shortModel(selected.model) || "Model not reported"}</small></div><div><dt>Cost</dt><dd>{fmtMoney(selected.usage?.costUsd)}</dd><small>Reported spend</small></div></dl>
              <div className="nl-session-id"><span>Session ID</span><code title={selected.sessionId || "No session ID reported"}>{selected.sessionId || "Not reported"}</code></div>
              <section className="nl-traces-section">
                <div className="nl-section-title"><h3>Traces</h3>{selectedLookup.state === "ready" && <span>{selectedEvidence?.traces?.length || 0}</span>}</div>
                {!selected.sessionId ? <div className="nl-lookup-message"><h4>Session ID missing</h4><p>Benana cannot request an exact Neatlogs trace for this session.</p></div>
                  : connectionValue?.configured === false || selectedLookup.state === "unconfigured" ? <div className="nl-lookup-message"><h4>Neatlogs not configured</h4><p>{selectedLookup.error || "Add NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to link sessions to traces."}</p></div>
                  : selectedLookup.state === "idle" || selectedLookup.state === "loading" ? <div className="nl-loading"><i /><span>Looking up the exact session</span></div>
                  : selectedLookup.state === "error" ? <div className="nl-lookup-message error"><h4>Trace lookup failed</h4><p>{selectedLookup.error}</p><button onClick={() => check(selected)}><Icon name="retry" size={14} /> Retry lookup</button></div>
                  : selectedEvidence?.matched ? <>{selectedEvidence.matchReason && <p className="nl-match-reason">{selectedEvidence.matchReason}</p>}{(selectedEvidence.traces || []).map((trace, index) => <TraceCard trace={trace} index={index} key={traceId(trace) || index} />)}</>
                  : <div className="nl-lookup-message"><h4>No trace matched</h4><p>{selectedEvidence?.matchReason || "Neatlogs has no exact trace for this session yet."}</p><button onClick={() => check(selected)}><Icon name="retry" size={14} /> Check again</button></div>}
              </section>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

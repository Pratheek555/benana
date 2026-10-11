import React from "react";
import { call } from "../../api.js";
import { Markdown } from "./BuildPage.jsx";
import { CheckIcon, ROLE, allSessions, fmtDuration, fmtMoney, sessionMs, shortModel, turnsOf } from "./shared.jsx";
import "./neatlogs.css";

const CHECK_LIMIT = 25;
const IDLE = Object.freeze({ state: "idle" });
const STEP = 22;

function Icon({ name, size = 16 }) {
  const paths = {
    search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.1 3.1" /></>,
    trace: <><path d="M3 3.5h2.5V6H3zM10.5 10h2.5v2.5h-2.5zM5.5 4.75h2.2c2.1 0 3.8 1.7 3.8 3.8V10M3.5 10.5H6V13H3.5zM4.75 10.5V8.75" /></>,
    arrow: <path d="M4 8h8m-3.5-3.5L12 8l-3.5 3.5" />,
    back: <path d="M12 8H4m3.5-3.5L4 8l3.5 3.5" />,
    retry: <><path d="M12.5 6A5 5 0 1 0 13 9" /><path d="M9.5 3.5h3v3" /></>,
    chevron: <path d="m5 6.5 3 3 3-3" />,
    check: <path d="M4 8.5 6.8 11 12 5.5" />,
    close: <path d="m4.5 4.5 7 7m0-7-7 7" />,
    copy: <><rect x="5.5" y="5.5" width="7" height="7" rx="1.5" /><path d="M10.5 5.5V4a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h1.5" /></>,
    expand: <path d="M5.5 3 8 .9 10.5 3M5.5 13 8 15.1l2.5-2.1M8 1v4.5M8 10.5V15" />,
    workflow: <><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="6.5" r="1.6" /><path d="M4.5 5.1v5.8M4.5 9c0-1.6 1.2-2.5 3-2.5h2.4" /></>,
    tool: <path d="M9.8 3.2a3 3 0 0 0-3.6 3.9L2.8 10.5a1.2 1.2 0 0 0 1.7 1.7l3.4-3.4a3 3 0 0 0 3.9-3.6L10 7l-1.6-.4L8 5z" />,
    llm: <path d="M8 1.8v4.1M8 10.1v4.1M1.8 8h4.1M10.1 8h4.1M3.6 3.6l2.9 2.9M9.5 9.5l2.9 2.9M12.4 3.6 9.5 6.5M6.5 9.5l-2.9 2.9" />,
    span: <circle cx="8" cy="8" r="2.6" />,
  };
  return <svg className="nl-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">{paths[name]}</svg>;
}

const traceId = (trace) => trace.traceId || trace.trace_id || trace.id || "";
const spanKey = (span) => span.spanId || span.span_id || span.id || "";
const parentKey = (span) => span.parentSpanId ?? span.parent_span_id ?? null;
const spanName = (span) => span.spanName || span.span_name || span.name || "Unnamed span";
const spanType = (span) => String(span.spanType || span.span_type || "SPAN").toUpperCase();
const failedSpan = (span) => String(span.status || span.status_code || span.statusCode || "").toUpperCase() === "ERROR";
const time = (value) => (value ? Date.parse(value) : NaN);
const TYPE_ICON = { WORKFLOW: "workflow", AGENT: "workflow", TOOL: "tool", LLM: "llm" };

// Neatlogs prints sub-second spans in milliseconds and the rest to a tenth of a second.
function fmtSpan(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return fmtDuration(ms);
}
const fmtCost = (n) => (n ? `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}` : "$0");

// Flattens spans into tree rows in start order. `guides` marks the ancestor columns whose line continues past this row.
function spanTree(spans) {
  const ids = new Set(spans.map(spanKey));
  const children = new Map();
  for (const span of [...spans].sort((a, b) => time(a.startedAt) - time(b.startedAt))) {
    const parent = ids.has(parentKey(span)) ? parentKey(span) : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(span);
  }
  const rows = [];
  const walk = (parent, depth, guides, ancestors) => {
    const list = children.get(parent) || [];
    list.forEach((span, i) => {
      const row = { span, depth, guides, ancestors, last: i === list.length - 1, hasKids: children.has(spanKey(span)), key: spanKey(span) || `${depth}:${rows.length}` };
      rows.push(row);
      walk(spanKey(span), depth + 1, depth === 0 ? [] : [...guides, !row.last], [...ancestors, row.key]);
    });
  };
  walk(null, 0, [], []);
  return rows;
}

function SpanName({ name }) {
  const match = /^(mcp__.+?__)(.+)$/.exec(name);
  return match ? <><span className="nl-ns">{match[1]}</span>{match[2]}</> : name;
}

function SpanDetails({ span, origin }) {
  const type = spanType(span);
  const offset = time(span.startedAt) - origin;
  const facts = [
    ["Type", type],
    ["Status", span.status || "—"],
    ["Started", Number.isNaN(offset) ? "—" : `+${fmtSpan(Math.max(0, offset))}`],
    ["Duration", fmtSpan(span.durationMs) || "—"],
    ...(span.model ? [["Model", span.model]] : []),
    ...(span.provider ? [["Provider", span.provider]] : []),
    ...(type === "LLM" || span.totalTokens ? [["Tokens", `${(span.promptTokens || 0).toLocaleString()} in · ${(span.completionTokens || 0).toLocaleString()} out`], ["Cost", fmtCost(span.costUsd)]] : []),
    ["Span ID", spanKey(span) || "—"],
  ];
  return <dl className="nl-span-details">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === "Span ID" || label === "Model" ? "mono" : ""}>{value}</dd></div>)}</dl>;
}

function StepTree({ trace }) {
  const spans = trace.spans || [];
  const rows = React.useMemo(() => spanTree(spans), [spans]);
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const [open, setOpen] = React.useState(() => new Set());
  const [folded, setFolded] = React.useState(false);
  const starts = spans.map((s) => time(s.startedAt)).filter((n) => !Number.isNaN(n));
  const ends = spans.map((s) => time(s.endedAt) || time(s.startedAt) + (s.durationMs || 0)).filter((n) => !Number.isNaN(n));
  const origin = starts.length ? Math.min(...starts) : 0;
  const span = Math.max(1, (ends.length ? Math.max(...ends) : origin) - origin);
  const duration = trace.durationMs ?? (starts.length ? span : null);
  const count = (type) => spans.filter((s) => spanType(s) === type).length;
  const failures = spans.filter(failedSpan).length;
  const allOpen = rows.length > 0 && rows.every((row) => open.has(row.key));
  const flip = (set, key) => { const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key); return next; };
  const visible = rows.filter((row) => !row.ancestors.some((key) => collapsed.has(key)));

  if (!spans.length) return <div className="nl-steps empty">{trace.spansError ? <p className="nl-inline-error">Span details unavailable. {trace.spansError}</p> : <p>This trace has no span details yet.</p>}</div>;
  return (
    <div className="nl-steps">
      <div className="nl-steps-head">
        <button className="nl-steps-toggle" onClick={() => setFolded(!folded)} aria-expanded={!folded}><Icon name="chevron" size={13} />{spans.length} steps{duration != null && <> · {fmtSpan(duration)}</>}</button>
        <span className="nl-steps-counts"><b className="llm">{count("LLM")} LLM</b><b className="tool">{count("TOOL")} tool</b>{failures > 0 && <b className="failed">{failures} failed</b>}</span>
        <button className="nl-ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map((row) => row.key)))}><Icon name="expand" size={13} />{allOpen ? "Collapse all" : "Expand all"}</button>
      </div>
      {!folded && (
        <ol className="nl-tree">
          {visible.map((row) => {
            const type = spanType(row.span);
            const isOpen = open.has(row.key);
            const isCollapsed = collapsed.has(row.key);
            const start = time(row.span.startedAt) - origin;
            const left = Number.isNaN(start) ? 0 : (start / span) * 100;
            const width = Math.max(0.6, ((row.span.durationMs || 0) / span) * 100);
            const toggle = row.hasKids ? () => setCollapsed(flip(collapsed, row.key)) : () => setOpen(flip(open, row.key));
            return (
              <li className={`nl-span ${type.toLowerCase()}${failedSpan(row.span) ? " failed" : ""}${isOpen ? " open" : ""}`} key={row.key}>
                {row.guides.map((on, j) => on && <i className="nl-guide" style={{ left: j * STEP + STEP / 2 }} key={j} />)}
                {row.depth > 0 && <><i className="nl-elbow" style={{ left: (row.depth - 1) * STEP + STEP / 2 }} />{!row.last && <i className="nl-guide" style={{ left: (row.depth - 1) * STEP + STEP / 2 }} />}</>}
                {row.hasKids && !isCollapsed && <i className="nl-tail" style={{ left: row.depth * STEP + STEP / 2 }} />}
                <div className="nl-span-row" style={{ paddingLeft: row.depth * STEP }}>
                  <button className="nl-span-toggle" onClick={toggle} aria-expanded={row.hasKids ? !isCollapsed : isOpen} aria-label={row.hasKids ? (isCollapsed ? "Show child steps" : "Hide child steps") : isOpen ? "Hide details" : "Show details"}><span>{(row.hasKids ? !isCollapsed : isOpen) ? "−" : "+"}</span></button>
                  <button className="nl-span-main" onClick={() => setOpen(flip(open, row.key))} aria-expanded={isOpen}>
                    <span className="nl-span-icon"><Icon name={TYPE_ICON[type] || "span"} size={14} /></span>
                    <span className="nl-span-name"><SpanName name={spanName(row.span)} /></span>
                    <span className="nl-span-type">{type}</span>
                    {type === "LLM" && <span className="nl-span-usage">{(row.span.totalTokens || 0).toLocaleString()} tok · {fmtCost(row.span.costUsd)}</span>}
                  </button>
                  <span className="nl-span-bar" aria-hidden="true"><i style={{ left: `${Math.min(left, 99.4)}%`, width: `${Math.min(width, 100 - Math.min(left, 99.4))}%` }} /></span>
                  <time>{fmtSpan(row.span.durationMs)}</time>
                </div>
                {isOpen && <div className="nl-span-panel" style={{ marginLeft: row.depth * STEP + STEP + 6 }}><SpanDetails span={row.span} origin={origin} /></div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const attemptOf = (session) => (session.attemptN ? session.mod.attempts.find((a) => a.n === session.attemptN) : null);
const turnOf = (session) => turnsOf(session.mod)[session.turn ?? attemptOf(session)?.turn ?? 0];

// What the agent was handed, from Benana's own records. The public Neatlogs API has no span inputs.
function briefFor(session) {
  const { mod } = session;
  const attempt = attemptOf(session);
  const turn = turnOf(session);
  if (session.role === "spec") return { label: turn?.revision ? "Change request" : "Request", text: turn?.prompt || mod.prompt };
  if (session.role === "builder") return attempt?.revision && turn?.prompt ? { label: "Change request", text: turn.prompt } : mod.spec?.summary ? { label: "Spec", text: mod.spec.summary } : null;
  if (session.role === "fixer") {
    const from = attempt?.context?.from ?? (attempt ? attempt.n - 1 : null);
    const previous = mod.attempts.find((a) => a.n === from);
    const text = previous?.failure?.summary || previous?.verdict?.summary;
    return text ? { label: `Attempt ${from} failure`, text } : null;
  }
  if (session.role === "playtester") {
    const checks = turn?.checks || mod.testPlan?.checks || [];
    return checks.length ? { label: `Test plan · ${checks.length} check${checks.length === 1 ? "" : "s"}`, checks } : null;
  }
  return null;
}

function outputFor(session) {
  const attempt = attemptOf(session);
  if (session.role === "spec") { const text = turnOf(session)?.summary || session.mod.spec?.summary; return text ? { text } : null; }
  if (session.role === "playtester") return attempt?.verdict ? { verdict: attempt.verdict } : null;
  if (attempt?.summary) return { text: attempt.summary, lesson: session.role === "fixer" ? attempt.lesson : null };
  return null;
}

function Brief({ brief }) {
  const [more, setMore] = React.useState(false);
  const long = brief.checks ? brief.checks.length > 3 : (brief.text || "").length > 360;
  return (
    <div className="nl-brief-wrap">
      <div className={`nl-brief${long && !more ? " clamped" : ""}`}>
        <span className="nl-eyebrow">{brief.label}</span>
        {brief.checks ? <ol className="nl-brief-checks">{brief.checks.map((check) => <li key={check.id}><code>{check.id}</code><span>{check.title || check.expect}</span></li>)}</ol> : <Markdown text={brief.text} />}
        {long && <button className="nl-more" onClick={() => setMore(!more)}>{more ? "Show less" : "Show more"}</button>}
      </div>
    </div>
  );
}

function Output({ session, output }) {
  if (session.ok === false && session.error) return <section className="nl-output"><span className="nl-eyebrow out">Output</span><div className="nl-session-error">{session.error}</div></section>;
  if (!output) return null;
  return (
    <section className="nl-output">
      <span className="nl-eyebrow out">Output</span>
      {output.verdict ? <>
        <Markdown text={output.verdict.summary} />
        {output.verdict.checks?.length > 0 && <ul className="nl-verdict">{output.verdict.checks.map((check) => <li key={check.id}><CheckIcon status={check.status} /><div><code>{check.id}</code><p>{check.observed || check.expected}</p></div></li>)}</ul>}
      </> : <Markdown text={output.text} />}
      {output.lesson && <div className="nl-lesson"><span>Lesson</span><p>{output.lesson}</p></div>}
    </section>
  );
}

function TraceBody({ session, lookup, configured, onRetry }) {
  const [tab, setTab] = React.useState(0);
  const evidence = lookup.evidence || null;
  const traces = evidence?.traces || [];
  React.useEffect(() => setTab(0), [session.key]);
  if (!session.sessionId) return <div className="nl-lookup-message"><h4>Session ID missing</h4><p>Benana cannot request an exact Neatlogs trace for this session.</p></div>;
  if (!configured || lookup.state === "unconfigured") return <div className="nl-lookup-message"><h4>Neatlogs not configured</h4><p>{lookup.error || "Add NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to link sessions to traces."}</p></div>;
  if (lookup.state === "idle" || (lookup.state === "loading" && !evidence)) return <div className="nl-loading"><i /><span>Looking up the exact session in Neatlogs</span></div>;
  if (lookup.state === "error") return <div className="nl-lookup-message error"><h4>Trace lookup failed</h4><p>{lookup.error}</p><button onClick={onRetry}><Icon name="retry" size={14} /> Retry lookup</button></div>;
  if (!evidence?.matched) return <div className="nl-lookup-message"><h4>No trace matched</h4><p>{evidence?.matchReason || "Neatlogs has no exact trace for this session yet."}</p><button onClick={onRetry}><Icon name="retry" size={14} /> Check again</button></div>;
  const trace = traces[Math.min(tab, traces.length - 1)];
  return <>
    {traces.length > 1 && <div className="nl-trace-tabs" role="tablist">{traces.map((t, i) => <button role="tab" aria-selected={i === tab} className={i === tab ? "active" : ""} onClick={() => setTab(i)} key={traceId(t) || i}>Trace {i + 1}<small>{fmtSpan(t.durationMs)}</small></button>)}</div>}
    <StepTree trace={trace} key={traceId(trace)} />
  </>;
}

function TraceView({ session, lookup, configured, onRetry, onClose, onOpenMod }) {
  const [copied, setCopied] = React.useState(false);
  const trace = lookup.evidence?.traces?.[0];
  const summary = trace?.summary;
  const usage = session.usage || {};
  const brief = briefFor(session);
  const output = outputFor(session);
  const copy = () => navigator.clipboard?.writeText(session.sessionId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  const stats = [
    ["Duration", fmtDuration(sessionMs(session)) || (session.endedAt ? "—" : "Running"), shortModel(session.model) || "Model not reported"],
    ["Tokens", ((usage.inputTokens || 0) + (usage.outputTokens || 0)).toLocaleString(), `${(usage.inputTokens || 0).toLocaleString()} in · ${(usage.outputTokens || 0).toLocaleString()} out`],
    ["Cost", fmtMoney(usage.costUsd), "Reported by the agent"],
    ["Steps", summary ? summary.spans.toLocaleString() : "—", summary ? `${summary.llmCalls} LLM · ${summary.toolCalls} tool calls` : "From the Neatlogs trace"],
  ];
  return (
    <section className="nl-trace-view" aria-label="Session trace">
      <header className="nl-tv-head">
        <div className="nl-tv-title">
          <span className="nl-crumbs">{session.mod.name}<i>/</i>{session.attemptN ? `Attempt ${session.attemptN}` : "Spec"}</span>
          <h2>{ROLE[session.role] || session.role}<Outcome session={session} />{summary && !summary.finalized && <span className="nl-live">Finalizing</span>}</h2>
        </div>
        <div className="nl-tv-actions">
          {session.sessionId && configured && <button className="nl-icon-button" onClick={onRetry} disabled={lookup.state === "loading"} title="Refresh trace" aria-label="Refresh trace"><Icon name="retry" size={14} /></button>}
          <button className="nl-button" onClick={() => onOpenMod(session.mod.id)}>Open mod <Icon name="arrow" size={14} /></button>
          <button className="nl-icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close trace"><Icon name="close" size={14} /></button>
        </div>
      </header>
      <dl className="nl-tv-stats">
        {stats.map(([label, value, sub]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><small>{sub}</small></div>)}
        <div className="nl-tv-session"><dt>Session ID</dt><dd><code title={session.sessionId || "No session ID reported"}>{session.sessionId || "Not reported"}</code>{session.sessionId && <button className="nl-icon-button small" onClick={copy} aria-label="Copy session ID" title={copied ? "Copied" : "Copy"}><Icon name={copied ? "check" : "copy"} size={13} /></button>}</dd><small>{copied ? "Copied" : "Exact Neatlogs match key"}</small></div>
      </dl>
      <div className="nl-tv-body">
        {brief && <Brief brief={brief} key={session.key} />}
        <TraceBody session={session} lookup={lookup} configured={configured} onRetry={onRetry} />
        <Output session={session} output={output} />
      </div>
    </section>
  );
}

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
  const railRef = React.useRef(null);
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
    // A refresh keeps the current trace on screen until the new one arrives.
    updateLookup(session.key, { ...lookupSnapshot.current[session.key], state: "loading" });
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
  // The rail lists each mod once, with its sessions in run order beneath it.
  const railGroups = [...filtered.reduce((groups, session) => {
    if (!groups.has(session.mod.id)) groups.set(session.mod.id, { mod: session.mod, sessions: [] });
    groups.get(session.mod.id).sessions.unshift(session);
    return groups;
  }, new Map()).values()];
  const railOrder = railGroups.flatMap((group) => group.sessions);

  // Esc closes the trace; arrow keys (or j/k) step through the session rail.
  React.useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented || event.target.closest?.("input, select, textarea, [contenteditable]")) return;
      if (event.key === "Escape") { setSelectedKey(null); return; }
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
      if (!step) return;
      const next = railOrder[railOrder.findIndex((session) => session.key === selected.key) + step];
      if (next) { event.preventDefault(); setSelectedKey(next.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, railOrder]);

  React.useEffect(() => {
    railRef.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

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
  const configured = connectionValue?.configured !== false;
  const rejected = /\b40[13]\b/.test(connectionValue?.error || "");
  const connectionKind = connection.state === "loading" ? "loading" : connection.state === "error" || connectionValue?.ok === false ? "unreachable" : connectionValue?.configured === false ? "unconfigured" : "connected";
  const connectionLabel = { loading: "Checking connection", unreachable: rejected ? "Neatlogs rejected the API key" : "Neatlogs unreachable", unconfigured: "Neatlogs not configured", connected: "Connected to Neatlogs" }[connectionKind];
  const connectionDetail = connection.state === "error" ? connection.error : connectionValue?.error || (connectionValue?.configured === false ? "Add NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to link sessions." : null);
  const sessionLabel = (session) => `${ROLE[session.role] || session.role} · ${session.attemptN ? `Attempt ${session.attemptN}` : "Spec"}`;
  const search = <label className="nl-search"><Icon name="search" size={15} /><span className="sr-only">Search sessions</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" /></label>;

  return (
    <div className={`view neatlogs-page${selected ? " inspecting" : ""}`}>
      <header className="nl-header">
        <div className="nl-heading"><span className="nl-mark" aria-hidden="true">N</span><div><h1>Neatlogs</h1><p>Trace every agent session from build to fix.</p></div></div>
        <div className={`nl-connection ${connectionKind}`} title={connectionDetail || "Neatlogs is available"}><i /><span>{connectionLabel}</span></div>
      </header>
      {connectionDetail && <div className={`nl-connection-detail ${connectionKind}`}>{connectionDetail}</div>}

      {selected ? (
        <div className="nl-focus">
          <aside className="nl-rail" aria-label="Agent sessions">
            <button className="nl-back" onClick={() => setSelectedKey(null)}><Icon name="back" size={14} />Sessions</button>
            <div className="nl-rail-search">{search}</div>
            <div className="nl-rail-list" ref={railRef}>
              {railGroups.map(({ mod, sessions: modSessions }) => (
                <section key={mod.id}>
                  <h3>{mod.name}</h3>
                  <ol>{modSessions.map((session) => (
                    <li key={session.key}><button className={`${session.key === selected.key ? "active" : ""}${session.ok === false ? " failed" : ""}`} aria-current={session.key === selected.key} onClick={() => setSelectedKey(session.key)} title={session.ok === false ? "Session failed" : undefined}>
                      <span>{ROLE[session.role] || session.role}{session.attemptN && <small>{session.attemptN}</small>}</span>
                      <time>{fmtDuration(sessionMs(session)) || (session.endedAt ? "" : "Running")}</time>
                    </button></li>
                  ))}</ol>
                </section>
              ))}
              {!filtered.length && <p className="nl-rail-empty">No sessions match. <button onClick={clearFilters}>Clear filters</button></p>}
            </div>
          </aside>
          <TraceView session={selected} lookup={lookups[selected.key] || IDLE} configured={configured} onRetry={() => check(selected)} onClose={() => setSelectedKey(null)} onOpenMod={onOpenMod} />
        </div>
      ) : <>
        <section className="nl-kpis" aria-label="Session summary">
          <article><span>Agent sessions</span><strong>{sessions.length.toLocaleString()}</strong><small>Across {mods.length} mod{mods.length === 1 ? "" : "s"}</small></article>
          <article><span>Trace matches</span><strong>{successful.length ? matched.toLocaleString() : "—"}</strong><small>{successful.length ? `${matched} of ${successful.length} successful checks` : "No successful checks"}</small></article>
          <article><span>Total tokens</span><strong>{totalTokens.toLocaleString()}</strong><small>{linked.length} linked session{linked.length === 1 ? "" : "s"}</small></article>
          <article><span>Session spend</span><strong>{fmtMoney(totalSpend)}</strong><small>Reported by agent sessions</small></article>
        </section>

        <section className="nl-browser" aria-label="Agent sessions">
          <div className="nl-browser-head"><div><h2>Sessions</h2><span>{filtered.length} of {sessions.length}</span></div><button className="nl-check-button" onClick={checkAll} disabled={bulkChecking || connection.state === "loading" || !configured || pending.length === 0}><Icon name={bulkChecking ? "retry" : "trace"} size={15} />{!configured ? "Neatlogs not configured" : bulkChecking ? "Checking traces" : pending.length ? `Check ${Math.min(pending.length, CHECK_LIMIT)} traces` : linked.length ? "All linked checked" : "No linked sessions"}</button></div>
          <div className="nl-toolbar">
            {search}
            <label className="nl-select"><span className="sr-only">Filter by role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option>{roles.map((value) => <option value={value} key={value}>{ROLE[value] || value}</option>)}</select><Icon name="chevron" size={13} /></label>
            <div className="nl-segments" aria-label="Filter by trace status">{[["all", "All"], ["matched", "Matched"], ["none", "No trace"], ["unchecked", "Unchecked"], ["error", "Errors"]].map(([value, label]) => <button className={traceFilter === value ? "active" : ""} aria-pressed={traceFilter === value} onClick={() => setTraceFilter(value)} key={value}>{label}</button>)}</div>
          </div>
          <div className="nl-table-scroll">
            {sessions.length ? filtered.length ? (
              <table className="nl-table"><thead><tr><th>Session</th><th>Model</th><th className="num">Duration</th><th className="num">Cost</th><th>Trace</th><th aria-label="Open" /></tr></thead><tbody>{filtered.map((session) => {
                const status = statusFor(session, lookups[session.key] || IDLE);
                return <tr key={session.key} onClick={() => setSelectedKey(session.key)}>
                  <td><button className="nl-session-button" onClick={() => setSelectedKey(session.key)}><span className="nl-session-name">{session.mod.name}</span><span>{sessionLabel(session)}</span></button></td>
                  <td className="nl-model">{shortModel(session.model) || "—"}</td><td className="num">{fmtDuration(sessionMs(session)) || (session.endedAt ? "—" : "Running")}</td><td className="num">{fmtMoney(session.usage?.costUsd)}</td><td><span className={`nl-trace-status ${status.key}`}><i />{status.label}</span></td>
                  <td className="nl-open"><Icon name="arrow" size={14} /></td>
                </tr>;
              })}</tbody></table>
            ) : <div className="nl-empty nl-filter-empty"><Icon name="search" size={22} /><h3>No sessions match</h3><p>Clear the filters to see all agent sessions.</p><button onClick={clearFilters}>Clear filters</button></div>
              : <div className="nl-empty nl-filter-empty"><Icon name="trace" size={24} /><h3>No sessions yet</h3><p>Agent sessions appear here after a mod starts building.</p></div>}
          </div>
        </section>
      </>}
    </div>
  );
}

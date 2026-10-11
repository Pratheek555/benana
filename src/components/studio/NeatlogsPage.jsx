import React from "react";
import { call } from "../../api.js";
import { Empty, PageHead, ROLE, SectionHead, allSessions, fmtDuration, fmtMoney, sessionMs, shortModel } from "./shared.jsx";

const CHECK_LIMIT = 25;

export default function NeatlogsPage({ mods, onOpenMod }) {
  const [status, setStatus] = React.useState(null);
  const [evidence, setEvidence] = React.useState({});
  const [selectedKey, setSelectedKey] = React.useState(null);
  const [checking, setChecking] = React.useState(false);
  const sessions = React.useMemo(() => allSessions(mods), [mods]);
  const linked = sessions.filter((s) => s.sessionId);
  const selected = sessions.find((s) => s.key === selectedKey) || null;
  const checked = Object.keys(evidence).length;
  const matched = Object.values(evidence).filter((e) => e?.matched).length;

  React.useEffect(() => {
    call("studio:partners")
      .then((p) => setStatus(p.neatlogs))
      .catch((e) => setStatus({ configured: true, ok: false, error: e.message }));
  }, []);

  const check = React.useCallback(async (session) => {
    if (!session?.sessionId) return;
    try {
      const result = await call("studio:evidence", { sessionId: session.sessionId });
      setEvidence((prev) => ({ ...prev, [session.key]: result }));
    } catch (e) {
      setEvidence((prev) => ({ ...prev, [session.key]: { configured: true, matched: false, traces: [], error: e.message } }));
    }
  }, []);

  React.useEffect(() => {
    if (selected && !evidence[selected.key]) check(selected);
  }, [selected?.key]);

  const checkAll = async () => {
    setChecking(true);
    for (const s of linked.filter((x) => !evidence[x.key]).slice(0, CHECK_LIMIT)) await check(s);
    setChecking(false);
  };

  const ev = selected ? evidence[selected.key] : null;
  const state = !status ? "idle" : status.configured === false ? "idle" : status.ok ? "passed" : "failed";

  return (
    <div className="view">
      <PageHead title="Neatlogs" sub="Every builder, playtester, and fixer session, linked to its trace.">
        <button className="btn" onClick={checkAll} disabled={checking || !linked.length || checked >= linked.length}>
          {checking ? "Checking traces…" : checked >= linked.length && linked.length ? "All traces checked" : `Check ${Math.min(linked.length - checked, CHECK_LIMIT)} traces`}
        </button>
      </PageHead>

      <div className="connection">
        <span className={`dot ${state}`} />
        <strong>
          {!status
            ? "Checking Neatlogs…"
            : status.configured === false
              ? "Neatlogs is not configured"
              : status.ok
                ? "Connected"
                : "Unreachable"}
        </strong>
        <span className="meta">
          {status?.configured === false
            ? "Add NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to .env to link sessions to traces."
            : status?.error || "Neatlogs hooks in each mod repository trace every agent session."}
        </span>
      </div>

      <section className="kpis three">
        <div className="kpi">
          <span>Agent sessions</span>
          <strong>{sessions.length}</strong>
          <small>across {mods.length} mods</small>
        </div>
        <div className="kpi">
          <span>With a session ID</span>
          <strong>{linked.length}</strong>
          <small>Neatlogs can attribute these</small>
        </div>
        <div className="kpi">
          <span>Traces matched</span>
          <strong>{checked ? matched : "—"}</strong>
          <small>{checked ? `of ${checked} checked` : "Not checked yet"}</small>
        </div>
      </section>

      <div className="split">
        <section className="panel">
          {sessions.length ? (
            <table className="table selectable">
              <thead>
                <tr>
                  <th>Mod</th>
                  <th>Step</th>
                  <th>Role</th>
                  <th>Model</th>
                  <th className="num">Time</th>
                  <th className="num">Cost</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const e = evidence[s.key];
                  return (
                    <tr key={s.key} className={s.key === selectedKey ? "selected" : ""} onClick={() => setSelectedKey(s.key)}>
                      <td className="strong">{s.mod.name}</td>
                      <td>{s.attemptN ? `Attempt ${s.attemptN}` : "Spec"}</td>
                      <td>{ROLE[s.role] || s.role}</td>
                      <td className="mono muted">{shortModel(s.model)}</td>
                      <td className="num">{fmtDuration(sessionMs(s)) || "—"}</td>
                      <td className="num">{fmtMoney(s.usage?.costUsd)}</td>
                      <td>
                        {!s.sessionId ? (
                          <span className="muted">No session ID</span>
                        ) : e ? (
                          <span className={`partner-link static neatlogs ${e.matched ? "" : "off"}`}>
                            <i />
                            {e.matched ? `${e.traces.length} trace${e.traces.length === 1 ? "" : "s"}` : "No trace"}
                          </span>
                        ) : (
                          <span className="muted">Not checked</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty>Agent sessions appear here after a mod starts building.</Empty>
          )}
        </section>

        <aside className="panel pad detail-card">
          {!selected && <Empty>Select a session to see its trace.</Empty>}
          {selected && (
            <>
              <SectionHead title={ROLE[selected.role] || selected.role}>
                <button className="link" onClick={() => onOpenMod(selected.mod.id)}>
                  Open mod
                </button>
              </SectionHead>
              <p className="meta">
                {selected.mod.name} · {selected.attemptN ? `attempt ${selected.attemptN}` : "spec"} · {shortModel(selected.model)}
              </p>
              <dl className="facts stacked">
                <div>
                  <dt>Session ID</dt>
                  <dd className="mono">{selected.sessionId || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Outcome</dt>
                  <dd>{selected.ok === false ? selected.error || "Failed" : selected.endedAt ? "Completed" : "Running"}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>
                    {(selected.usage?.inputTokens || 0).toLocaleString()} in · {(selected.usage?.outputTokens || 0).toLocaleString()} out
                  </dd>
                </div>
              </dl>
              {!ev && <Empty>Looking up the trace…</Empty>}
              {ev?.error && <div className="alert">{ev.error}</div>}
              {ev && !ev.error && <p className="meta">{ev.matchReason || (ev.matched ? "Trace matched." : "No trace yet.")}</p>}
              {ev?.traces?.map((t, i) => (
                <div className="trace" key={t.traceId || t.trace_id || i}>
                  <div className="trace-head">
                    <strong>{t.traceName || t.name || "trace"}</strong>
                    {t.durationMs != null && <span className="meta">{fmtDuration(t.durationMs)}</span>}
                  </div>
                  <small className="mono muted">{t.traceId || t.trace_id || t.id}</small>
                  <ol className="spans">
                    {(t.spans || []).slice(0, 25).map((sp, j) => {
                      const failed = sp.status === "error" || sp.status_code === "ERROR";
                      return (
                        <li key={j} className={failed ? "failed" : ""}>
                          <span>{sp.spanName || sp.name || sp.span_name || "span"}</span>
                          {sp.failure && <small>{sp.failure}</small>}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

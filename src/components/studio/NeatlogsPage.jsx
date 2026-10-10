import React from "react";
import { call } from "../../api.js";
import { Empty, ROLE, allSessions, fmtDuration, fmtMoney, sessionMs } from "./shared.jsx";

const CHECK_LIMIT = 25;

export default function NeatlogsPage({ mods, onOpenMod }) {
  const [status, setStatus] = React.useState(null);
  const [evidence, setEvidence] = React.useState({});
  const [selectedKey, setSelectedKey] = React.useState(null);
  const [checking, setChecking] = React.useState(false);
  const sessions = React.useMemo(() => allSessions(mods), [mods]);
  const linked = sessions.filter((s) => s.sessionId);
  const selected = sessions.find((s) => s.key === selectedKey) || null;
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

  return (
    <div className="neatlogs">
      <section className="card connect">
        <div>
          <span className={`status-dot ${status?.ok ? "running" : status?.configured === false ? "off" : status ? "failed" : "offline"}`} />
          <strong>
            {!status
              ? "Checking Neatlogs…"
              : status.configured === false
                ? "Neatlogs is not configured"
                : status.ok
                  ? "Connected to Neatlogs"
                  : "Neatlogs is unreachable"}
          </strong>
        </div>
        <p className="muted-line">
          {status?.configured === false
            ? "Add NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to .env. Benana then links each session to its trace here."
            : status?.error || "Every builder, playtester, and fixer session is traced by the Neatlogs hooks in its mod repository."}
        </p>
        <button className="btn-ghost" onClick={checkAll} disabled={checking || !linked.length}>
          {checking ? "Checking traces…" : `Check ${Math.min(linked.length, CHECK_LIMIT)} traces`}
        </button>
      </section>

      <section className="stats compact">
        <div className="stat">
          <span>Agent sessions</span>
          <strong>{sessions.length}</strong>
        </div>
        <div className="stat">
          <span>With a session ID</span>
          <strong>{linked.length}</strong>
          <small>Neatlogs can attribute these</small>
        </div>
        <div className="stat pass">
          <span>Trace matched</span>
          <strong>{matched}</strong>
          <small>of {Object.keys(evidence).length} checked</small>
        </div>
      </section>

      <div className="split">
        <section className="card table-card">
          {sessions.length ? (
            <table className="plain-table sessions">
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
                      <td>{s.mod.name}</td>
                      <td>{s.attemptN ? `Attempt ${s.attemptN}` : "Spec"}</td>
                      <td>{ROLE[s.role] || s.role}</td>
                      <td className="mono">{s.model}</td>
                      <td className="num">{fmtDuration(sessionMs(s)) || "—"}</td>
                      <td className="num">{fmtMoney(s.usage?.costUsd)}</td>
                      <td>
                        {!s.sessionId ? (
                          <span className="tag off">No session ID</span>
                        ) : e ? (
                          <span className={`tag ${e.matched ? "neatlogs" : "off"}`}>
                            {e.matched ? `${e.traces.length} trace${e.traces.length === 1 ? "" : "s"}` : "No trace"}
                          </span>
                        ) : (
                          <span className="muted-line">Not checked</span>
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

        <aside className="card detail-card">
          {!selected && <Empty>Select a session to see its trace.</Empty>}
          {selected && (
            <>
              <div className="section-head">
                <div>
                  <h4>{ROLE[selected.role] || selected.role}</h4>
                  <p className="muted-line">
                    {selected.mod.name} · {selected.attemptN ? `attempt ${selected.attemptN}` : "spec"} · {selected.model}
                  </p>
                </div>
                <button className="link" onClick={() => onOpenMod(selected.mod.id)}>
                  Open mod
                </button>
              </div>
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
              {ev?.error && <div className="studio-error">{ev.error}</div>}
              {ev && !ev.error && <p className="muted-line">{ev.matchReason || (ev.matched ? "Trace matched." : "No trace yet.")}</p>}
              {ev?.traces?.map((t, i) => (
                <div className="trace" key={t.traceId || t.trace_id || i}>
                  <div className="trace-head">
                    <strong>{t.traceName || t.name || "trace"}</strong>
                    {t.durationMs != null && <small>{fmtDuration(t.durationMs)}</small>}
                  </div>
                  <small className="mono">{t.traceId || t.trace_id || t.id}</small>
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

import React from "react";
import { call } from "../../api.js";

export const PHASES = [
  ["spec", "Spec"],
  ["repo", "Repo"],
  ["build", "Build"],
  ["compile", "Compile"],
  ["deploy", "Deploy"],
  ["playtest", "Playtest"],
  ["fix", "Fix"],
  ["done", "Done"],
];

export const ROLE = {
  spec: "Spec agent",
  builder: "Builder",
  fixer: "Fixer",
  playtester: "Playtester",
  benana: "Benana",
  seeded: "Seeded fixture",
};

const STATUS = {
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  stopped: "Stopped",
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  pending: "Not run",
};

export function phaseIndex(mod) {
  if (!mod) return -1;
  if (mod.phase === "fix") return 6;
  return PHASES.findIndex(([key]) => key === mod.phase);
}

export function latestVerdict(mod) {
  return [...(mod?.attempts || [])].reverse().find((a) => a.verdict)?.verdict || null;
}

export function allSessions(mods) {
  return mods
    .flatMap((mod) => [
      ...mod.sessions.map((s, i) => ({ ...s, mod, attemptN: null, key: `${mod.id}:spec:${i}` })),
      ...mod.attempts.flatMap((a) =>
        a.sessions.map((s, i) => ({ ...s, mod, attemptN: a.n, key: `${mod.id}:${a.n}:${i}` })),
      ),
    ])
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export const sessionMs = (s) => (s.endedAt && s.startedAt ? s.endedAt - s.startedAt : null);

export const modSpend = (mod) => allSessions([mod]).reduce((n, s) => n + (s.usage?.costUsd || 0), 0);

export function fmtDuration(ms) {
  if (ms == null || ms < 0) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const fmtMoney = (n) => `$${(n || 0).toFixed(2)}`;

export const shortSha = (sha) => (sha ? sha.slice(0, 7) : "");

export const shortModel = (m) => (m || "").replace(/^claude-/, "");

export function Status({ status, children }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {children || STATUS[status] || status}
    </span>
  );
}

export function Icon({ name, size = 16 }) {
  const paths = {
    check: <path d="M4 8.5 6.8 11 12 5.5" />,
    x: <path d="M5 5l6 6M11 5l-6 6" />,
    alert: <path d="M8 4.5v4M8 11h.01" />,
    plus: <path d="M8 3.5v9M3.5 8h9" />,
    stop: <rect x="5" y="5" width="6" height="6" rx="1" />,
    folder: <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" />,
    code: <path d="M6 5 3 8l3 3M10 5l3 3-3 3" />,
    arrow: <path d="M4 8h8M8.5 4.5 12 8l-3.5 3.5" />,
  };
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function CheckIcon({ status }) {
  const s = status || "pending";
  const name = { pass: "check", fail: "x", blocked: "alert" }[s];
  return <span className={`check-icon ${s}`}>{name && <Icon name={name} size={12} />}</span>;
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

export function PageHead({ title, sub, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function SectionHead({ title, count, children }) {
  return (
    <div className="section-head">
      <h3>
        {title}
        {count != null && <span className="count">{count}</span>}
      </h3>
      {children}
    </div>
  );
}

export function PlanChecks({ mod }) {
  const verdict = latestVerdict(mod);
  const byId = new Map((verdict?.checks || []).map((c) => [c.id, c]));
  const live = verdict?.live && mod.running;
  const checks = mod.testPlan?.checks || [];
  const passed = checks.filter((c) => byId.get(c.id)?.status === "pass").length;
  return (
    <section className="block">
      <SectionHead title="Test plan">
        {live ? <Status status="running">Live</Status> : checks.length > 0 && <span className="meta">{passed}/{checks.length} passing</span>}
      </SectionHead>
      {!mod.testPlan && <Empty>The spec agent is writing the test plan.</Empty>}
      <ul className="check-list">
        {checks.map((c) => {
          const r = byId.get(c.id);
          return (
            <li key={c.id} className={r?.status || "pending"}>
              <CheckIcon status={r?.status} />
              <div>
                <strong>{c.title}</strong>
                <p>{r?.observed || c.expect}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {verdict?.serverErrors?.length > 0 && (
        <div className="alert">
          {verdict.serverErrors.length} server error{verdict.serverErrors.length === 1 ? "" : "s"}:{" "}
          {verdict.serverErrors[0].message.slice(0, 160)}
        </div>
      )}
    </section>
  );
}

export function TraceButton({ sessionId }) {
  const [trace, setTrace] = React.useState(null);
  if (!sessionId) return null;
  const label = trace
    ? trace.matched
      ? `${trace.traces.length} trace${trace.traces.length === 1 ? "" : "s"}`
      : trace.configured === false
        ? "Not configured"
        : "No trace yet"
    : "Trace";
  return (
    <button
      className="partner-link neatlogs"
      title="Look up this session in Neatlogs"
      onClick={() =>
        call("studio:evidence", { sessionId })
          .then(setTrace)
          .catch((e) => setTrace({ error: e.message, traces: [] }))
      }
    >
      <i />
      {label}
    </button>
  );
}

export function AttemptTimeline({ mod, onSelect }) {
  if (!mod.attempts.length) return <Empty>No attempts yet.</Empty>;
  return (
    <ol className="attempts">
      {mod.attempts.map((a) => (
        <li key={a.n} className={`attempt ${a.status}`}>
          <div className="attempt-head">
            <CheckIcon status={{ passed: "pass", failed: "fail", running: "running" }[a.status] || "pending"} />
            <strong>Attempt {a.n}</strong>
            <span className="meta">{a.role === "seeded" ? "Seeded fixture" : ROLE[a.role]}</span>
            <Status status={a.status} />
          </div>
          <div className="attempt-body">
            {a.failure && <p className="attempt-text">{a.failure.summary}</p>}
            {a.lesson && (
              <div className="lesson">
                <span>Lesson</span>
                <p>{a.lesson}</p>
              </div>
            )}
            {a.context && (
              <p className="meta">
                Read {a.context.entireCheckpoints} Entire checkpoint{a.context.entireCheckpoints === 1 ? "" : "s"}
                {a.context.neatlogsTrace ? " and a Neatlogs trace" : ""} before fixing
              </p>
            )}
            {(a.commit?.sha || a.commit?.checkpoint) && (
              <div className="attempt-refs">
                {a.commit?.sha && (
                  <button className="sha" onClick={() => onSelect?.(a)} disabled={!onSelect} title="View this commit">
                    {shortSha(a.commit.sha)}
                  </button>
                )}
                {a.commit?.checkpoint && (
                  <span className="partner-link entire static">
                    <i />
                    Checkpoint {a.commit.checkpoint.slice(0, 8)}
                  </span>
                )}
              </div>
            )}
            {a.sessions.length > 0 && (
              <ul className="sessions">
                {a.sessions.map((s, i) => (
                  <li key={i}>
                    <span className="session-role">{ROLE[s.role] || s.role}</span>
                    <span className="meta">
                      {[shortModel(s.model), fmtDuration(sessionMs(s)), s.usage?.costUsd ? fmtMoney(s.usage.costUsd) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <TraceButton sessionId={s.sessionId} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PartnerStatus({ mod }) {
  const [cps, setCps] = React.useState(null);
  const p = mod.partners;
  React.useEffect(() => {
    if (!mod.repoDir) return;
    call("studio:checkpoints", { id: mod.id }).then(setCps).catch(() => {});
  }, [mod.id, mod.repoDir, mod.attempts.length, mod.status]);
  return (
    <ul className="partners">
      <li>
        <span className={`partner-dot entire ${p?.entire?.enabled ? "" : "off"}`} />
        <strong>Entire</strong>
        <span className="meta">
          {p?.entire?.enabled
            ? `${cps?.items?.length ?? "…"} checkpoints`
            : p?.entire?.error || "Not set up"}
        </span>
      </li>
      <li>
        <span className={`partner-dot neatlogs ${p?.neatlogs?.enabled ? "" : "off"}`} />
        <strong>Neatlogs</strong>
        <span className="meta">{p?.neatlogs?.enabled ? "Sessions traced" : p?.neatlogs?.error || "Not set up"}</span>
      </li>
    </ul>
  );
}

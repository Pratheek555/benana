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
  seeded: "Seeded",
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

export function Pill({ status, children }) {
  return <span className={`pill ${status}`}>{children || STATUS[status] || status}</span>;
}

export function CheckIcon({ status }) {
  const glyph = { pass: "✓", fail: "✕", blocked: "!", pending: "·" }[status] || "·";
  return <span className={`check-icon ${status || "pending"}`}>{glyph}</span>;
}

export function Empty({ children }) {
  return <p className="muted-block">{children}</p>;
}

export function PlanChecks({ mod }) {
  const verdict = latestVerdict(mod);
  const byId = new Map((verdict?.checks || []).map((c) => [c.id, c]));
  const live = verdict?.live && mod.running;
  return (
    <div className="checks">
      <div className="section-head">
        <h4>Test plan</h4>
        {live && <span className="live">Live</span>}
      </div>
      {!mod.testPlan && <Empty>The spec agent is writing the test plan.</Empty>}
      <ul className="check-list">
        {(mod.testPlan?.checks || []).map((c) => {
          const r = byId.get(c.id);
          return (
            <li key={c.id} className={r?.status || "pending"}>
              <CheckIcon status={r?.status} />
              <div>
                <strong>{c.title}</strong>
                <small>{r?.observed || c.expect}</small>
              </div>
              <span className={`verdict-word ${r?.status || "pending"}`}>{STATUS[r?.status] || "Not run"}</span>
            </li>
          );
        })}
      </ul>
      {verdict?.serverErrors?.length > 0 && (
        <div className="studio-error">
          {verdict.serverErrors.length} server error(s): {verdict.serverErrors[0].message.slice(0, 160)}
        </div>
      )}
    </div>
  );
}

export function TraceChip({ sessionId }) {
  const [trace, setTrace] = React.useState(null);
  if (!sessionId) return null;
  const label = trace
    ? trace.matched
      ? `${trace.traces.length} trace${trace.traces.length === 1 ? "" : "s"}`
      : trace.configured === false
        ? "Not configured"
        : "No trace yet"
    : "Check trace";
  return (
    <button
      className="tag neatlogs"
      onClick={() =>
        call("studio:evidence", { sessionId })
          .then(setTrace)
          .catch((e) => setTrace({ error: e.message, traces: [] }))
      }
    >
      Neatlogs · {label}
    </button>
  );
}

export function AttemptTimeline({ mod, onSelect }) {
  return (
    <ol className="timeline">
      {mod.attempts.map((a) => (
        <li key={a.n} className={`timeline-item ${a.status}`}>
          <span className="node" />
          <div className="timeline-card">
            <div className="attempt-head">
              <strong>
                Attempt {a.n} · {a.role === "seeded" ? "Seeded (labeled)" : ROLE[a.role]}
              </strong>
              <Pill status={a.status} />
            </div>
            {a.failure && <p className="attempt-fail">{a.failure.summary}</p>}
            {a.lesson && <p className="attempt-lesson">Lesson: {a.lesson}</p>}
            {a.context && (
              <p className="attempt-meta">
                Fixer read {a.context.entireCheckpoints} Entire checkpoints
                {a.context.neatlogsTrace ? " and a Neatlogs trace" : ""}
              </p>
            )}
            <div className="chip-row">
              {a.commit?.sha && (
                <button className="chip mono" onClick={() => onSelect?.(a)} title="Open this commit's changes">
                  {shortSha(a.commit.sha)}
                </button>
              )}
              {a.commit?.checkpoint && <span className="tag entire">Entire {a.commit.checkpoint.slice(0, 10)}</span>}
              {a.playtestCommit?.checkpoint && (
                <span className="tag entire">Playtest {a.playtestCommit.checkpoint.slice(0, 10)}</span>
              )}
            </div>
            <div className="session-list">
              {a.sessions.map((s, i) => (
                <div className="session" key={i}>
                  <span>
                    {ROLE[s.role] || s.role} · {s.model}
                    {sessionMs(s) != null ? ` · ${fmtDuration(sessionMs(s))}` : ""}
                    {s.usage?.costUsd ? ` · ${fmtMoney(s.usage.costUsd)}` : ""}
                  </span>
                  <TraceChip sessionId={s.sessionId} />
                </div>
              ))}
            </div>
          </div>
        </li>
      ))}
      {!mod.attempts.length && <Empty>No attempts yet.</Empty>}
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
    <div className="partners">
      <div className="partner">
        <span className={`tag ${p?.entire?.enabled ? "entire" : "off"}`}>Entire</span>
        <span>
          {p?.entire?.enabled
            ? `${cps?.items?.length ?? "…"} checkpoints in the mod repository`
            : p?.entire?.error || "Not set up yet"}
        </span>
      </div>
      <div className="partner">
        <span className={`tag ${p?.neatlogs?.enabled ? "neatlogs" : "off"}`}>Neatlogs</span>
        <span>{p?.neatlogs?.enabled ? "Agent sessions traced" : p?.neatlogs?.error || "Not set up yet"}</span>
      </div>
    </div>
  );
}

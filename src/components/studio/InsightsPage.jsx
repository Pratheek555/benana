import React from "react";
import { fmtTokens } from "../../api.js";
import { Empty, ROLE, allSessions, fmtDuration, fmtMoney, sessionMs } from "./shared.jsx";

const FAILURE = {
  build: "Did not compile",
  load: "Did not load on the server",
  playtest: "Failed in-game checks",
};

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function summarize(mods) {
  const sessions = allSessions(mods);
  const finished = mods.filter((m) => ["passed", "failed"].includes(m.status));
  const passed = mods.filter((m) => m.status === "passed");
  const tokens = sessions.reduce(
    (t, s) => ({
      in: t.in + (s.usage?.inputTokens || 0),
      out: t.out + (s.usage?.outputTokens || 0),
      cacheRead: t.cacheRead + (s.usage?.cacheReadInputTokens || 0),
    }),
    { in: 0, out: 0, cacheRead: 0 },
  );
  const attempts = mods.flatMap((m) => m.attempts);
  const checkpointCommits = attempts.reduce(
    (n, a) => n + (a.commit?.checkpoint ? 1 : 0) + (a.playtestCommit?.checkpoint ? 1 : 0),
    0,
  );
  const failureKinds = {};
  for (const a of attempts) if (a.failure) failureKinds[a.failure.kind] = (failureKinds[a.failure.kind] || 0) + 1;
  const attemptsToPass = {};
  for (const m of passed) attemptsToPass[m.attempts.length] = (attemptsToPass[m.attempts.length] || 0) + 1;

  const byRole = {};
  const byModel = {};
  for (const s of sessions) {
    const r = (byRole[s.role] ||= { sessions: 0, cost: 0, tokens: 0 });
    r.sessions += 1;
    r.cost += s.usage?.costUsd || 0;
    r.tokens += (s.usage?.inputTokens || 0) + (s.usage?.outputTokens || 0);
    const m = (byModel[s.model || "unknown"] ||= { sessions: 0, cost: 0, ms: 0, timed: 0 });
    m.sessions += 1;
    m.cost += s.usage?.costUsd || 0;
    if (sessionMs(s) != null) {
      m.ms += sessionMs(s);
      m.timed += 1;
    }
  }

  const days = [];
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    days.push({ key: dayKey(now - i * 86400000), passed: 0, failed: 0, running: 0 });
  }
  const index = new Map(days.map((d, i) => [d.key, i]));
  for (const m of mods) {
    const i = index.get(dayKey(m.createdAt));
    if (i == null) continue;
    if (m.running) days[i].running += 1;
    else if (m.status === "passed") days[i].passed += 1;
    else if (m.status === "failed") days[i].failed += 1;
  }

  return {
    sessions,
    mods: mods.length,
    passed: passed.length,
    finished: finished.length,
    passRate: finished.length ? passed.length / finished.length : null,
    firstTry: passed.filter((m) => m.attempts.length === 1).length,
    avgAttempts: finished.length ? finished.reduce((n, m) => n + m.attempts.length, 0) / finished.length : null,
    spend: sessions.reduce((n, s) => n + (s.usage?.costUsd || 0), 0),
    tokens,
    checkpointCommits,
    linkedSessions: sessions.filter((s) => s.sessionId).length,
    entireMods: mods.filter((m) => m.partners?.entire?.enabled).length,
    neatlogsMods: mods.filter((m) => m.partners?.neatlogs?.enabled).length,
    failureKinds,
    attemptsToPass,
    byRole,
    byModel,
    days,
  };
}

export default function InsightsPage({ mods, lessons }) {
  const s = React.useMemo(() => summarize(mods), [mods]);
  const totalRoleCost = Object.values(s.byRole).reduce((n, r) => n + r.cost, 0) || 1;

  return (
    <div className="insights">
      <section className="stats">
        <Stat label="Mods built" value={s.mods} sub={`${s.passed} passed`} />
        <Stat
          label="Pass rate"
          value={s.passRate == null ? "—" : `${Math.round(s.passRate * 100)}%`}
          sub={`${s.finished} finished`}
          tone="pass"
        />
        <Stat
          label="First-try passes"
          value={s.firstTry}
          sub={s.passed ? `${Math.round((s.firstTry / s.passed) * 100)}% of passes` : "No passes yet"}
        />
        <Stat label="Avg attempts" value={s.avgAttempts == null ? "—" : s.avgAttempts.toFixed(1)} sub="per finished mod" />
        <Stat label="Agent sessions" value={s.sessions.length} sub={`${s.linkedSessions} with a session ID`} />
        <Stat label="Total spend" value={fmtMoney(s.spend)} sub={`${fmtTokens(s.tokens.in + s.tokens.out)} tokens`} />
      </section>

      <section className="card chart-card">
        <div className="section-head">
          <div>
            <h4>Mods per day</h4>
            <p className="muted-line">Last 14 days, colored by outcome</p>
          </div>
          <div className="legend">
            <span className="lg passed">Passed</span>
            <span className="lg failed">Failed</span>
            <span className="lg running">Running</span>
          </div>
        </div>
        <DailyBars days={s.days} />
      </section>

      <div className="insight-grid">
        <section className="card">
          <div className="section-head">
            <h4>Spend by agent role</h4>
          </div>
          <table className="plain-table">
            <thead>
              <tr>
                <th>Role</th>
                <th className="num">Sessions</th>
                <th className="num">Tokens</th>
                <th>Share</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.byRole)
                .sort((a, b) => b[1].cost - a[1].cost)
                .map(([role, r]) => (
                  <tr key={role}>
                    <td>{ROLE[role] || role}</td>
                    <td className="num">{r.sessions}</td>
                    <td className="num">{fmtTokens(r.tokens)}</td>
                    <td>
                      <span className="meter">
                        <i style={{ width: `${Math.round((r.cost / totalRoleCost) * 100)}%` }} />
                      </span>
                    </td>
                    <td className="num">{fmtMoney(r.cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!Object.keys(s.byRole).length && <Empty>Sessions appear here as agents run.</Empty>}
        </section>

        <section className="card">
          <div className="section-head">
            <h4>Models</h4>
          </div>
          <table className="plain-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Sessions</th>
                <th className="num">Avg time</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.byModel).map(([model, m]) => (
                <tr key={model}>
                  <td className="mono">{model}</td>
                  <td className="num">{m.sessions}</td>
                  <td className="num">{m.timed ? fmtDuration(m.ms / m.timed) : "—"}</td>
                  <td className="num">{fmtMoney(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!Object.keys(s.byModel).length && <Empty>No model usage yet.</Empty>}
        </section>

        <section className="card">
          <div className="section-head">
            <h4>Why attempts failed</h4>
          </div>
          <Bars
            rows={Object.entries(s.failureKinds).map(([k, n]) => [FAILURE[k] || k, n])}
            empty="No failed attempts yet."
          />
          <div className="section-head">
            <h4>Attempts needed to pass</h4>
          </div>
          <Bars
            rows={[1, 2, 3].map((n) => [`${n} attempt${n === 1 ? "" : "s"}`, s.attemptsToPass[n] || 0])}
            empty="No passing mods yet."
          />
        </section>

        <section className="card">
          <div className="section-head">
            <h4>Partner coverage</h4>
          </div>
          <Coverage label="Entire checkpoints" value={s.checkpointCommits} sub={`${s.entireMods} of ${s.mods} mod repositories`} />
          <Coverage
            label="Neatlogs sessions"
            value={s.linkedSessions}
            sub={`of ${s.sessions.length} sessions · ${s.neatlogsMods} mods traced`}
          />
          <div className="section-head">
            <h4>Lessons the fixer wrote</h4>
            <span className="count">{lessons.length}</span>
          </div>
          {lessons.length ? (
            <ul className="lesson-list">
              {lessons.slice().reverse().map((l) => (
                <li key={l.at}>
                  <span>{l.lesson}</span>
                  <small>{l.mod}</small>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Lessons appear after a fix passes.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

function DailyBars({ days }) {
  const W = 760;
  const H = 180;
  const max = Math.max(1, ...days.map((d) => d.passed + d.failed + d.running));
  const slot = W / days.length;
  const bar = slot * 0.56;
  return (
    <svg className="daily" viewBox={`0 0 ${W} ${H + 26}`} role="img" aria-label="Mods per day by outcome">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="grid" />
      ))}
      {days.map((d, i) => {
        const x = i * slot + (slot - bar) / 2;
        let y = H;
        return (
          <g key={d.key}>
            {[
              ["passed", d.passed],
              ["failed", d.failed],
              ["running", d.running],
            ].map(([kind, n]) => {
              if (!n) return null;
              const h = (n / max) * H;
              y -= h;
              return <rect key={kind} className={kind} x={x} y={y} width={bar} height={h} rx="3" />;
            })}
            {(i % 2 === 0 || i === days.length - 1) && (
              <text x={x + bar / 2} y={H + 18} textAnchor="middle">
                {d.key.slice(5).replace("-", "/")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Bars({ rows, empty }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const total = rows.reduce((n, [, v]) => n + v, 0);
  if (!total) return <Empty>{empty}</Empty>;
  return (
    <ul className="hbars">
      {rows.map(([label, n]) => (
        <li key={label}>
          <span>{label}</span>
          <span className="meter">
            <i style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <strong>{n}</strong>
        </li>
      ))}
    </ul>
  );
}

function Coverage({ label, value, sub }) {
  return (
    <div className="coverage">
      <strong>{value}</strong>
      <div>
        <span>{label}</span>
        <small>{sub}</small>
      </div>
    </div>
  );
}

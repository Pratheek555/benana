import React from "react";
import { fmtTokens } from "../../api.js";
import { Empty, PageHead, ROLE, SectionHead, allSessions, fmtDuration, fmtMoney, sessionMs, shortModel, turnAttempts } from "./shared.jsx";

const FAILURE = {
  build: "Did not compile",
  assets: "Broken resource pack",
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
  // A mod's status is its latest turn's result, so count that turn's attempts, not the whole chat's.
  const latestAttempts = (m) => turnAttempts(m).length;
  const attemptsToPass = {};
  for (const m of passed) attemptsToPass[latestAttempts(m)] = (attemptsToPass[latestAttempts(m)] || 0) + 1;

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
    failed: mods.filter((m) => m.status === "failed").length,
    running: mods.filter((m) => m.running).length,
    finished: finished.length,
    passRate: finished.length ? passed.length / finished.length : null,
    firstTry: passed.filter((m) => latestAttempts(m) === 1).length,
    avgAttempts: finished.length ? finished.reduce((n, m) => n + latestAttempts(m), 0) / finished.length : null,
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
  const range = `${label(s.days[0].key)} to ${label(s.days.at(-1).key)}`;

  return (
    <div className="view">
      <PageHead eyebrow="Performance report" title="Insights" sub="Build outcomes, agent usage, and lessons across the workspace.">
        <span className="range-label"><span>Activity window</span>{range}</span>
      </PageHead>

      <section className="kpis">
        <Stat label="Mods built" value={s.mods} sub={`${s.passed} passed`} />
        <Stat
          label="Pass rate"
          value={s.passRate == null ? "—" : `${Math.round(s.passRate * 100)}%`}
          sub={`of ${s.finished} finished`}
        />
        <Stat label="Agent sessions" value={s.sessions.length} sub={`${s.linkedSessions} with a session ID`} />
        <Stat label="Total spend" value={fmtMoney(s.spend)} sub={`${fmtTokens(s.tokens.in + s.tokens.out)} tokens`} />
      </section>

      <div className="insight-hero">
        <section className="panel pad activity-panel">
          <SectionHead title="Build activity">
            <div className="legend">
              <span className="lg passed">Passed</span>
              <span className="lg failed">Failed</span>
              <span className="lg running">Running</span>
            </div>
          </SectionHead>
          <p className="meta">14 days, grouped by the mod's current outcome</p>
          <DailyBars days={s.days} />
        </section>
        <section className="panel pad quality-panel">
          <span className="panel-eyebrow">All-time quality</span>
          <div className="quality-score">
            <strong>{s.passRate == null ? "—" : `${Math.round(s.passRate * 100)}%`}</strong>
            <span>pass rate</span>
          </div>
          <div className="quality-track"><i style={{ width: `${Math.round((s.passRate || 0) * 100)}%` }} /></div>
          <div className="outcome-ledger">
            <div><span>Passed</span><strong>{s.passed}</strong></div>
            <div><span>Failed</span><strong>{s.failed}</strong></div>
            <div><span>Running</span><strong>{s.running}</strong></div>
            <div><span>Finished</span><strong>{s.finished}</strong></div>
            <div><span>First try</span><strong>{s.firstTry}</strong></div>
            <div><span>Avg attempts</span><strong>{s.avgAttempts == null ? "—" : s.avgAttempts.toFixed(1)}</strong></div>
          </div>
        </section>
      </div>

      <div className="insight-grid">
        <section className="panel pad role-spend">
          <SectionHead title="Spend by agent role" />
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th className="num">Sessions</th>
                <th className="num">Tokens</th>
                <th>Share of spend</th>
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

        <section className="panel pad">
          <SectionHead title="Models" />
          <table className="table">
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
                  <td className="mono">{shortModel(model)}</td>
                  <td className="num">{m.sessions}</td>
                  <td className="num">{m.timed ? fmtDuration(m.ms / m.timed) : "—"}</td>
                  <td className="num">{fmtMoney(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!Object.keys(s.byModel).length && <Empty>No model usage yet.</Empty>}
        </section>

        <section className="panel pad">
          <SectionHead title="Why attempts failed" />
          <Bars rows={Object.entries(s.failureKinds).map(([k, n]) => [FAILURE[k] || k, n])} empty="No failed attempts yet." />
          <SectionHead title="Attempts needed to pass" />
          <Bars
            rows={[1, 2, 3].map((n) => [`${n} attempt${n === 1 ? "" : "s"}`, s.attemptsToPass[n] || 0])}
            empty="No passing mods yet."
          />
        </section>

        <section className="panel pad">
          <SectionHead title="Partner coverage" />
          <div className="coverage-row">
            <Coverage tone="entire" label="Entire checkpoints" value={s.checkpointCommits} sub={`${s.entireMods} of ${s.mods} repositories`} />
            <Coverage
              tone="neatlogs"
              label="Neatlogs sessions"
              value={s.linkedSessions}
              sub={`of ${s.sessions.length} · ${s.neatlogsMods} mods traced`}
            />
          </div>
          <SectionHead title="Lessons the fixer wrote" count={lessons.length} />
          {lessons.length ? (
            <ul className="lesson-list">
              {lessons
                .slice()
                .reverse()
                .map((l, i) => (
                  <li key={l.at}>
                    <span className="lesson-number">{String(lessons.length - i).padStart(2, "0")}</span>
                    <p>{l.lesson}</p>
                    <small>{l.mod}{l.at ? ` / ${new Date(l.at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</small>
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

function Stat({ label, value, sub }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

const SERIES = [
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["running", "Running"],
];

function DailyBars({ days }) {
  const [hover, setHover] = React.useState(null);
  const [W, setW] = React.useState(760);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(320, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 180;
  const TOP = 10;
  const LEFT = 28;
  const max = Math.max(1, ...days.map((d) => d.passed + d.failed + d.running));
  const slot = (W - LEFT) / days.length;
  const bar = Math.min(26, slot * 0.5);
  const gap = 2;
  const ticks = max <= 4 ? Array.from({ length: max }, (_, i) => i + 1) : [Math.round(max / 2), max];
  const yOf = (v) => TOP + H - (v / max) * H;
  const hovered = hover == null ? null : days[hover];

  return (
    <div className="chart" ref={ref}>
      <svg className="daily" width={W} height={TOP + H + 26} role="img" aria-label="Mods per day by outcome">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={yOf(t)} y2={yOf(t)} className="grid" />
            <text x={LEFT - 10} y={yOf(t)} textAnchor="end" dominantBaseline="middle" className="tick">
              {t}
            </text>
          </g>
        ))}
        <line x1={LEFT} x2={W} y1={TOP + H} y2={TOP + H} className="axis" />
        {days.map((d, i) => {
          const x0 = LEFT + i * slot;
          const x = x0 + (slot - bar) / 2;
          const segs = SERIES.map(([k]) => [k, d[k]]).filter(([, n]) => n);
          let y = TOP + H;
          return (
            <g
              key={d.key}
              tabIndex="0"
              role="img"
              aria-label={`${fullLabel(d.key)}: ${d.passed} passed, ${d.failed} failed, ${d.running} running`}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect className="hit" x={x0} y="0" width={slot} height={TOP + H + 26} />
              {hover === i && <rect className="hover-band" x={x0 + 2} y={TOP} width={slot - 4} height={H} rx="4" />}
              {segs.map(([kind, n], j) => {
                const h = Math.max(2, (n / max) * H - (j > 0 ? gap : 0));
                y -= h + (j > 0 ? gap : 0);
                return j === segs.length - 1 ? (
                  <path key={kind} className={kind} d={roundedTop(x, y, bar, h, 4)} />
                ) : (
                  <rect key={kind} className={kind} x={x} y={y} width={bar} height={h} />
                );
              })}
              {!segs.length && <line className="zero" x1={x + 2} x2={x + bar - 2} y1={TOP + H - 1} y2={TOP + H - 1} />}
              {(i % 2 === 1 || i === days.length - 1) && (
                <text x={x + bar / 2} y={TOP + H + 18} textAnchor="middle" className="tick">
                  {label(d.key)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="tooltip" style={{ left: Math.max(76, Math.min(W - 76, LEFT + (hover + 0.5) * slot)) }}>
          <strong>{fullLabel(hovered.key)}</strong>
          {SERIES.map(([k, name]) => (
            <span key={k}>
              <i className={k} />
              {name}
              <b>{hovered[k]}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const label = (key) => {
  const [, m, d] = key.split("-");
  return new Date(2000, Number(m) - 1, Number(d)).toLocaleDateString([], { month: "short", day: "numeric" });
};

const fullLabel = (key) => new Date(`${key}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

function roundedTop(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function Bars({ rows, empty }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const total = rows.reduce((n, [, v]) => n + v, 0);
  if (!total) return <Empty>{empty}</Empty>;
  return (
    <ul className="hbars">
      {rows.map(([name, n]) => (
        <li key={name}>
          <span>{name}</span>
          <span className="meter">
            <i style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <strong>{n}</strong>
        </li>
      ))}
    </ul>
  );
}

function Coverage({ label: name, value, sub, tone }) {
  return (
    <div className="coverage">
      <span className={`partner-dot ${tone}`} />
      <div>
        <strong>{value}</strong>
        <span>{name}</span>
        <small>{sub}</small>
      </div>
    </div>
  );
}

import React from "react";
import { call, on, ago } from "../../api.js";
import { CheckIcon, Empty, Icon, PageHead, SectionHead, Status, fmtDuration, fmtMoney } from "./shared.jsx";
import "./bench.css";

const pct = (r) => Math.round((r.passed / Math.max(1, r.total)) * 100);

// Score per run, oldest first, so improvement reads left to right.
function ScoreHistory({ runs, onOpenMod }) {
  if (!runs.length) return <Empty>No runs yet. Run the benchmark to get a baseline score.</Empty>;
  return (
    <div className="bench-history" role="list">
      {runs.map((r, i) => (
        <button key={r.id} role="listitem" className="bench-col" onClick={() => onOpenMod(r.modId)} title={`${r.modName} · ${r.passed}/${r.total} · open the mod`}>
          <span className="bench-col-value">{r.passed}/{r.total}</span>
          <span className="bench-col-track">
            <i className={pct(r) === 100 ? "full" : ""} style={{ height: `${Math.max(4, pct(r))}%` }} />
          </span>
          <span className="bench-col-label">#{i + 1}</span>
          <small>{r.lessonsBefore ?? 0} lessons</small>
        </button>
      ))}
    </div>
  );
}

// Rows are runs (newest first), columns are the task's capabilities; a cell passes only if every check for it passed.
function CapabilityGrid({ task, runs }) {
  const caps = Object.entries(task.capabilities || {});
  const cell = (run, cap) => {
    const checks = run.checks.filter((c) => c.capability === cap);
    if (!checks.length) return { status: "pending", title: "No checks" };
    const status = checks.every((c) => c.status === "pass") ? "pass" : checks.some((c) => c.status === "fail") ? "fail" : "blocked";
    return { status, title: checks.map((c) => `${c.title}: ${c.status}${c.status !== "pass" ? ` (${c.observed})` : ""}`).join("\n") };
  };
  return (
    <div className="bench-grid-wrap">
      <table className="bench-grid">
        <thead>
          <tr>
            <th>Run</th>
            {caps.map(([id, label]) => <th key={id}>{label}</th>)}
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {runs.slice().reverse().slice(0, 8).map((r, i, all) => (
            <tr key={r.id}>
              <td className="mono">#{runs.length - i}<small>{ago(r.at)} ago</small></td>
              {caps.map(([id]) => {
                const c = cell(r, id);
                return (
                  <td key={id} className={`cap ${c.status}`} title={c.title}>
                    <CheckIcon status={c.status} />
                  </td>
                );
              })}
              <td className="num">{pct(r)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LatestRun({ run }) {
  return (
    <ul className="bench-checks">
      {run.checks.map((c) => (
        <li key={c.id} className={c.status}>
          <CheckIcon status={c.status} />
          <div>
            <strong>{c.title}</strong>
            {c.status !== "pass" && <p>{c.observed}</p>}
            <small>{c.by === "benana" ? "Checked by Benana" : "Checked in-game by the grader"}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function BenchPage({ mods, lessons, running, onWatch, onOpenMod }) {
  const [tasks, setTasks] = React.useState([]);
  const [results, setResults] = React.useState([]);
  const [error, setError] = React.useState("");
  const [starting, setStarting] = React.useState(false);

  const refresh = React.useCallback(() => {
    call("studio:bench-tasks").then(setTasks).catch((e) => setError(e.message));
    call("studio:bench-results").then(setResults).catch(() => {});
  }, []);
  React.useEffect(() => {
    refresh();
    return on("studio:bench", refresh);
  }, [refresh]);

  const task = tasks[0];
  const runs = results.filter((r) => r.taskId === task?.id).sort((a, b) => a.at - b.at);
  const latest = runs.at(-1);
  const best = runs.reduce((b, r) => (!b || pct(r) > pct(b) ? r : b), null);
  const live = mods.find((m) => m.running && m.bench?.taskId === task?.id);
  const coachLessons = lessons.filter((l) => l.source === "coach");

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      const mod = await call("studio:bench-run", { taskId: task.id });
      onWatch(mod.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  if (!task) {
    return (
      <div className="view">
        <PageHead title="Bench" sub="Benchmark mods with hidden in-game checks." />
        {error ? <div className="alert">{error}</div> : <Empty>No benchmark tasks found in bench/.</Empty>}
      </div>
    );
  }

  return (
    <div className="view bench">
      <PageHead
        eyebrow="Benana Bench"
        title={task.title}
        sub="One fixed mod request. The builder never sees the grader's checks; scores over repeated runs show whether the agent is getting better."
      >
        {live ? (
          <button className="btn" onClick={() => onWatch(live.id)}>
            <span className="live-dot" /> Watch run
          </button>
        ) : (
          <button className="btn solid" onClick={start} disabled={starting || Boolean(running)} title={running ? "Another mod is building." : undefined}>
            <Icon name="spark" size={14} />
            {starting ? "Starting…" : "Run benchmark"}
          </button>
        )}
      </PageHead>
      {error && <div className="alert page-alert">{error}</div>}

      <div className="bench-top">
        <section className="panel pad bench-task">
          <span className="panel-eyebrow">The request</span>
          <blockquote>{task.prompt}</blockquote>
          <div className="bench-caps">
            {Object.values(task.capabilities || {}).map((label) => <span key={label}>{label}</span>)}
          </div>
          <SectionHead title="Hidden checks" count={task.checks.length + (task.assets ? 1 : 0)} />
          <ol className="bench-hidden">
            {task.checks.map((c) => <li key={c.id}>{c.title}</li>)}
            {task.assets && <li>Ships a generated item texture wired into the code</li>}
          </ol>
        </section>

        <section className="panel pad bench-score">
          <span className="panel-eyebrow">Latest score</span>
          <div className="quality-score">
            <strong>{latest ? `${latest.passed}/${latest.total}` : "—"}</strong>
            <span>{latest ? `${pct(latest)}% of hidden checks` : "not run yet"}</span>
          </div>
          <div className="quality-track"><i style={{ width: `${latest ? pct(latest) : 0}%` }} /></div>
          <div className="outcome-ledger">
            <div><span>Runs</span><strong>{runs.length}</strong></div>
            <div><span>Best</span><strong>{best ? `${pct(best)}%` : "—"}</strong></div>
            <div><span>First run</span><strong>{runs[0] ? `${pct(runs[0])}%` : "—"}</strong></div>
            <div><span>Lessons now</span><strong>{lessons.length}</strong></div>
            <div><span>Last cost</span><strong>{latest ? fmtMoney(latest.costUsd) : "—"}</strong></div>
            <div><span>Last time</span><strong>{latest ? fmtDuration(latest.durationMs) : "—"}</strong></div>
          </div>
        </section>
      </div>

      <section className="panel pad">
        <SectionHead title="Score per run" count={runs.length} />
        <ScoreHistory runs={runs} onOpenMod={onOpenMod} />
      </section>

      {runs.length > 0 && (
        <div className="bench-bottom">
          <section className="panel pad">
            <SectionHead title="Capabilities by run" />
            <CapabilityGrid task={task} runs={runs} />
          </section>
          <section className="panel pad">
            <SectionHead title="Latest run">
              <span className="meta">
                {latest.modName} · {latest.attempts} attempt{latest.attempts === 1 ? "" : "s"} · own test plan{" "}
                <Status status={latest.selfPassed ? "passed" : "failed"} />
              </span>
            </SectionHead>
            <LatestRun run={latest} />
          </section>
        </div>
      )}

      <section className="panel pad">
        <SectionHead title="Lessons the coach wrote" count={coachLessons.length} />
        {coachLessons.length ? (
          <ul className="lesson-list">
            {coachLessons.slice().reverse().map((l) => (
              <li key={l.at + l.lesson}>
                <span className="lesson-number">C</span>
                <p>{l.lesson}</p>
                <small>{l.mod} / {new Date(l.at).toLocaleDateString([], { month: "short", day: "numeric" })}</small>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>After a run, the coach turns failed hidden checks into lessons that every future builder reads.</Empty>
        )}
      </section>
    </div>
  );
}

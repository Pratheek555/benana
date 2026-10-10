import React from "react";
import { call, on, ago } from "../../api.js";
import GamePane from "../game/GamePane.jsx";
import { AttemptTimeline, Empty, PHASES, PartnerStatus, Pill, PlanChecks, ROLE, phaseIndex } from "./shared.jsx";

const EXAMPLES = [
  "A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown.",
  "Arrows that explode on impact without breaking blocks, with a 5 second cooldown per player.",
  "Right-clicking with a blaze rod shoots a fireball where you look.",
];

export default function BuildPage({ mods, mod, setSelectedId, lessons, onSeeMods }) {
  const [prompt, setPrompt] = React.useState("");
  const [seed, setSeed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [feed, setFeed] = React.useState([]);
  const selectedRef = React.useRef(null);
  selectedRef.current = mod?.id ?? null;
  const running = mods.some((m) => m.running);

  React.useEffect(() => {
    const off = on("studio:feed", ({ modId, item }) => {
      if (modId === selectedRef.current) setFeed((prev) => [...prev.slice(-599), item]);
    });
    return off;
  }, []);

  React.useEffect(() => {
    setFeed([]);
    if (!mod) return;
    call("studio:get", { id: mod.id }).then((full) => setFeed(full.feed.slice(-600))).catch(() => {});
  }, [mod?.id]);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await call("studio:create", { prompt, seed });
      setSelectedId(created.id);
      setPrompt("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canStart = !busy && !running && (seed || prompt.trim().length >= 8);

  return (
    <div className="build">
      <aside className="build-compose">
        <section className="card compose">
          <label className="field-label" htmlFor="mod-prompt">Describe a mod</label>
          <textarea
            id="mod-prompt"
            className="prompt"
            value={prompt}
            disabled={seed}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A golden sword that launches mobs into the sky…"
            rows={5}
          />
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setPrompt(ex)} title={ex} disabled={seed}>
                {ex.split(" ").slice(0, 4).join(" ")}…
              </button>
            ))}
          </div>
          <label className="seed-toggle">
            <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
            <span>
              <strong>Use the seeded bug</strong>
              Starts from a labeled buggy fixture. The playtester and fixer still run for real.
            </span>
          </label>
          <button className="btn-primary" disabled={!canStart} onClick={start}>
            {running ? "A mod is running" : busy ? "Starting…" : "Build and playtest"}
          </button>
          {error && <div className="studio-error">{error}</div>}
        </section>

        <section className="card">
          <div className="section-head">
            <h4>Recent mods</h4>
            {mods.length > 0 && <button className="link" onClick={onSeeMods}>See all</button>}
          </div>
          <div className="mod-picks">
            {mods.slice(0, 6).map((m) => (
              <button key={m.id} className={`mod-pick ${m.id === mod?.id ? "active" : ""}`} onClick={() => setSelectedId(m.id)}>
                <span>
                  <strong>{m.name}</strong>
                  <small>
                    {m.attempts.length} attempt{m.attempts.length === 1 ? "" : "s"} · {ago(m.createdAt)} ago
                  </small>
                </span>
                <Pill status={m.status} />
              </button>
            ))}
            {!mods.length && <Empty>No mods yet. Describe one to start.</Empty>}
          </div>
        </section>

        <section className="card lessons">
          <div className="section-head">
            <h4>Learned by the fixer</h4>
            <span className="count">{lessons.length}</span>
          </div>
          {lessons.length ? (
            <ul>
              {lessons.slice(-4).reverse().map((l) => (
                <li key={l.at}>
                  <span>{l.lesson}</span>
                  <small>{l.mod}</small>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Lessons appear here after a fix passes. Later builders read them first.</Empty>
          )}
        </section>
      </aside>

      <section className="build-stage">
        <Stepper mod={mod} />
        <div className="stage-card">
          <GamePane showLog={false} />
        </div>
        <Feed feed={feed} mod={mod} />
      </section>

      <aside className="build-inspector">
        {mod ? <ModBrief mod={mod} /> : <Empty>Select or describe a mod to see its test plan and attempts.</Empty>}
      </aside>
    </div>
  );
}

function ModBrief({ mod }) {
  return (
    <>
      <div className="brief-head">
        <div>
          <h3>{mod.name}</h3>
          <p className="brief-prompt">“{mod.prompt}”</p>
        </div>
        <Pill status={mod.status} />
      </div>
      {mod.seed && <div className="notice">Seeded bug fallback. Attempt 1 uses a labeled buggy fixture.</div>}
      {mod.running && (
        <button className="btn-danger" onClick={() => call("studio:stop", { id: mod.id })}>
          Stop this run
        </button>
      )}
      {mod.error && <div className="studio-error">{mod.error}</div>}
      <PlanChecks mod={mod} />
      <div className="section-head">
        <h4>Attempts</h4>
        <span className="count">{mod.attempts.length}</span>
      </div>
      <AttemptTimeline mod={mod} />
      <div className="section-head">
        <h4>Partners</h4>
      </div>
      <PartnerStatus mod={mod} />
      {mod.repoDir && (
        <button className="link" onClick={() => call("open-path", mod.repoDir)}>
          Open mod repository
        </button>
      )}
    </>
  );
}

function Stepper({ mod }) {
  const current = phaseIndex(mod);
  const done = mod?.status === "passed";
  const failed = ["failed", "stopped"].includes(mod?.status);
  return (
    <ol className="stepper" aria-label="Pipeline">
      {PHASES.map(([key, label], i) => {
        const state =
          i < current || (done && i <= current) ? "done" : i === current && !done ? (failed ? "failed" : "current") : "";
        return (
          <li key={key} className={`step ${state}`}>
            <span className="step-num">{String(i + 1).padStart(2, "0")}</span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
      {mod && (
        <span className="stepper-meta">
          {mod.attempts.length ? `Attempt ${mod.attempts.length}` : "Not started"}
        </span>
      )}
    </ol>
  );
}

function Feed({ feed, mod }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [feed.length]);
  const visible = feed.filter((f) => f.kind !== "result" || f.isError || f.role === "playtester");
  return (
    <section className="feed" ref={ref}>
      {!visible.length && <Empty>{mod ? "Waiting for agent activity." : "Agent activity appears here."}</Empty>}
      {visible.slice(-250).map((f, i) => (
        <div key={`${f.at}-${i}`} className={`feed-row ${f.role} ${f.kind}`}>
          <span className="feed-role">{ROLE[f.role] || f.role}</span>
          {f.attempt ? <span className="feed-attempt">#{f.attempt}</span> : null}
          <span className="feed-text">
            {f.kind === "tool" ? (
              <>
                <code>{f.name}</code> {f.summary}
              </>
            ) : f.kind === "result" ? (
              <>
                <code>{f.name}</code> → {f.text.slice(0, 300)}
              </>
            ) : (
              f.text
            )}
          </span>
        </div>
      ))}
    </section>
  );
}

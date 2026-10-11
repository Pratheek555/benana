import React from "react";
import { call, on } from "../../api.js";
import GamePane from "../game/GamePane.jsx";
import {
  AttemptTimeline,
  Empty,
  Icon,
  PHASES,
  PartnerStatus,
  PlanChecks,
  ROLE,
  SectionHead,
  Status,
  phaseIndex,
} from "./shared.jsx";

const EXAMPLES = [
  "A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown.",
  "Arrows that explode on impact without breaking blocks, with a 5 second cooldown per player.",
  "Right-clicking with a blaze rod shoots a fireball where you look.",
];

const FLOW = [
  ["Spec", "Opus turns your idea into a plugin spec and a test plan."],
  ["Build", "Opus writes the Paper plugin, compiles it, and deploys it."],
  ["Playtest", "Sonnet joins the server as a player and runs every check."],
  ["Fix", "If a check fails, Opus reads the evidence and tries again."],
];

export default function BuildPage({ mod, running, lessons, onCreated, onWatch, onNew, onOpenCode }) {
  return mod ? (
    <RunView mod={mod} onNew={onNew} onOpenCode={onOpenCode} />
  ) : (
    <Composer running={running} lessons={lessons} onCreated={onCreated} onWatch={onWatch} />
  );
}

function Composer({ running, lessons, onCreated, onWatch }) {
  const [prompt, setPrompt] = React.useState("");
  const [seed, setSeed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await call("studio:create", { prompt, seed });
      setPrompt("");
      onCreated(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canStart = !busy && !running && (seed || prompt.trim().length >= 8);

  return (
    <div className="view compose-page">
      <div className="compose">
        <h1>What should your mod do?</h1>
        <p className="lede">Describe a gameplay idea. Benana writes the plugin, then an AI player tests it in a live server and fixes what breaks.</p>

        {running && (
          <button className="running-banner" onClick={() => onWatch(running.id)}>
            <Status status="running">Building</Status>
            <span>
              <strong>{running.name}</strong> is in progress. One mod builds at a time.
            </span>
            <span className="banner-cta">
              Watch <Icon name="arrow" size={14} />
            </span>
          </button>
        )}

        <div className={`prompt-box ${seed ? "seeded" : ""}`}>
          <textarea
            aria-label="Describe a mod"
            value={prompt}
            disabled={seed}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canStart) start();
            }}
            placeholder="A golden sword that launches mobs into the sky…"
            rows={4}
          />
          <div className="composer-bar">
            <label className="toggle" title="Attempt 1 starts from a labeled buggy fixture. The playtester and fixer still run for real.">
              <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
              <span className="switch" />
              Start from the seeded bug
            </label>
            <button className="btn solid" disabled={!canStart} onClick={start}>
              {busy ? "Starting…" : "Build and playtest"}
              <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </div>
        {error && <div className="alert">{error}</div>}

        <div className="examples">
          <span className="side-label">Try one</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setPrompt(ex)} disabled={seed}>
              <span>{ex}</span>
              <Icon name="arrow" size={14} />
            </button>
          ))}
        </div>

        <ol className="flow">
          {FLOW.map(([title, text], i) => (
            <li key={title}>
              <span className="flow-n">{i + 1}</span>
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>

        {lessons.length > 0 && (
          <section className="lessons">
            <SectionHead title="What the fixer has learned" count={lessons.length} />
            <p className="meta">Every new builder reads these before it writes code.</p>
            <ul>
              {lessons
                .slice(-3)
                .reverse()
                .map((l) => (
                  <li key={l.at}>
                    <p>{l.lesson}</p>
                    <small>{l.mod}</small>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function RunView({ mod, onNew, onOpenCode }) {
  const [feed, setFeed] = React.useState([]);
  const idRef = React.useRef(mod.id);
  idRef.current = mod.id;

  React.useEffect(() => {
    return on("studio:feed", ({ modId, item }) => {
      if (modId === idRef.current) setFeed((prev) => [...prev.slice(-599), item]);
    });
  }, []);

  React.useEffect(() => {
    setFeed([]);
    call("studio:get", { id: mod.id })
      .then((full) => setFeed(full.feed.slice(-600)))
      .catch(() => {});
  }, [mod.id]);

  return (
    <div className="view run-page">
      <header className="run-head">
        <div className="run-title">
          <div className="run-name">
            <h1>{mod.name}</h1>
            <Status status={mod.running ? "running" : mod.status} />
            {mod.seed && <span className="tag">Seeded bug</span>}
          </div>
          <p>{mod.prompt}</p>
        </div>
        <div className="page-actions">
          {mod.running && (
            <button className="btn danger" onClick={() => call("studio:stop", { id: mod.id })}>
              <Icon name="stop" size={14} />
              Stop run
            </button>
          )}
          {mod.repoDir && (
            <button className="btn" onClick={() => onOpenCode(mod.id)}>
              <Icon name="code" size={14} />
              View code
            </button>
          )}
          {!mod.running && (
            <button className="btn" onClick={onNew}>
              <Icon name="plus" size={14} />
              New mod
            </button>
          )}
        </div>
      </header>

      <Pipeline mod={mod} />
      {mod.error && <div className="alert">{mod.error}</div>}

      <div className="run-grid">
        <div className="run-stage">
          <GamePane showLog={false} />
          <Activity feed={feed} />
        </div>
        <aside className="run-side">
          <PlanChecks mod={mod} />
          <section className="block">
            <SectionHead title="Attempts" count={mod.attempts.length} />
            <AttemptTimeline mod={mod} />
          </section>
          <section className="block">
            <SectionHead title="Partners" />
            <PartnerStatus mod={mod} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function Pipeline({ mod }) {
  const current = phaseIndex(mod);
  const done = mod.status === "passed";
  const failed = ["failed", "stopped"].includes(mod.status);
  return (
    <ol className="pipeline" aria-label="Pipeline">
      {PHASES.map(([key, label], i) => {
        const state = done || i < current ? "done" : i === current ? (failed ? "failed" : "current") : "todo";
        return (
          <li key={key} className={state}>
            <span className="pipe-icon">
              {state === "done" && <Icon name="check" size={11} />}
              {state === "failed" && <Icon name="x" size={11} />}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
      <li className="pipe-meta">{mod.attempts.length ? `Attempt ${mod.attempts.length}` : "Not started"}</li>
    </ol>
  );
}

const clock = (ts) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";

function Activity({ feed }) {
  const ref = React.useRef(null);
  const stick = React.useRef(true);
  const visible = feed.filter((f) => f.kind !== "session" && (f.kind !== "result" || f.isError || f.role === "playtester"));

  React.useEffect(() => {
    if (ref.current && stick.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [visible.length]);

  return (
    <section className="activity">
      <div className="activity-head">
        <h3>Agent activity</h3>
        <span className="meta">{visible.length} events</span>
      </div>
      <div
        className="activity-body"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!visible.length && <Empty>Agent activity streams here as the run progresses.</Empty>}
        {visible.slice(-250).map((f, i) => (
          <div key={`${f.at}-${i}`} className={`event ${f.kind} ${f.isError ? "error" : ""}`}>
            <time>{clock(f.at)}</time>
            <span className={`event-role ${f.role}`}>
              {ROLE[f.role] || f.role}
              {f.attempt ? <small>#{f.attempt}</small> : null}
            </span>
            <div className="event-text">
              {f.kind === "tool" ? (
                <>
                  <code>{f.name}</code>
                  <span>{f.summary}</span>
                </>
              ) : f.kind === "result" ? (
                <>
                  <code>{f.name}</code>
                  <span className="result">{f.text.slice(0, 300)}</span>
                </>
              ) : (
                <span>{f.text}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

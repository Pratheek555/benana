import React from "react";
import { call, on, ago } from "../../api.js";
import GamePane from "../game/GamePane.jsx";
import "./studio.css";

const EXAMPLES = [
  "A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown.",
  "Arrows that explode on impact without breaking blocks, with a 5 second cooldown per player.",
  "Right-clicking with a blaze rod shoots a fireball where you look.",
];

const PHASES = [
  ["spec", "Spec"],
  ["repo", "Repo"],
  ["build", "Build"],
  ["compile", "Compile"],
  ["deploy", "Deploy"],
  ["playtest", "Playtest"],
  ["fix", "Fix"],
  ["done", "Done"],
];

const ROLE = {
  spec: "Spec agent",
  builder: "Builder",
  fixer: "Fixer",
  playtester: "Playtester",
  benana: "Benana",
};

function phaseIndex(mod) {
  if (!mod) return -1;
  if (mod.phase === "fix") return 6;
  const i = PHASES.findIndex(([key]) => key === mod.phase);
  return i;
}

function latestVerdict(mod) {
  const withVerdict = [...(mod?.attempts || [])].reverse().find((a) => a.verdict);
  return withVerdict?.verdict || null;
}

export default function ModStudio({ onOpenWorkspace }) {
  const [mods, setMods] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [feed, setFeed] = React.useState([]);
  const [prompt, setPrompt] = React.useState("");
  const [seed, setSeed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lessons, setLessons] = React.useState([]);
  const selectedRef = React.useRef(null);
  selectedRef.current = selectedId;

  React.useEffect(() => {
    call("studio:list")
      .then((list) => {
        setMods(list);
        if (list[0]) setSelectedId(list[0].id);
      })
      .catch((e) => setError(e.message));
    call("studio:lessons").then(setLessons).catch(() => {});
    const offs = [
      on("studio:mod", (mod) => {
        setMods((prev) => {
          const rest = prev.filter((m) => m.id !== mod.id);
          return [mod, ...rest].sort((a, b) => b.createdAt - a.createdAt);
        });
        if (mod.status === "passed") call("studio:lessons").then(setLessons).catch(() => {});
      }),
      on("studio:feed", ({ modId, item }) => {
        if (modId === selectedRef.current)
          setFeed((prev) => [...prev.slice(-599), item]);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  React.useEffect(() => {
    setFeed([]);
    if (!selectedId) return;
    call("studio:get", { id: selectedId })
      .then((mod) => setFeed(mod.feed.slice(-600)))
      .catch(() => {});
  }, [selectedId]);

  const mod = mods.find((m) => m.id === selectedId) || null;
  const running = mods.some((m) => m.running);

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

  return (
    <div className="studio">
      <aside className="studio-side">
        <div className="studio-brand">
          <span className="brand">B</span>
          <strong>Mod Studio</strong>
        </div>
        <p className="studio-muted">
          Describe a Minecraft mod. Benana writes it, plays it in-game, and
          fixes what breaks.
        </p>
        <textarea
          className="studio-prompt"
          value={prompt}
          disabled={seed}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A golden sword that launches mobs into the sky…"
          rows={4}
        />
        <div className="studio-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setPrompt(ex)} title={ex}>
              {ex.split(" ").slice(0, 4).join(" ")}…
            </button>
          ))}
        </div>
        <label className="studio-seed">
          <input
            type="checkbox"
            checked={seed}
            onChange={(e) => setSeed(e.target.checked)}
          />
          <span>
            Seeded bug (fallback). Starts from a labeled buggy LaunchSword;
            the playtester and fixer still run for real.
          </span>
        </label>
        <button
          className="studio-go"
          disabled={busy || running || (!seed && prompt.trim().length < 8)}
          onClick={start}
        >
          {running ? "A mod is running…" : "Build and playtest"}
        </button>
        {error && <div className="studio-error">{error}</div>}

        <h4>Mods</h4>
        <div className="studio-mods">
          {mods.map((m) => (
            <button
              key={m.id}
              className={`studio-mod ${m.id === selectedId ? "active" : ""}`}
              onClick={() => setSelectedId(m.id)}
            >
              <span className={`pill ${m.status}`}>{m.status}</span>
              <strong>{m.name}</strong>
              <small>
                {m.attempts.length} attempt{m.attempts.length === 1 ? "" : "s"}{" "}
                · {ago(m.createdAt)} ago{m.seed ? " · seeded" : ""}
              </small>
            </button>
          ))}
          {!mods.length && <p className="studio-muted">No mods yet.</p>}
        </div>

        {lessons.length > 0 && (
          <>
            <h4>Learned by the fixer</h4>
            <ul className="studio-lessons">
              {lessons.slice(-4).map((l) => (
                <li key={l.at}>{l.lesson}</li>
              ))}
            </ul>
          </>
        )}
        <button className="studio-link" onClick={onOpenWorkspace}>
          Open repository workspace
        </button>
      </aside>

      <main className="studio-main">
        <Stepper mod={mod} />
        <GamePane showLog={false} />
        <Feed feed={feed} mod={mod} />
      </main>

      <aside className="studio-inspector">
        {mod ? <Inspector mod={mod} /> : <p className="studio-muted">Describe a mod to start.</p>}
      </aside>
    </div>
  );
}

function Stepper({ mod }) {
  const current = phaseIndex(mod);
  const done = mod?.status === "passed";
  const failed = ["failed", "stopped"].includes(mod?.status);
  return (
    <div className="studio-stepper">
      {PHASES.map(([key, label], i) => (
        <div
          key={key}
          className={`step ${i < current || (done && i <= current) ? "done" : ""} ${
            i === current && !done ? (failed ? "failed" : "current") : ""
          }`}
        >
          <span className="dot" />
          {label}
        </div>
      ))}
      {mod && (
        <span className="studio-attempt">
          {mod.name}
          {mod.attempts.length ? ` · attempt ${mod.attempts.length}` : ""}
        </span>
      )}
    </div>
  );
}

function Feed({ feed, mod }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [feed.length]);
  const visible = feed.filter((f) => f.kind !== "result" || f.isError || f.role === "playtester");
  return (
    <section className="studio-feed" ref={ref}>
      {!visible.length && (
        <p className="studio-muted">
          {mod ? "Waiting for agent activity…" : "Agent activity appears here."}
        </p>
      )}
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

function CheckIcon({ status }) {
  const map = { pass: "✓", fail: "✕", blocked: "!", pending: "·" };
  return <span className={`check-icon ${status}`}>{map[status] || "·"}</span>;
}

function Inspector({ mod }) {
  const verdict = latestVerdict(mod);
  const byId = new Map((verdict?.checks || []).map((c) => [c.id, c]));
  const last = mod.attempts[mod.attempts.length - 1];
  return (
    <>
      <div className="insp-head">
        <h3>{mod.name}</h3>
        <span className={`pill ${mod.status}`}>{mod.status}</span>
      </div>
      {mod.seed && (
        <div className="insp-seed">
          Seeded bug fallback: attempt 1 uses a labeled buggy fixture.
        </div>
      )}
      <p className="insp-prompt">“{mod.prompt}”</p>
      {mod.running && (
        <button className="studio-stop" onClick={() => call("studio:stop", { id: mod.id })}>
          Stop
        </button>
      )}
      {mod.error && <div className="studio-error">{mod.error}</div>}

      <h4>
        In-game test plan
        {verdict?.live && last?.status === "running" ? (
          <span className="live">live</span>
        ) : null}
      </h4>
      {!mod.testPlan && <p className="studio-muted">The spec agent is writing it…</p>}
      <ul className="insp-checks">
        {(mod.testPlan?.checks || []).map((c) => {
          const r = byId.get(c.id);
          return (
            <li key={c.id}>
              <CheckIcon status={r?.status || "pending"} />
              <div>
                <strong>{c.title}</strong>
                <small>{r?.observed || c.expect}</small>
              </div>
            </li>
          );
        })}
      </ul>
      {verdict?.serverErrors?.length > 0 && (
        <div className="studio-error">
          {verdict.serverErrors.length} server error(s):{" "}
          {verdict.serverErrors[0].message.slice(0, 160)}
        </div>
      )}

      <h4>Attempts</h4>
      <ol className="insp-attempts">
        {mod.attempts.map((a) => (
          <Attempt key={a.n} attempt={a} />
        ))}
      </ol>
      {!mod.attempts.length && <p className="studio-muted">No attempts yet.</p>}

      <h4>Partners</h4>
      <Partners mod={mod} />
    </>
  );
}

function Attempt({ attempt }) {
  return (
    <li className={`attempt ${attempt.status}`}>
      <div className="attempt-head">
        <strong>
          #{attempt.n} {attempt.role === "seeded" ? "Seeded (labeled)" : ROLE[attempt.role]}
        </strong>
        <span className={`pill ${attempt.status}`}>{attempt.status}</span>
      </div>
      {attempt.failure && <p className="attempt-fail">{attempt.failure.summary}</p>}
      {attempt.lesson && <p className="attempt-lesson">Lesson: {attempt.lesson}</p>}
      {attempt.context && (
        <p className="attempt-meta">
          Fixer context: {attempt.context.entireCheckpoints} Entire checkpoints
          {attempt.context.neatlogsTrace ? ", Neatlogs trace" : ""}
        </p>
      )}
      <div className="attempt-meta">
        {attempt.commit?.sha && <code>{attempt.commit.sha.slice(0, 7)}</code>}
        {attempt.commit?.checkpoint && (
          <span className="tag entire" title="Entire checkpoint">
            Entire {attempt.commit.checkpoint.slice(0, 10)}
          </span>
        )}
        {attempt.playtestCommit?.checkpoint && (
          <span className="tag entire" title="Entire checkpoint for the playtest session">
            Entire {attempt.playtestCommit.checkpoint.slice(0, 10)}
          </span>
        )}
      </div>
      <div className="attempt-sessions">
        {attempt.sessions.map((s, i) => (
          <Session key={i} session={s} />
        ))}
      </div>
    </li>
  );
}

function Session({ session }) {
  const [trace, setTrace] = React.useState(null);
  const check = () =>
    call("studio:evidence", { sessionId: session.sessionId })
      .then(setTrace)
      .catch((e) => setTrace({ error: e.message }));
  return (
    <div className="session">
      <span>
        {ROLE[session.role] || session.role} · {session.model}
        {session.usage?.costUsd ? ` · $${session.usage.costUsd.toFixed(2)}` : ""}
      </span>
      {session.sessionId && (
        <button className="tag neatlogs" onClick={check}>
          {trace
            ? trace.matched
              ? `Neatlogs: ${trace.traces.length} trace${trace.traces.length === 1 ? "" : "s"}`
              : trace.configured === false
                ? "Neatlogs not configured"
                : "No trace yet"
            : "Neatlogs trace"}
        </button>
      )}
    </div>
  );
}

function Partners({ mod }) {
  const [cps, setCps] = React.useState(null);
  React.useEffect(() => {
    if (!mod.repoDir) return;
    call("studio:checkpoints", { id: mod.id }).then(setCps).catch(() => {});
  }, [mod.id, mod.repoDir, mod.attempts.length, mod.status]);
  const p = mod.partners;
  return (
    <div className="insp-partners">
      <div>
        <span className={`tag ${p?.entire?.enabled ? "entire" : "off"}`}>Entire</span>
        {p?.entire?.enabled
          ? `${cps?.items?.length ?? "…"} checkpoints in the mod repo`
          : p?.entire?.error || "Not set up yet"}
      </div>
      <div>
        <span className={`tag ${p?.neatlogs?.enabled ? "neatlogs" : "off"}`}>Neatlogs</span>
        {p?.neatlogs?.enabled ? "Agent sessions traced" : p?.neatlogs?.error || "Not set up yet"}
      </div>
      {mod.repoDir && (
        <button className="studio-link" onClick={() => call("open-path", mod.repoDir)}>
          Open mod repository
        </button>
      )}
    </div>
  );
}

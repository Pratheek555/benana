import React from "react";
import Split from "./Split.jsx";
import { call, on } from "../../api.js";
import TestPanel, { useNow, useStickyScroll } from "./TestPanel.jsx";
import { HandoffCard, TraceChip, TraceDrawer } from "./traces.jsx";
import "./bench.css";
import {
  CheckIcon,
  Icon,
  PHASES,
  ROLE,
  Status,
  fmtDuration,
  fmtMoney,
  latestVerdict,
  modSpend,
  phaseIndex,
  shortModel,
  turnAttempts,
  turnsOf,
} from "./shared.jsx";

const EXAMPLES = [
  "A golden sword that launches any mob it hits into the sky with particles, with a 3 second cooldown.",
  "Arrows that explode on impact without breaking blocks, with a 5 second cooldown per player.",
  "Right-clicking with a blaze rod shoots a fireball where you look.",
  "A Skyhook item with its own texture: right-click a block up to 24 blocks away to get pulled to it, no fall damage for 4 seconds after.",
];

const STEP_DETAIL = {
  spec: "Turn the idea into a plugin spec and an in-game test plan",
  repo: "Create the mod repository with Entire and Neatlogs hooks",
  build: "Write the Paper plugin",
  compile: "Package it with Maven",
  deploy: "Load it on the Paper server",
  playtest: "An AI player runs every check in-game",
  fix: "Patch failures from the evidence, up to 3 attempts",
  done: "Report the result",
};

// A follow-up message changes the existing plugin, so the repository step is already done.
const REVISION_DETAIL = {
  spec: "Update the plugin spec and test plan for your change",
  repo: "Already set up",
  build: "Change the existing plugin",
};

export default function BuildPage({ mod, running, lessons, onCreated, onWatch, onNew, onOpenCode }) {
  const [prompt, setPrompt] = React.useState("");
  return (
    <Split id="build" className="build-chat" initial={[0.42, 0.58]} min={340}>
      <section className="chat">
        <ChatHead mod={mod} onNew={onNew} onOpenCode={onOpenCode} />
        {mod ? <Thread mod={mod} onOpenCode={onOpenCode} /> : <Welcome lessons={lessons} onPick={setPrompt} />}
        <Composer
          mod={mod}
          running={running}
          prompt={prompt}
          setPrompt={setPrompt}
          onCreated={onCreated}
          onWatch={onWatch}
        />
      </section>
      <TestPanel mod={mod} building={Boolean(running)} />
    </Split>
  );
}

function ChatHead({ mod, onNew, onOpenCode }) {
  return (
    <header className="chat-head">
      <div className="chat-title">
        {mod ? (
          <>
            <strong>{mod.name}</strong>
            <Status status={mod.running ? "running" : mod.status} />
            {mod.seed && <span className="tag">Seeded bug</span>}
          </>
        ) : (
          <strong>New mod</strong>
        )}
      </div>
      {mod && (
        <div className="page-actions">
          {mod.running && (
            <button className="btn danger sm" onClick={() => call("studio:stop", { id: mod.id })}>
              <Icon name="stop" size={13} />
              Stop
            </button>
          )}
          {mod.repoDir && (
            <button className="btn sm" onClick={() => onOpenCode(mod.id)}>
              <Icon name="code" size={13} />
              Code
            </button>
          )}
          {!mod.running && (
            <button className="btn sm" onClick={onNew}>
              <Icon name="plus" size={13} />
              New
            </button>
          )}
        </div>
      )}
    </header>
  );
}

function Welcome({ lessons, onPick }) {
  return (
    <div className="thread welcome-wrap">
      <div className="intro">
        <span className="welcome-mark">B</span>
        <h1>What should your mod do?</h1>
        <p>Describe a gameplay idea. Benana writes the Paper plugin, an AI player tests it on a live server, and a fixer patches anything that breaks.</p>
        <div className="ideas">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => onPick(ex)}>
              <Icon name="spark" size={14} />
              <span>{ex}</span>
            </button>
          ))}
        </div>
        {lessons.length > 0 && (
          <div className="welcome-lessons">
            <span className="side-label">
              The fixer has learned {lessons.length} lesson{lessons.length === 1 ? "" : "s"}
            </span>
            <p>{lessons.at(-1).lesson}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ mod, running, prompt, setPrompt, onCreated, onWatch }) {
  const [seedOn, setSeed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const ref = React.useRef(null);
  // One chat is one mod: with a mod open, a message changes that mod. Only a new chat starts a new mod.
  const seed = seedOn && !mod;
  const canStart = !busy && !running && (seed || prompt.trim().length >= 8);
  const placeholder = running
    ? mod?.running
      ? "Building… ask for changes when it finishes"
      : "One mod builds at a time. Describe the next one…"
    : mod
      ? mod.repoDir
        ? `Ask for a change to ${mod.name}…`
        : "Add detail and try building again…"
      : "A golden sword that launches mobs into the sky…";

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [prompt]);

  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    setError("");
    try {
      if (mod) {
        await call("studio:revise", { id: mod.id, prompt });
        setPrompt("");
      } else {
        const created = await call("studio:create", { prompt, seed });
        setPrompt("");
        onCreated(created.id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-wrap">
      {mod?.running && <Dock mod={mod} />}
      {running && running.id !== mod?.id && (
        <button className="dock dock-link" onClick={() => onWatch(running.id)}>
          <span className="spinner" />
          <span>
            <strong>{running.name}</strong> is building
          </span>
          <span className="dock-cta">
            Watch <Icon name="arrow" size={13} />
          </span>
        </button>
      )}
      {error && <div className="alert">{error}</div>}
      <div className={`chat-input ${seed ? "seeded" : ""} ${running ? "locked" : ""}`}>
        <textarea
          ref={ref}
          rows={1}
          value={prompt}
          disabled={seed}
          aria-label={mod ? "Ask for a change" : "Describe a mod"}
          placeholder={placeholder}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              start();
            }
          }}
        />
        <div className="chat-input-bar">
          {!mod && (
            <label className="toggle" title="Attempt 1 starts from a labeled buggy fixture. The playtester and fixer still run for real.">
              <input type="checkbox" checked={seedOn} onChange={(e) => setSeed(e.target.checked)} />
              <span className="switch" />
              Seeded bug
            </label>
          )}
          <span className="input-hint">
            {running ? "Waiting for the current build" : `Enter to ${mod?.repoDir ? "apply the change" : "build"} · Shift+Enter for a new line`}
          </span>
          <button
            className="send"
            disabled={!canStart}
            onClick={start}
            aria-label={mod?.repoDir ? "Apply the change and playtest" : "Build and playtest"}
            title={mod?.repoDir ? "Apply the change and playtest" : "Build and playtest"}
          >
            {busy ? <span className="spinner dark" /> : <Icon name="send" size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dock({ mod }) {
  const now = useNow(true);
  const i = phaseIndex(mod);
  const label = PHASES[i]?.[1] || "Working";
  const verdict = latestVerdict(mod);
  const total = mod.testPlan?.checks.length || 0;
  const done = (verdict?.checks || []).length;
  // Scoped to the current turn, so a follow-up doesn't start by showing the previous turn's attempt and clock.
  const attempt = turnAttempts(mod).at(-1);
  const since = attempt?.startedAt || turnsOf(mod).at(-1).at || mod.updatedAt || mod.createdAt;
  const who =
    mod.phase === "playtest" ? "The AI player is testing in-game" : mod.phase === "fix" ? "The fixer is patching the plugin" : `${label} in progress`;
  return (
    <div className="dock">
      <span className="spinner" />
      <span className="dock-text">
        <strong>{who}</strong>
        <small>
          Step {i + 1} of {PHASES.length} · {label}
          {attempt ? ` · attempt ${attempt.n}` : ""}
        </small>
      </span>
      {total > 0 && (
        <span className="dock-checks">
          {done}/{total} checks
        </span>
      )}
      <span className="dock-time">{fmtDuration(now - since)}</span>
    </div>
  );
}

/* ---------- Thread ---------- */

function useFeed(mod) {
  const [feed, setFeed] = React.useState([]);
  const idRef = React.useRef(mod.id);
  idRef.current = mod.id;
  React.useEffect(
    () =>
      on("studio:feed", ({ modId, item }) => {
        if (modId === idRef.current) setFeed((prev) => [...prev.slice(-799), item]);
      }),
    [],
  );
  React.useEffect(() => {
    setFeed([]);
    call("studio:get", { id: mod.id })
      .then((full) => setFeed(full.feed.slice(-800)))
      .catch(() => {});
  }, [mod.id]);
  return feed;
}

// One chat holds every turn of a mod: the opening request, then each change the user asked for. `k` is the chat turn an item belongs to.
function buildThread(mod, feed) {
  const turns = turnsOf(mod);
  const items = [{ type: "user", key: "user", k: 0, text: turns[0].prompt }, { type: "plan", key: "plan", k: 0 }];
  let turn = null;
  let k = 0;
  const handoffs = new Set();
  feed.forEach((f, i) => {
    const key = `${f.at}-${i}`;
    if (f.kind === "session") return;
    if (f.kind === "user") {
      turn = null;
      k = f.turn ?? k + 1;
      items.push({ type: "user", key, k, text: f.text }, { type: "plan", key: `${key}-plan`, k });
      return;
    }
    if (f.role === "benana") {
      turn = null;
      if (f.kind === "phase") items.push({ type: "phase", key, f });
      else if (f.kind === "handoff") {
        handoffs.add(f.attempt);
        items.push({ type: "handoff", key, n: f.attempt });
      } else if (f.kind === "failure" || f.kind === "error") items.push({ type: "alert", key, f });
      else if (f.kind === "assets") items.push({ type: "assets", key, f });
      else if (f.kind === "bench") items.push({ type: "bench", key, f });
      else items.push({ type: "note", key, f });
      return;
    }
    if (f.kind === "plan") {
      items.push({ type: "testplan", key, k, bare: turn?.role === "spec" });
      turn = null;
      return;
    }
    const id = `${f.role}:${f.attempt || 0}`;
    if (!turn || turn.id !== id) {
      // Fixer turns recorded before the handoff was posted to the feed still get their card.
      if (f.role === "fixer" && f.attempt && !handoffs.has(f.attempt) && mod.attempts.some((a) => a.n === f.attempt && a.context)) {
        handoffs.add(f.attempt);
        items.push({ type: "handoff", key: `${key}-handoff`, n: f.attempt });
      }
      turn = { type: "turn", key, id, k, role: f.role, attempt: f.attempt || null, entries: [] };
      items.push(turn);
    }
    turn.entries.push(f);
  });
  if (!feed.some((f) => f.kind === "plan") && mod.testPlan) items.splice(2, 0, { type: "testplan", key: "tp", k: 0 });
  if (!mod.running && ["passed", "failed", "stopped"].includes(mod.status)) items.push({ type: "result", key: "result" });
  return items;
}

function Thread({ mod, onOpenCode }) {
  const feed = useFeed(mod);
  const items = React.useMemo(() => buildThread(mod, feed), [mod, feed]);
  const { ref, onScroll, away, jump } = useStickyScroll(`${items.length}:${feed.length}:${mod.updatedAt}`);
  const lastTurn = [...items].reverse().find((x) => x.type === "turn");

  return (
    <div className="thread" ref={ref} onScroll={onScroll}>
      <div className="thread-inner">
        {items.map((it) => {
          switch (it.type) {
            case "user":
              return (
                <div key={it.key} className="msg-user">
                  <div className="bubble">{it.text}</div>
                </div>
              );
            case "plan":
              return (
                <Turn key={it.key} role="benana" title="Benana" meta="Plan">
                  <p className="prose">
                    {turnsOf(mod)[it.k]?.revision
                      ? "I'll update the spec, change the existing plugin, and have the AI player test it again. This list updates as each step finishes."
                      : "I'll build this as a Paper plugin and test it with an AI player. This list updates as each step finishes."}
                  </p>
                  <PipelineChecklist mod={mod} k={it.k} />
                </Turn>
              );
            case "testplan":
              return <TestPlanChecklist key={it.key} mod={mod} k={it.k} bare={it.bare} />;
            case "phase":
              return <PhaseLine key={it.key} f={it.f} mod={mod} />;
            case "note":
              return (
                <div key={it.key} className={`note-line ${/Entire checkpoint/.test(it.f.text) ? "entire" : ""}`}>
                  <Icon name="info" size={13} />
                  <span>{it.f.text}</span>
                </div>
              );
            case "alert":
              return (
                <div key={it.key} className="alert-card">
                  <CheckIcon status="fail" />
                  <div>
                    <strong>{it.f.kind === "error" ? "Run error" : `Attempt ${it.f.attempt} failed`}</strong>
                    <p>{it.f.text.replace(/^Attempt \d+ failed \(\w+\): /, "")}</p>
                  </div>
                </div>
              );
            case "handoff":
              return <HandoffCard key={it.key} mod={mod} n={it.n} />;
            case "assets":
              return <AssetCard key={it.key} f={it.f} />;
            case "bench":
              return <BenchCard key={it.key} result={it.f.result} />;
            case "turn":
              return <AgentTurn key={it.key} turn={it} mod={mod} live={mod.running && it === lastTurn} />;
            case "result":
              return <ResultCard key={it.key} mod={mod} onOpenCode={onOpenCode} />;
            default:
              return null;
          }
        })}
      </div>
      {away && (
        <button className="jump" onClick={jump}>
          Jump to latest
        </button>
      )}
    </div>
  );
}

const AVATAR = { benana: "B", spec: "S", builder: "Bu", playtester: "P", fixer: "F", grader: "G", coach: "C" };

// The textures the builder drew this attempt, as the resource pack ships them.
function AssetCard({ f }) {
  return (
    <div className="asset-card">
      <header>
        <Icon name="spark" size={13} />
        <strong>Assets</strong>
        <span>attempt {f.attempt} · {f.items.length} texture{f.items.length === 1 ? "" : "s"} in the resource pack</span>
      </header>
      <div className="asset-tiles">
        {f.items.map((a) => (
          <figure key={a.id} className="asset-tile">
            {a.texture ? <img src={a.texture} alt={a.id} /> : <Icon name="file" size={20} />}
            <span title={a.id}>{a.id}</span>
          </figure>
        ))}
      </div>
      {f.errors?.length > 0 && (
        <ul className="asset-problems">
          {f.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

function BenchCard({ result }) {
  const pct = Math.round((result.passed / Math.max(1, result.total)) * 100);
  return (
    <div className="bench-card">
      <header>
        <Icon name="spark" size={13} />
        <strong>Benchmark score {result.passed}/{result.total}</strong>
        <span>hidden checks the builder never saw</span>
      </header>
      <div className="quality-track"><i style={{ width: `${pct}%` }} /></div>
      <ul className="bench-checks">
        {result.checks.map((c) => (
          <li key={c.id} className={c.status}>
            <CheckIcon status={c.status} />
            <div>
              <strong>{c.title}</strong>
              {c.status !== "pass" && <p>{c.observed}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Turn({ role, title, meta, aside, children }) {
  return (
    <div className="turn">
      <div className="turn-head">
        <span className={`role-avatar ${role}`}>{AVATAR[role] || role[0]?.toUpperCase()}</span>
        <strong>{title}</strong>
        {meta && <span className="meta">{meta}</span>}
        {aside}
      </div>
      <div className="turn-body">{children}</div>
    </div>
  );
}

function sessionFor(mod, role, attemptN, k) {
  if (role === "spec") return mod.sessions.find((s) => s.role === "spec" && (s.turn ?? 0) === k);
  // The benchmark grader and coach run after the attempts, outside any of them.
  if (!attemptN) return mod.sessions.filter((s) => s.role === role && (s.turn ?? 0) === k).at(-1);
  const a = mod.attempts.find((x) => x.n === attemptN);
  return a?.sessions.filter((s) => s.role === role).at(-1);
}

function AgentTurn({ turn, mod, live }) {
  const s = sessionFor(mod, turn.role, turn.attempt, turn.k);
  const [traceOpen, setTraceOpen] = React.useState(false);
  const tracing = Boolean(s && !s.endedAt && mod.running);
  const meta = [
    turn.attempt ? `attempt ${turn.attempt}` : null,
    s?.model ? shortModel(s.model) : null,
    s?.endedAt && s?.startedAt ? fmtDuration(s.endedAt - s.startedAt) : null,
    s?.usage?.costUsd ? fmtMoney(s.usage.costUsd) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const groups = [];
  for (const e of turn.entries) {
    const isWork = e.kind === "tool" || e.kind === "result" || e.kind === "note";
    const last = groups.at(-1);
    if (isWork && last?.work) last.entries.push(e);
    else if (isWork) groups.push({ work: true, entries: [e] });
    else groups.push({ work: false, entries: [e] });
  }

  return (
    <Turn
      role={turn.role}
      title={ROLE[turn.role] || turn.role}
      meta={meta}
      aside={<TraceChip sessionId={s?.sessionId} live={tracing} open={traceOpen} onToggle={() => setTraceOpen((o) => !o)} />}
    >
      {traceOpen && <TraceDrawer sessionId={s?.sessionId} live={tracing} />}
      {groups.map((g, i) =>
        g.work ? (
          <WorkLog key={i} entries={g.entries} mod={mod} live={live && i === groups.length - 1} />
        ) : (
          <Markdown key={i} text={g.entries[0].text} />
        ),
      )}
    </Turn>
  );
}

function parseSummary(summary) {
  if (!summary) return {};
  try {
    return JSON.parse(summary);
  } catch {
    const pick = (k) => summary.match(new RegExp(`"${k}":"([^"]*)"`))?.[1];
    return { id: pick("id"), status: pick("status"), observed: pick("observed"), file_path: pick("file_path"), command: pick("command") };
  }
}

const TOOL_ICON = {
  Read: "file",
  Write: "file",
  Edit: "file",
  MultiEdit: "file",
  Bash: "terminal",
  Grep: "search",
  Glob: "search",
};

function describeArgs(name, summary) {
  const args = parseSummary(summary);
  if (args.file_path) return args.file_path.replace(/\\/g, "/");
  if (args.command) return args.command;
  if (args.pattern) return args.pattern;
  if (typeof args === "object" && args && Object.keys(args).length) {
    return Object.entries(args)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" · ")
      .slice(0, 160);
  }
  return summary || "";
}

function WorkLog({ entries, mod, live }) {
  const rows = entries.filter((e) => e.kind !== "result" || e.isError || e.name !== "report_check");
  const [open, setOpen] = React.useState(false);
  const LIMIT = 4;
  const hidden = !open && rows.length > LIMIT + 1 ? rows.length - LIMIT : 0;
  const shown = hidden ? rows.slice(-LIMIT) : rows;
  const titles = new Map((mod.testPlan?.checks || []).map((c) => [c.id, c.title]));

  return (
    <div className={`worklog ${live ? "live" : ""}`}>
      {hidden > 0 && (
        <button className="worklog-more" onClick={() => setOpen(true)}>
          {hidden} earlier action{hidden === 1 ? "" : "s"}
        </button>
      )}
      {shown.map((e, i) => {
        if (e.kind === "tool" && e.name === "report_check") {
          const a = parseSummary(e.summary);
          return (
            <div key={i} className="work-row check">
              <CheckIcon status={a.status} />
              <span>
                Reported <strong>{titles.get(a.id) || a.id}</strong>
                {a.status ? ` · ${a.status}` : ""}
              </span>
            </div>
          );
        }
        if (e.kind === "tool" && e.name === "finish") {
          return (
            <div key={i} className="work-row check">
              <CheckIcon status="pass" />
              <span>Finished the playtest</span>
            </div>
          );
        }
        if (e.kind === "result") {
          return (
            <div key={i} className={`work-row result ${e.isError ? "error" : ""}`}>
              <span className="work-arrow">↳</span>
              <span className="work-out">{e.text.slice(0, 220)}</span>
            </div>
          );
        }
        if (e.kind === "note") {
          return (
            <div key={i} className="work-row note">
              <Icon name="info" size={13} />
              <span>{e.text}</span>
            </div>
          );
        }
        const isLast = live && i === shown.length - 1;
        return (
          <div key={i} className="work-row">
            {isLast ? <span className="spinner" /> : <Icon name={TOOL_ICON[e.name] || "game"} size={13} />}
            <code>{e.name}</code>
            <span className="work-args">{describeArgs(e.name, e.summary)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PhaseLine({ f, mod }) {
  const current = mod.running && mod.phase === f.phase && phaseIndex(mod) === PHASES.findIndex(([k]) => k === f.phase);
  return (
    <div className={`phase-line ${current ? "current" : ""}`}>
      {current ? <span className="spinner" /> : <CheckIcon status="pass" />}
      <span>{f.text}</span>
    </div>
  );
}

function PipelineChecklist({ mod, k }) {
  const turns = turnsOf(mod);
  const turn = turns[k];
  // Only the latest turn follows the mod's live state; earlier turns keep the result and phase they ended in.
  const live = k === turns.length - 1;
  const status = live ? mod.status : turn.status;
  const current = phaseIndex(live ? mod : { phase: turn.endPhase });
  const passed = status === "passed";
  const failed = ["failed", "stopped"].includes(status);
  const fixSkipped = passed && !turnAttempts(mod, k).some((a) => a.role === "fixer");
  const detail = turn.revision ? { ...STEP_DETAIL, ...REVISION_DETAIL } : STEP_DETAIL;
  const doneCount = PHASES.filter((_, i) => passed || i < current).length;
  return (
    <div className="checklist">
      <div className="checklist-head">
        <strong>{turn.revision ? "Change plan" : "Build plan"}</strong>
        <span className="meta">
          {doneCount}/{PHASES.length}
        </span>
      </div>
      <ul>
        {PHASES.map(([key, label], i) => {
          let state = i < current ? "done" : i === current ? (failed ? "failed" : live && mod.running ? "active" : "done") : "todo";
          if (passed) state = "done";
          if (key === "fix" && fixSkipped) state = "skipped";
          if (key === "repo" && turn.revision) state = "skipped";
          return (
            <li key={key} className={state}>
              <StepIcon state={state} />
              <span className="step-label">{label}</span>
              <span className="step-detail">{state === "skipped" && key === "fix" ? "Not needed, passed first try" : detail[key]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepIcon({ state }) {
  if (state === "active") return <span className="step-icon active"><span className="spinner" /></span>;
  if (state === "done") return <span className="step-icon done"><Icon name="check" size={11} /></span>;
  if (state === "failed") return <span className="step-icon failed"><Icon name="x" size={11} /></span>;
  if (state === "skipped") return <span className="step-icon skipped" />;
  return <span className="step-icon" />;
}

function TestPlanChecklist({ mod, k, bare }) {
  const turns = turnsOf(mod);
  const live = k === turns.length - 1;
  const verdict = latestVerdict(mod, k);
  const byId = new Map((verdict?.checks || []).map((c) => [c.id, c]));
  // Each turn shows the plan it was tested against, not the mod's current one.
  const checks = turns[k].checks || (live ? mod.testPlan?.checks : null) || [];
  const summary = turns[k].summary || (live ? mod.spec?.summary : null);
  const testing = live && mod.running && mod.phase === "playtest";
  const nextId = testing ? checks.find((c) => !byId.has(c.id))?.id : null;
  const passing = checks.filter((c) => byId.get(c.id)?.status === "pass").length;
  if (!checks.length) return null;
  const list = (
      <div className="checklist">
        <div className="checklist-head">
          <strong>Test plan</strong>
          <span className="meta">
            {passing}/{checks.length} passing
          </span>
        </div>
        <ul>
          {checks.map((c) => {
            const r = byId.get(c.id);
            const state = r ? (r.status === "pass" ? "done" : r.status === "fail" ? "failed" : "blocked") : c.id === nextId ? "active" : "todo";
            return (
              <li key={c.id} className={`${state} tall`}>
                {state === "blocked" ? <CheckIcon status="blocked" /> : <StepIcon state={state} />}
                <span className="step-label">{c.title}</span>
                <span className="step-detail">{r?.observed || c.expect}</span>
              </li>
            );
          })}
        </ul>
      </div>
  );
  if (bare) return <div className="turn-cont">{list}</div>;
  return (
    <Turn role="spec" title="Spec agent" meta="Test plan">
      {summary && <p className="prose">{summary}</p>}
      {list}
    </Turn>
  );
}

function ResultCard({ mod, onOpenCode }) {
  const passed = mod.status === "passed";
  const verdict = latestVerdict(mod);
  const checks = verdict?.checks || [];
  // The result is for the latest turn, so count only its attempts.
  const attempts = turnAttempts(mod);
  const lessons = attempts.filter((a) => a.lesson);
  const n = attempts.length;
  return (
    <div className={`result-card ${mod.status}`}>
      <div className="result-top">
        <span className="result-icon">
          <Icon name={passed ? "check" : "x"} size={18} />
        </span>
        <div>
          <strong>
            {passed
              ? `${mod.name} passed every check${n === 1 ? " on the first attempt" : ` after ${n} attempts`}`
              : mod.status === "stopped"
                ? `${mod.name} was stopped`
                : `${mod.name} still fails after ${n} attempt${n === 1 ? "" : "s"}`}
          </strong>
          <p>
            {checks.filter((c) => c.status === "pass").length}/{mod.testPlan?.checks.length || checks.length} checks passing · {n} attempt
            {n === 1 ? "" : "s"} · {fmtMoney(modSpend(mod))}
          </p>
        </div>
      </div>
      {lessons.map((a) => (
        <div key={a.n} className="lesson">
          <span>Lesson from attempt {a.n}</span>
          <p>{a.lesson}</p>
        </div>
      ))}
      {mod.repoDir && (
        <div className="result-actions">
          <button className="btn sm" onClick={() => onOpenCode(mod.id)}>
            <Icon name="code" size={13} />
            Review the code
          </button>
          <button className="btn sm" onClick={() => call("open-path", mod.repoDir)}>
            <Icon name="folder" size={13} />
            Open repository
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Minimal markdown: paragraphs, bullets, **bold**, `code` ---------- */

function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

export function Markdown({ text }) {
  const blocks = String(text || "")
    .replace(/\s+-\s+(?=\*\*)/g, "\n- ")
    .split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const bullets = lines.filter((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
        if (bullets.length && bullets.length === lines.length) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        if (bullets.length && !/^\s*([-*]|\d+\.)\s+/.test(lines[0])) {
          return (
            <React.Fragment key={i}>
              <p>{inline(lines[0])}</p>
              <ul>
                {lines.slice(1).map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>
                ))}
              </ul>
            </React.Fragment>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

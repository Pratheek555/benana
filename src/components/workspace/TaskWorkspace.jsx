import React, { useEffect, useState } from "react";
import { call, on } from "../../api.js";
import Icon from "../Icon.jsx";
import { Badge } from "./ui.jsx";

function Composer({ project, run, session, onStarted, notify }) {
  const [text, setText] = useState("");
  const [agent, setAgent] = useState("claude");
  const [busy, setBusy] = useState(false);
  const failed = run?.status === "failed";
  const active = run && ["preparing", "running", "verifying", "recording"].includes(run.status);
  const send = async () => {
    const task = text.trim();
    if (!task || busy || failed || active) return;
    setBusy(true);
    try {
      let next;
      if (run) next = await call("run:brief", { id: run.id, text: task });
      else if (session)
        next = await call("sessions:resume", {
          kind: session.kind,
          id: session.id,
          cwd: session.cwd,
          brief: task,
        });
      else next = await call("run:start", { task, agent });
      setText("");
      if (next?.id) onStarted(next);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  if (failed) return <div className="composer composer-blocked" aria-disabled="true">Review the recovery changes, then choose Apply and retry. The failed attempt stays available for comparison.</div>;
  return (
    <div className="composer">
      <textarea
        id="task-composer"
        rows="3"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={
          run
            ? failed
              ? "Use Apply and retry above to create a new attempt."
              : active
                ? "Wait for this attempt to finish, or stop it before sending a follow-up."
              : "Add a follow-up instruction..."
            : session
              ? "Resume this session with an instruction..."
              : `Describe the bug in ${project.name || "this repository"}: symptom, expected behavior, and reproduction.`
        }
        disabled={failed || active}
      />
      <div className="composer-row">
        {!run && !session && (
          <label className="agent-select">
            <span>Run with</span>
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
        )}
        <span className="key-hint">
          {failed
            ? "Failed attempts stay immutable. Retry from the recovery card."
            : active
              ? "This attempt is active. Stop it before changing the brief."
            : "Enter to send | Shift + Enter for a new line"}
        </span>
        <button
          aria-label="Send task"
          onClick={send}
          disabled={!text.trim() || busy || failed || active}
        >
          <Icon name="send" />
          {busy ? "Starting..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function FailureCard({ run, onRetry, busy }) {
  const f = run.failure;
  if (!f) return null;
  return (
    <section className="failure-card">
      <div className="failure-head">
        <span className="failure-icon">!</span>
        <div>
          <Badge tone={f.kind === "verification" ? "pink" : "violet"}>
            {f.kind} failure
          </Badge>
          <h3>{f.title}</h3>
          <p>{f.detail}</p>
        </div>
      </div>
      <div className="evidence-list">
        {(f.evidence || []).map((e, i) => (
          <div key={i}>
            <span>
              {e.label}
              <Badge tone={e.source === "neatlogs" ? "pink" : ""}>
                {e.source === "neatlogs" ? "Neatlogs" : "Local"}
              </Badge>
            </span>
            <code>{e.text}</code>
            {e.traceId && <small>Linked trace {e.traceId}</small>}
          </div>
        ))}
      </div>
      {run.recovery && (
        <div className="recovery">
          <h4>{run.recovery.title}</h4>
          <p>{run.recovery.diagnosis}</p>
          {run.recovery.changes?.map((c, i) => (
            <div className="change-preview" key={i}>
              <strong>{c.label}</strong>
              <div className="before">{c.before}</div>
              <div className="after">{c.after}</div>
            </div>
          ))}
          <div className="instruction">
            <span>Exact agent instruction</span>
            {run.recovery.prompt}
          </div>
          {run.recovery.canRetry ? (
            <button
              className="primary"
              disabled={busy || run.status !== "failed"}
              onClick={() => onRetry(run)}
            >
              {busy ? "Creating attempt..." : "Apply and retry"}
            </button>
          ) : (
            <p className="blocked">{run.recovery.blockReason}</p>
          )}
        </div>
      )}
    </section>
  );
}

export default function TaskWorkspace({
  project,
  run,
  runs,
  session,
  onStarted,
  notify,
}) {
  const [lines, setLines] = useState([]);
  const [retrying, setRetrying] = useState(false);
  const runId = run?.id;
  useEffect(() => {
    setLines([]);
    if (runId) {
      call("run:get", { id: runId })
        .then((r) => setLines(r?.transcript || []))
        .catch(() => {});
      return on(
        "transcript",
        ({ id, line }) => id === runId && setLines((x) => [...x, line]),
      );
    }
    if (session) {
      const load = () =>
        call("sessions:transcript", { kind: session.kind, id: session.id })
          .then(setLines)
          .catch(() => {});
      load();
      const timer = setInterval(load, 3000);
      return () => clearInterval(timer);
    }
  }, [runId, session?.id]);
  const retry = async (old) => {
    setRetrying(true);
    try {
      onStarted(
        await call("run:retry", { id: old.id, recoveryId: old.recovery.id }),
      );
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setRetrying(false);
    }
  };
  if (!run && !session)
    return (
      <main className="conversation welcome">
        <div className="welcome-copy">
          <Badge tone="violet">{project.repo}</Badge>
          <h1>What needs fixing?</h1>
          <p>
            Start with the outcome. Benana supplies repository context, keeps
            every attempt, and checks the result before it calls the work
            complete.
          </p>
          <div className="suggestions">
            <button
              onClick={() => document.getElementById("task-composer")?.focus()}
            >
              Fix a bug <Icon name="chevron" />
            </button>
            <button
              onClick={() => document.getElementById("task-composer")?.focus()}
            >
              Investigate a failure <Icon name="chevron" />
            </button>
          </div>
        </div>
        <Composer project={project} onStarted={onStarted} notify={notify} />
      </main>
    );
  return (
    <main className="conversation">
      <header className="conversation-head">
        <div>
          <span className="eyebrow">
            {session ? "Attached session" : `Attempt ${run.attempt || 1}`}
          </span>
          <h1>{run?.task || session?.title || "Agent session"}</h1>
        </div>
        {run && (
          <div className="run-actions">
            <Badge
              tone={
                run.status === "passed"
                  ? "green"
                  : run.status === "failed"
                    ? "pink"
                    : "violet"
              }
            >
              {{
                preparing: "Preparing",
                running: "Running",
                verifying: "Verifying",
                recording: "Saving checkpoint",
                passed: "Passed",
                failed: "Failed",
                stopped: "Stopped",
              }[run.status] || run.status}
            </Badge>
            {["running", "preparing", "verifying", "recording"].includes(run.status) && (
              <button
                onClick={() =>
                  call("run:stop", { id: run.id }).catch((error) =>
                    notify(error.message, "error"),
                  )
                }
              >
                Stop
              </button>
            )}
          </div>
        )}
      </header>
      {run &&
        (() => {
          const root = run.rootId || run.id;
          const attempts = runs
            .filter((item) => (item.rootId || item.id) === root)
            .sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
          return attempts.length > 1 ? (
            <div className="attempt-timeline">
              <span>Attempts</span>
              {attempts.map((item) => (
                <button
                  key={item.id}
                  className={item.id === run.id ? "active" : ""}
                  onClick={() => onStarted(item)}
                >
                  #{item.attempt || 1} {item.status}
                  {item.retryOf ? " retry" : ""}
                </button>
              ))}
            </div>
          ) : null;
        })()}
      <div className="messages">
        {session && <div className="notice">Resuming uses this session's existing checkout and can edit files there.<code>{session.cwd}</code>Choose New task to work in an isolated worktree.</div>}
        {run?.origin === "resumed" && <div className="notice">This resumed session works directly in its original checkout.<code>{run.worktree}</code></div>}
        {lines.map((line, i) => (
          <article key={i} className={`message ${line.role}`}>
            <div className="avatar">
              {["user", "you"].includes(line.role)
                ? "Y"
                : line.role === "agent"
                  ? "A"
                  : line.role === "system"
                    ? "S"
                    : "."}
            </div>
            <div>
              <span className="message-role">
                {["user", "you"].includes(line.role)
                  ? "You"
                  : line.role === "agent"
                    ? (run?.kind || run?.agent) === "codex"
                      ? "Codex"
                      : "Claude Code"
                    : line.role === "system"
                      ? "System"
                      : "Tool step"}
              </span>
              {line.role === "tool" ? (
                <details>
                  <summary>{line.text}</summary>
                  <code>{line.text}</code>
                </details>
              ) : (
                <p>{line.text}</p>
              )}
            </div>
          </article>
        ))}
        {run && <FailureCard run={run} onRetry={retry} busy={retrying} />}{" "}
        {run?.status === "passed" &&
          run.verify?.at(-1)?.results?.length > 0 &&
          run.verify.at(-1).results.every((result) => result.pass) && (
            <div className="success-card">
              <Icon name="check" />
              <div>
                <strong>Verified</strong>
                <p>
                  Every configured repository check passed for this attempt.
                </p>
              </div>
            </div>
          )}
      </div>
      <Composer
        project={project}
        run={run}
        session={session}
        onStarted={onStarted}
        notify={notify}
      />
    </main>
  );
}

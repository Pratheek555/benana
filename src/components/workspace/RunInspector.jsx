import React, { useEffect, useState } from "react";
import { call } from "../../api.js";
import Icon from "../Icon.jsx";
import { Badge } from "./ui.jsx";

export function Checks({ run, project, notify = () => {} }) {
  const saved = project.harness?.graders?.testCommand || "";
  const [testCommand, setTestCommand] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setTestCommand(saved), [saved]);
  const results = run.verify?.at(-1)?.results || [];
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await call("harness:update", {
        graders: { testCommand: testCommand.trim() },
      });
      notify("Test command saved");
    } catch (cause) {
      setError(cause.message);
      notify(cause.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>Repository checks</h3>
      {results.map((item) => (
        <div className="check-row" key={item.grader}>
          <span className={item.pass ? "pass" : "fail"}>
            <Icon name={item.pass ? "check" : "close"} />
          </span>
          <div>
            <strong>{item.grader}</strong>
            <small>{item.detail}</small>
          </div>
        </div>
      ))}
      {!results.length && (
        <div className="plain-card">Checks have not run for this attempt.</div>
      )}
      <h3>Grader settings</h3>
      <label className="setting">
        <span>Test command</span>
        <input
          value={testCommand}
          onChange={(event) => setTestCommand(event.target.value)}
          placeholder="Required to verify"
        />
      </label>
      <button
        className="primary save-setting"
        disabled={busy || testCommand === saved}
        onClick={save}
      >
        {busy ? "Saving..." : "Save test command"}
      </button>
      {error && <div className="notice error">{error}</div>}
      {!testCommand && (
        <div className="notice error">
          A missing test command cannot produce a verified result.
        </div>
      )}
    </>
  );
}

function TraceEvidence({ evidence }) {
  if (!evidence)
    return <div className="plain-card">Loading linked evidence...</div>;
  if (evidence.error)
    return <div className="notice error">{evidence.error}</div>;
  if (!evidence.configured)
    return <div className="plain-card">Neatlogs is not configured.</div>;
  if (!evidence.matched)
    return <div className="plain-card">No linked trace matches this run.</div>;
  const traces =
    evidence.traces ||
    (evidence.traceId || evidence.traceName ? [evidence] : []);
  return (
    <div className="evidence-stack">
      {evidence.spanError && (
        <div className="notice error">
          {evidence.spanError.message || String(evidence.spanError)}
        </div>
      )}
      {traces.map((trace, index) => (
        <details
          className="trace-card"
          key={trace.traceId || trace.id || index}
          open={index === 0}
        >
          <summary>
            <Badge tone="pink">Neatlogs</Badge>
            <strong>
              {trace.traceName ||
                trace.name ||
                trace.traceId ||
                trace.id ||
                "Linked trace"}
            </strong>
          </summary>
          {(trace.traceId || trace.id) && (
            <code>{trace.traceId || trace.id}</code>
          )}
          <div className="trace-meta">
            {trace.status && <span>Status {trace.status}</span>}
            {trace.durationMs != null && (
              <span>Duration {trace.durationMs} ms</span>
            )}
          </div>
          {(trace.summary || trace.failure || trace.error) && (
            <p>{trace.summary || trace.failure || trace.error}</p>
          )}
          {trace.spansError && <div className="notice error">Span evidence unavailable. {trace.spansError}</div>}
          {trace.spans?.map((span, spanIndex) => (
            <details
              className="span-row"
              key={span.spanId || span.id || spanIndex}
            >
              <summary>
                <strong>
                  {span.spanName || span.name || span.operation || "Span"}
                </strong>
                <span>{span.status || "recorded"}</span>
              </summary>
              {(span.spanId || span.id) && (
                <code>{span.spanId || span.id}</code>
              )}
              {span.durationMs != null && <small>{span.durationMs} ms</small>}
              {(span.failure || span.error || span.summary) && (
                <p>{span.failure || span.error || span.summary}</p>
              )}
            </details>
          ))}
          {evidence.matchReason && <small>{evidence.matchReason}</small>}
        </details>
      ))}
    </div>
  );
}

export default function RunInspector({ run, project, integrations, notify }) {
  const [tab, setTab] = useState("context");
  const [diff, setDiff] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [opening, setOpening] = useState(false);
  const refreshKey = `${run?.id || ""}:${run?.status || ""}:${run?.sessionId || ""}:${(run?.filesChanged || run?.files || []).join("|")}`;
  useEffect(() => {
    let live = true;
    setDiff(null);
    setEvidence(null);
    if (run) {
      call("run:diff", { id: run.id })
        .then((value) => live && setDiff(value))
        .catch((error) => live && setDiff({ error: error.message }));
      call("neatlogs:evidence", { id: run.id, sessionId: run.sessionId })
        .then((value) => live && setEvidence(value))
        .catch(
          (error) =>
            live &&
            setEvidence({
              configured: Boolean(integrations?.neatlogs?.configured),
              error: error.message,
            }),
        );
    }
    return () => {
      live = false;
    };
  }, [refreshKey]);
  const context = run?.contextBundle;
  const entireReady = Boolean(
    integrations?.entire?.installed && integrations?.entire?.enabled,
  );
  const neatReady = Boolean(
    integrations?.neatlogs?.configured && integrations?.neatlogs?.ok,
  );
  const githubReady = Boolean(integrations?.artifacts?.configured);
  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {["context", "changes", "checks"].map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {!run ? (
          <div className="empty-state">
            <Icon name="file" size={22} />
            <strong>Run details</strong>
            <p>
              Select a run to inspect its supplied context, worktree changes,
              and checks.
            </p>
          </div>
        ) : tab === "context" ? (
          <>
            <h3>Context supplied</h3>
            <p className="section-note">
              These exact items were sent to the agent.
            </p>
            {context?.error && (
              <div className="notice error">{context.error}</div>
            )}
            {context?.errors?.map((error, index) => (
              <div className="notice error" key={error.id || index}>
                {error.message || error.text || String(error)}
              </div>
            ))}
            {context?.entries?.length ? (
              context.entries.map((entry, index) => (
                <div className="context-card" key={entry.id || index}>
                  <div>
                    <strong>
                      {entry.title ||
                        entry.summary ||
                        entry.id ||
                        "Untitled context"}
                    </strong>
                    <Badge
                      tone={
                        entry.source === "entire" || entry.provider === "entire"
                          ? "green"
                          : "violet"
                      }
                    >
                      {entry.source === "entire" || entry.provider === "entire"
                        ? "Entire"
                        : entry.source || entry.provider || "Repository"}
                    </Badge>
                  </div>
                  {entry.summary && <p>{entry.summary}</p>}
                  {entry.reason && <small>Why | {entry.reason}</small>}
                </div>
              ))
            ) : (
              <div className="empty-state">
                <p>No context entries were recorded for this run.</p>
              </div>
            )}
            <h3>Evidence source</h3>
            <TraceEvidence evidence={evidence} />
          </>
        ) : tab === "changes" ? (
          <>
            <h3>Changed files</h3>
            {diff?.error && <div className="notice error">{diff.error}</div>}
            {diff?.files?.map((file) => (
              <div className="file-row" key={file}>
                <Icon name="file" />
                <span>{file}</span>
              </div>
            ))}
            <pre className="diff">{diff?.diff || "No diff is available."}</pre>
            {run.worktree && (
              <div className="plain-card worktree-card">
                <span>{run.origin === "resumed" ? "These changes are in the resumed session's original checkout." : "Review these changes in the run worktree."}</span>
                <code>{run.worktree}</code>
                <button
                  disabled={opening}
                  onClick={async () => {
                    setOpening(true);
                    try {
                      const message = await call("open-path", run.worktree);
                      if (message) throw new Error(message);
                    } catch (error) {
                      notify(error.message, "error");
                    } finally {
                      setOpening(false);
                    }
                  }}
                >
                  {opening ? "Opening..." : run.origin === "resumed" ? "Open checkout" : "Open worktree"}
                </button>
              </div>
            )}
          </>
        ) : (
          <Checks run={run} project={project} notify={notify} />
        )}
      </div>
      <div className="integration-row">
        <span>
          <i className={entireReady ? "ok" : ""} />
          Entire
        </span>
        <span>
          <i className={neatReady ? "pink" : ""} />
          Neatlogs
        </span>
        <span>
          <i className={githubReady ? "ok" : ""} />
          Artifacts
        </span>
      </div>
    </aside>
  );
}

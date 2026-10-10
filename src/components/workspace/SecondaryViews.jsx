import React, { useEffect, useState } from "react";
import { call } from "../../api.js";
import { Badge } from "./ui.jsx";

function PatchPreview({ patch }) {
  if (
    !patch ||
    (!patch.addRules?.length && !Object.keys(patch.graders || {}).length)
  )
    return (
      <div className="plain-card">This proposal has no patch content.</div>
    );
  return (
    <div className="patch-preview">
      {patch.addRules?.map((rule) => (
        <code key={rule}>+ rule: {rule}</code>
      ))}
      {Object.entries(patch.graders || {}).map(([key, value]) => (
        <code key={key}>
          grader.{key}: {String(value)}
        </code>
      ))}
    </div>
  );
}

export function SecondaryView({
  route,
  inbox,
  proposals,
  notify,
  setConnect,
  onStarted,
  refresh,
  integrations,
}) {
  const [busy, setBusy] = useState(null);
  const act = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      await refresh();
      if (success) notify(success);
      return result;
    } catch (error) {
      notify(error.message, "error");
      return null;
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="page">
      <header>
        <h1>{route[0].toUpperCase() + route.slice(1)}</h1>
        <p>
          {route === "inbox"
            ? "GitHub issues ready for agent work. Issues with benana:auto may start automatically during polling."
            : route === "connections"
              ? "Repository context, execution evidence, and local agent connections."
              : "Review the exact harness patch before applying it."}
        </p>
      </header>
      <div className="card-list">
        {route === "connections" && <>
          <article><Badge tone="green">Entire</Badge><h3>Repository context and history</h3><p>{integrations?.entire?.enabled ? "Enabled for this repository." : integrations?.entire?.error || "Enable Entire in your local repository to supply context and retain checkpoints."}</p><p>The relationship graph requires the Entire Graph plugin. Checkpoints and sessions remain separate records.</p><button onClick={() => call("open-external", "https://docs.entire.io/quickstart").catch(error => notify(error.message, "error"))}>Entire setup</button></article>
          <article><Badge tone="pink">Neatlogs</Badge><h3>Linked execution evidence</h3><p>{integrations?.neatlogs?.configured ? integrations.neatlogs.error || "The read API is configured." : "Configure the Neatlogs read API to inspect execution traces."}</p><p>Agent hooks or plugins must also send telemetry. Only traces matching the selected agent session appear as its evidence.</p><button onClick={() => call("open-external", "https://docs.neatlogs.com/docs").catch(error => notify(error.message, "error"))}>Neatlogs setup</button></article>
          <article><h3>Claude Code and Codex</h3><p>Review the configuration changes before connecting the Benana intent tools to local coding agents.</p><button className="primary" onClick={() => setConnect(true)}>Connect local agents</button></article>
        </>}
        {route === "improvements" && (
          <button
            className="analyze"
            disabled={busy === "analyze"}
            onClick={() =>
              act(
                "analyze",
                () => call("improve:analyze", {}),
                "Run analysis complete",
              )
            }
          >
            {busy === "analyze" ? "Analyzing..." : "Analyze recent runs"}
          </button>
        )}
        {(route === "inbox" ? inbox : route === "improvements" ? proposals : []).map((item) => (
          <article key={item.id || item.number}>
            <Badge
              tone={
                route === "inbox"
                  ? "violet"
                  : item.status === "approved"
                    ? "green"
                    : "pink"
              }
            >
              {route === "inbox" ? `Issue #${item.number}` : item.status}
            </Badge>
            <h3>{item.title || `Proposal ${item.id}`}</h3>
            <p>
              {item.rationale ||
                item.labels?.join(" | ") ||
                "No description was provided."}
            </p>
            {route === "inbox" && (
              <div className="row-actions">
                <button
                  className="primary"
                  disabled={item.state === "started" || busy === item.number}
                  onClick={async () => {
                    const started = await act(item.number, () =>
                      call("run:start", {
                        issueNumber: item.number,
                        task: `Resolve issue #${item.number}: ${item.title}`,
                      }),
                    );
                    if (started) onStarted(started);
                  }}
                >
                  {item.state === "started"
                    ? "Started"
                    : busy === item.number
                      ? "Starting..."
                      : "Start"}
                </button>
                {item.labels?.includes("benana:auto") && (
                  <Badge tone="green">Auto-start</Badge>
                )}
              </div>
            )}
            {route === "improvements" && <PatchPreview patch={item.patch} />}
            {route === "improvements" && item.evidence && (
              <small>
                {item.evidence.runs || 0} completed runs |{" "}
                {item.evidence.retries || 0} retries |{" "}
                {item.evidence.neatlogsTraces || 0} traces
              </small>
            )}
            {route === "improvements" && item.status === "open" && (
              <div className="row-actions">
                <button
                  className="primary"
                  disabled={busy === item.id}
                  onClick={() =>
                    act(
                      item.id,
                      () =>
                        call("improve:decide", { id: item.id, approve: true }),
                      "Improvement approved",
                    )
                  }
                >
                  Approve
                </button>
                <button
                  disabled={busy === item.id}
                  onClick={() =>
                    act(
                      item.id,
                      () =>
                        call("improve:decide", { id: item.id, approve: false }),
                      "Improvement rejected",
                    )
                  }
                >
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
        {route !== "connections" &&
          !(route === "inbox" ? inbox : proposals).length && (
            <div className="plain-card">No items are available.</div>
          )}
      </div>
    </main>
  );
}

export function RuntimeSetup() {
  return (
    <div className="runtime">
      <div className="runtime-card">
        <span className="brand">B</span>
        <h1>Open Benana in the desktop app</h1>
        <p>
          The renderer cannot reach repositories or local agents without the
          Electron bridge.
        </p>
        <a className="primary" href="?demo=1">
          Explore demo sample
        </a>
        <small>
          The demo uses labelled sample data and never starts a live agent.
        </small>
      </div>
    </div>
  );
}

export function ProjectSetup({ onOpen }) {
  const [repo, setRepo] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="runtime">
      <div className="runtime-card project-setup">
        <span className="brand">B</span>
        <h1>Open a repository</h1>
        <p>
          Connect a GitHub repository and its local checkout. Intent ingestion
          stays optional after the project opens.
        </p>
        <label>
          GitHub repository
          <input
            value={repo}
            onChange={(event) => {
              setRepo(event.target.value);
              setError("");
            }}
            placeholder="owner/repository or https://github.com/owner/repository"
          />
        </label>
        <label>
          Local checkout
          <div className="path-input">
            <input
              value={repoPath}
              onChange={(event) => {
                setRepoPath(event.target.value);
                setError("");
              }}
              placeholder="Path to your clone"
            />
            <button
              onClick={async () => {
                setError("");
                try {
                  setRepoPath((await call("project:pick-path")) || repoPath);
                } catch (browseError) {
                  setError(browseError.message);
                }
              }}
            >
              Browse
            </button>
          </div>
        </label>
        {error && (
          <p className="setup-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={!repo.trim() || busy}
          onClick={async () => {
            setError("");
            setBusy(true);
            try {
              onOpen(await call("project:open", { repo, repoPath }));
            } catch (openError) {
              setError(openError.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening..." : "Open project"}
        </button>
      </div>
    </div>
  );
}

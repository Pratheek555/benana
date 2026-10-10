import React from "react";
import { call, ago } from "../../api.js";
import { Empty, Pill, ROLE, shortSha } from "./shared.jsx";

const pick = (c, ...keys) => keys.map((k) => c?.[k]).find((v) => v != null && v !== "") ?? "";

export default function EntirePage({ mods, onOpenMod }) {
  const repos = mods.filter((m) => m.repoDir);
  const [selectedId, setLocalId] = React.useState(null);
  const mod = repos.find((m) => m.id === selectedId) || repos[0] || null;
  const [cps, setCps] = React.useState(null);

  React.useEffect(() => {
    setCps(null);
    if (!mod) return;
    call("studio:checkpoints", { id: mod.id }).then(setCps).catch((e) => setCps({ ok: false, items: [], error: e.message }));
  }, [mod?.id, mod?.attempts.length]);

  const commits = mod
    ? mod.attempts.flatMap((a) =>
        [
          a.commit?.sha && {
            sha: a.commit.sha,
            checkpoint: a.commit.checkpoint,
            label: `Attempt ${a.n} · ${a.role === "seeded" ? "Seeded" : ROLE[a.role]}`,
            ok: !a.failure || a.failure.kind !== "build",
          },
          a.playtestCommit?.sha && {
            sha: a.playtestCommit.sha,
            checkpoint: a.playtestCommit.checkpoint,
            label: `Playtest ${a.n} · ${a.verdict?.passed ? "pass" : "fail"}`,
            ok: Boolean(a.verdict?.passed),
          },
        ].filter(Boolean),
      )
    : [];
  const linked = commits.filter((c) => c.checkpoint).length;
  const entireOn = repos.some((m) => m.partners?.entire?.enabled);

  if (!repos.length) return <Empty>No mod repositories yet. Each mod gets a git repository with Entire enabled.</Empty>;

  return (
    <div className="entire">
      <section className="card connect">
        <div>
          <span className={`status-dot ${entireOn ? "running" : "failed"}`} />
          <strong>{entireOn ? "Entire is enabled in mod repositories" : "Entire is not set up"}</strong>
        </div>
        <p className="muted-line">
          Each agent commit carries an Entire-Checkpoint trailer. The fixer reads these checkpoints before it changes the plugin.
        </p>
      </section>

      <div className="split">
        <section className="card repo-list">
          <div className="section-head">
            <h4>Mod repositories</h4>
            <span className="count">{repos.length}</span>
          </div>
          {repos.map((m) => (
            <button key={m.id} className={`repo-pick ${m.id === mod?.id ? "active" : ""}`} onClick={() => setLocalId(m.id)}>
              <span>
                <strong>{m.name}</strong>
                <small>
                  {m.attempts.filter((a) => a.commit?.sha).length} commits · {ago(m.createdAt)} ago
                </small>
              </span>
              <span className={`tag ${m.partners?.entire?.enabled ? "entire" : "off"}`}>
                {m.partners?.entire?.enabled ? "Entire" : "Off"}
              </span>
            </button>
          ))}
        </section>

        <section className="card">
          {mod && (
            <>
              <div className="section-head">
                <div>
                  <h4>{mod.name}</h4>
                  <p className="muted-line">
                    {linked} of {commits.length} commits linked to a checkpoint
                  </p>
                </div>
                <div className="head-actions">
                  <Pill status={mod.status} />
                  <button className="btn-ghost" onClick={() => call("open-path", mod.repoDir)}>
                    Open repository
                  </button>
                  <button className="link" onClick={() => onOpenMod(mod.id)}>
                    Open mod
                  </button>
                </div>
              </div>

              <h4 className="sub-h">Commit timeline</h4>
              <ol className="commit-timeline">
                {commits.map((c) => (
                  <li key={c.sha} className={c.ok ? "" : "bad"}>
                    <span className="node" />
                    <div>
                      <strong>{c.label}</strong>
                      <div className="chip-row">
                        <span className="chip mono">{shortSha(c.sha)}</span>
                        {c.checkpoint ? (
                          <span className="tag entire mono">{c.checkpoint.slice(0, 12)}</span>
                        ) : (
                          <span className="tag off">No checkpoint</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
                {!commits.length && <Empty>Commits appear here as each attempt finishes.</Empty>}
              </ol>

              <h4 className="sub-h">Checkpoints in this repository</h4>
              {!cps && <Empty>Loading checkpoints…</Empty>}
              {cps && !cps.ok && <div className="studio-error">{cps.error || "Entire could not list checkpoints."}</div>}
              {cps?.ok && cps.items.length === 0 && <Empty>No checkpoints yet.</Empty>}
              {cps?.ok && cps.items.length > 0 && (
                <table className="plain-table">
                  <thead>
                    <tr>
                      <th>Checkpoint</th>
                      <th>Message</th>
                      <th>Session</th>
                      <th>Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cps.items.map((c, i) => (
                      <tr key={pick(c, "checkpoint_id", "id") || i}>
                        <td className="mono">{String(pick(c, "checkpoint_id", "checkpointId", "id")).slice(0, 14)}</td>
                        <td>{pick(c, "message", "title", "summary")}</td>
                        <td className="mono">{String(pick(c, "session_id", "sessionId")).slice(0, 14)}</td>
                        <td>{pick(c, "agent")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

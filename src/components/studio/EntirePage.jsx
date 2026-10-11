import React from "react";
import { call, ago } from "../../api.js";
import { Empty, Icon, PageHead, ROLE, SectionHead, Status, shortSha } from "./shared.jsx";

const pick = (c, ...keys) => keys.map((k) => c?.[k]).find((v) => v != null && v !== "") ?? "";

export default function EntirePage({ mods, onOpenMod }) {
  const repos = mods.filter((m) => m.repoDir);
  const [selectedId, setLocalId] = React.useState(null);
  const mod = repos.find((m) => m.id === selectedId) || repos[0] || null;
  const [cps, setCps] = React.useState(null);

  React.useEffect(() => {
    setCps(null);
    if (!mod) return;
    call("studio:checkpoints", { id: mod.id })
      .then(setCps)
      .catch((e) => setCps({ ok: false, items: [], error: e.message }));
  }, [mod?.id, mod?.attempts.length]);

  const commits = mod
    ? mod.attempts.flatMap((a) =>
        [
          a.commit?.sha && {
            sha: a.commit.sha,
            checkpoint: a.commit.checkpoint,
            label: `Attempt ${a.n}`,
            role: a.role === "seeded" ? "Seeded fixture" : ROLE[a.role],
            ok: !a.failure || a.failure.kind !== "build",
          },
          a.playtestCommit?.sha && {
            sha: a.playtestCommit.sha,
            checkpoint: a.playtestCommit.checkpoint,
            label: `Playtest ${a.n}`,
            role: a.verdict?.passed ? "Checks passed" : "Checks failed",
            ok: Boolean(a.verdict?.passed),
          },
        ].filter(Boolean),
      )
    : [];
  const linked = commits.filter((c) => c.checkpoint).length;
  const entireOn = repos.some((m) => m.partners?.entire?.enabled);

  return (
    <div className="view">
      <PageHead title="Entire" sub="Each agent commit, linked to the checkpoint of the session that wrote it." />

      <div className="connection">
        <span className={`dot ${entireOn ? "passed" : "idle"}`} />
        <strong>{entireOn ? "Enabled in mod repositories" : repos.length ? "Not set up" : "No repositories yet"}</strong>
        <span className="meta">
          Every agent commit carries an Entire-Checkpoint trailer. The fixer reads these checkpoints before it changes the plugin.
        </span>
      </div>

      {!repos.length ? (
        <section className="panel pad">
          <Empty>No mod repositories yet. Each mod gets its own git repository with Entire enabled.</Empty>
        </section>
      ) : (
        <div className="split entire-split">
          <section className="panel">
            <div className="panel-head">
              <SectionHead title="Repositories" count={repos.length} />
            </div>
            <div className="list">
              {repos.map((m) => {
                const n = m.attempts.reduce((k, a) => k + (a.commit?.sha ? 1 : 0) + (a.playtestCommit?.sha ? 1 : 0), 0);
                return (
                  <button key={m.id} className={`list-row ${m.id === mod?.id ? "active" : ""}`} onClick={() => setLocalId(m.id)}>
                    <span className="list-main">
                      <strong>{m.name}</strong>
                      <small>
                        {n} commit{n === 1 ? "" : "s"} · {ago(m.createdAt)} ago
                      </small>
                    </span>
                    <span className={`partner-dot entire ${m.partners?.entire?.enabled ? "" : "off"}`} title={m.partners?.entire?.enabled ? "Entire enabled" : "Entire off"} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel pad">
            {mod && (
              <>
                <header className="detail-head">
                  <div className="detail-title">
                    <div className="run-name">
                      <h2>{mod.name}</h2>
                      <Status status={mod.running ? "running" : mod.status} />
                    </div>
                    <p>
                      {linked} of {commits.length} commits linked to a checkpoint
                    </p>
                  </div>
                  <div className="page-actions">
                    <button className="btn" onClick={() => onOpenMod(mod.id)}>
                      <Icon name="code" size={14} />
                      Open mod
                    </button>
                    <button className="btn" onClick={() => call("open-path", mod.repoDir)}>
                      <Icon name="folder" size={14} />
                      Repository
                    </button>
                  </div>
                </header>

                <section className="block">
                  <SectionHead title="Commit history" count={commits.length} />
                  <ol className="commits">
                    {commits.map((c) => (
                      <li key={c.sha} className={c.ok ? "ok" : "bad"}>
                        <span className="commit-node" />
                        <div className="commit-main">
                          <strong>{c.label}</strong>
                          <span className="meta">{c.role}</span>
                        </div>
                        <code className="sha static">{shortSha(c.sha)}</code>
                        {c.checkpoint ? (
                          <span className="partner-link static entire">
                            <i />
                            {c.checkpoint.slice(0, 12)}
                          </span>
                        ) : (
                          <span className="muted">No checkpoint</span>
                        )}
                      </li>
                    ))}
                    {!commits.length && <Empty>Commits appear here as each attempt finishes.</Empty>}
                  </ol>
                </section>

                <section className="block">
                  <SectionHead title="Checkpoints in this repository" count={cps?.ok ? cps.items.length : null} />
                  {!cps && <Empty>Loading checkpoints…</Empty>}
                  {cps && !cps.ok && <div className="alert">{cps.error || "Entire could not list checkpoints."}</div>}
                  {cps?.ok && cps.items.length === 0 && <Empty>No checkpoints yet.</Empty>}
                  {cps?.ok && cps.items.length > 0 && (
                    <table className="table">
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
                            <td className="mono">{String(pick(c, "checkpoint_id", "checkpointId", "id")).slice(0, 12)}</td>
                            <td>{pick(c, "message", "title", "summary")}</td>
                            <td className="mono muted">{String(pick(c, "session_id", "sessionId")).slice(0, 14)}</td>
                            <td>{pick(c, "agent")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

import React from "react";
import { call, ago } from "../../api.js";
import { AttemptTimeline, Empty, PartnerStatus, Pill, PlanChecks, allSessions, fmtMoney, modSpend } from "./shared.jsx";
import CodeView from "./CodeView.jsx";

const FILTERS = [
  ["all", "All"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["running", "Running"],
];

export default function ModsPage({ mods, mod, setSelectedId, onBuild }) {
  const [filter, setFilter] = React.useState("all");
  const [tab, setTab] = React.useState("overview");
  const [commit, setCommit] = React.useState(null);
  const shown = mods.filter((m) => filter === "all" || (filter === "running" ? m.running : m.status === filter));

  const openCommit = (attempt) => {
    setCommit(attempt.commit.sha);
    setTab("code");
  };

  return (
    <div className="mods">
      <section className="card mods-list">
        <div className="segmented" role="tablist">
          {FILTERS.map(([key, label]) => (
            <button key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
              {label}
              <span>{key === "all" ? mods.length : mods.filter((m) => (key === "running" ? m.running : m.status === key)).length}</span>
            </button>
          ))}
        </div>
        <table className="mod-table">
          <thead>
            <tr>
              <th>Mod</th>
              <th>Status</th>
              <th className="num">Attempts</th>
              <th className="num">Spend</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id} className={m.id === mod?.id ? "selected" : ""} onClick={() => setSelectedId(m.id)}>
                <td>
                  <strong>{m.name}</strong>
                  <small>
                    {ago(m.createdAt)} ago{m.seed ? " · seeded" : ""}
                  </small>
                </td>
                <td>
                  <Pill status={m.status} />
                </td>
                <td className="num">{m.attempts.length}</td>
                <td className="num">{fmtMoney(modSpend(m))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <div className="empty-action">
            <Empty>{mods.length ? "No mods match this filter." : "No mods yet."}</Empty>
            {!mods.length && (
              <button className="btn-primary" onClick={onBuild}>
                Build a mod
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card mods-detail">
        {mod ? (
          <>
            <header className="detail-head">
              <div className="detail-title">
                <Pill status={mod.status} />
                <h2>{mod.name}</h2>
                <p>“{mod.prompt}”</p>
              </div>
              <dl className="facts">
                <div>
                  <dt>Attempts</dt>
                  <dd>{mod.attempts.length}</dd>
                </div>
                <div>
                  <dt>Spend</dt>
                  <dd>{fmtMoney(modSpend(mod))}</dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd>{allSessions([mod]).length}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{ago(mod.createdAt)} ago</dd>
                </div>
              </dl>
              {mod.repoDir && (
                <button className="btn-ghost" onClick={() => call("open-path", mod.repoDir)}>
                  Open repository
                </button>
              )}
            </header>

            <nav className="tabs" role="tablist">
              <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>
                Overview
              </button>
              <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>
                Code
              </button>
            </nav>

            {tab === "overview" ? (
              <div className="overview">
                <div className="overview-col">
                  {mod.spec?.summary && (
                    <div className="spec">
                      <h4>Spec</h4>
                      <p>{mod.spec.summary}</p>
                      {mod.spec.behavior?.length > 0 && (
                        <ul>
                          {mod.spec.behavior.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <PlanChecks mod={mod} />
                </div>
                <div className="overview-col">
                  <div className="section-head">
                    <h4>Attempts</h4>
                    <span className="count">{mod.attempts.length}</span>
                  </div>
                  <AttemptTimeline mod={mod} onSelect={openCommit} />
                  <div className="section-head">
                    <h4>Partners</h4>
                  </div>
                  <PartnerStatus mod={mod} />
                </div>
              </div>
            ) : (
              <CodeView key={mod.id} mod={mod} initialSha={commit} />
            )}
          </>
        ) : (
          <Empty>Select a mod to see its test plan, attempts, and code.</Empty>
        )}
      </section>
    </div>
  );
}

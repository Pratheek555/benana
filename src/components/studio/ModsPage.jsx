import React from "react";
import { call, ago } from "../../api.js";
import {
  AttemptTimeline,
  Empty,
  Icon,
  PageHead,
  PartnerStatus,
  PlanChecks,
  SectionHead,
  Status,
  allSessions,
  fmtMoney,
  modSpend,
} from "./shared.jsx";
import CodeView from "./CodeView.jsx";

const FILTERS = [
  ["all", "All"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["running", "Running"],
];

const matches = (m, key) => key === "all" || (key === "running" ? m.running : m.status === key);

export default function ModsPage({ mods, mod, setSelectedId, onBuild, onWatch }) {
  const [filter, setFilter] = React.useState("all");
  const [tab, setTab] = React.useState("overview");
  const [commit, setCommit] = React.useState(null);
  const shown = mods.filter((m) => matches(m, filter));

  const openCommit = (attempt) => {
    setCommit(attempt.commit.sha);
    setTab("code");
  };

  return (
    <div className="view fill">
      <PageHead title="Mods" sub="Every mod Benana built, with its plugin code and attempt history.">
        <button className="btn solid" onClick={onBuild}>
          <Icon name="plus" size={14} />
          New mod
        </button>
      </PageHead>

      <div className="mods">
        <section className="panel mods-list">
          <div className="segmented" role="tablist">
            {FILTERS.map(([key, label]) => (
              <button key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
                {label}
                <span>{mods.filter((m) => matches(m, key)).length}</span>
              </button>
            ))}
          </div>
          <div className="list">
            {shown.map((m) => (
              <button key={m.id} className={`list-row ${m.id === mod?.id ? "active" : ""}`} onClick={() => setSelectedId(m.id)}>
                <span className="list-main">
                  <strong>{m.name}</strong>
                  <small>
                    {m.attempts.length} attempt{m.attempts.length === 1 ? "" : "s"} · {fmtMoney(modSpend(m))} · {ago(m.createdAt)} ago
                  </small>
                </span>
                <Status status={m.running ? "running" : m.status} />
              </button>
            ))}
            {!shown.length && (
              <div className="empty-action">
                <Empty>{mods.length ? "No mods match this filter." : "No mods yet."}</Empty>
              </div>
            )}
          </div>
        </section>

        <section className="panel mods-detail">
          {mod ? (
            <>
              <header className="detail-head">
                <div className="detail-title">
                  <div className="run-name">
                    <h2>{mod.name}</h2>
                    <Status status={mod.running ? "running" : mod.status} />
                    {mod.seed && <span className="tag">Seeded bug</span>}
                  </div>
                  <p>{mod.prompt}</p>
                </div>
                <div className="page-actions">
                  <button className="btn" onClick={() => onWatch(mod.id)}>
                    {mod.running ? "Watch live" : "Open run"}
                  </button>
                  {mod.repoDir && (
                    <button className="btn" onClick={() => call("open-path", mod.repoDir)}>
                      <Icon name="folder" size={14} />
                      Repository
                    </button>
                  )}
                </div>
              </header>

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
                  <dt>Agent sessions</dt>
                  <dd>{allSessions([mod]).length}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{ago(mod.createdAt)} ago</dd>
                </div>
              </dl>

              <nav className="tabs" role="tablist">
                {[
                  ["overview", "Overview"],
                  ["code", "Code"],
                ].map(([key, label]) => (
                  <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>
                    {label}
                  </button>
                ))}
              </nav>

              {tab === "overview" ? (
                <div className="overview">
                  <div className="overview-col">
                    {mod.spec?.summary && (
                      <section className="block">
                        <SectionHead title="Spec" />
                        <p className="prose">{mod.spec.summary}</p>
                        {mod.spec.behavior?.length > 0 && (
                          <ul className="bullets">
                            {mod.spec.behavior.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )}
                    <PlanChecks mod={mod} />
                    <section className="block">
                      <SectionHead title="Partners" />
                      <PartnerStatus mod={mod} />
                    </section>
                  </div>
                  <div className="overview-col">
                    <section className="block">
                      <SectionHead title="Attempts" count={mod.attempts.length} />
                      <AttemptTimeline mod={mod} onSelect={openCommit} />
                    </section>
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
    </div>
  );
}

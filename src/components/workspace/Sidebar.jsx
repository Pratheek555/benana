import React from "react";
import benanaMark from "../../../assets/benana-mark.svg";
import { isDemo } from "../../api.js";
import Icon from "../Icon.jsx";

const NAV = [
  ["tasks", "chat", "Tasks"],
  ["inbox", "inbox", "Inbox"],
  ["entire", "graph", "Entire graph"],
  ["benana-graph", "graph", "Intent graph"],
  ["history", "clock", "History"],
  ["insights", "sparkles", "Insights"],
  ["improvements", "check", "Improvements"],
];
const FOOT = [
  ["connections", "link", "Connections"],
  ["settings", "settings", "Settings"],
];

export default function Sidebar({
  project,
  runs,
  sessions,
  inbox,
  route,
  setRoute,
  selected,
  setSelected,
  onNew,
}) {
  const recent = [
    ...runs,
    ...sessions.map((s) => ({
      ...s,
      status: "attached",
      task: s.title || s.summary || "Attached agent session",
      origin: "attached",
    })),
  ]
    .sort(
      (a, b) =>
        (b.startedAt || b.updatedAt || 0) - (a.startedAt || a.updatedAt || 0),
    )
    .slice(0, 6);
  return (
    <aside className="sidebar">
      <button className="repo" onClick={() => setRoute("settings")}>
        <img className="repo-mark" src={benanaMark} alt="" />
        <span>
          <strong>{project.name || project.repo?.split("/").at(-1)}</strong>
          <small>{project.repo}</small>
        </span>
        <Icon name="chevron" size={14} />
      </button>
      <button className="new-task" onClick={onNew}>
        <Icon name="plus" />
        New task
      </button>
      <nav aria-label="Workspace">
        {NAV.map(([id, icon, label]) => (
          <button
            key={id}
            className={route === id ? "active" : ""}
            onClick={() => setRoute(id)}
          >
            <Icon name={icon} />
            {label}
            {id === "inbox" && inbox.length > 0 && (
              <span className="nav-count">{inbox.length}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="recent-label">Recent runs</div>
      <div className="recent">
        {recent.map((r) => (
          <button
            key={`${r.origin}-${r.id}`}
            className={selected?.id === r.id ? "active" : ""}
            onClick={() => {
              setSelected({
                id: r.id,
                origin: r.origin === "attached" ? "attached" : "native",
              });
              setRoute("tasks");
            }}
          >
            <span className={`status-dot ${r.status}`} />
            <span>
              {r.task || "Untitled task"}
              <small>
                {r.origin === "attached"
                  ? "Attached session"
                  : `Attempt ${r.attempt || 1} | ${r.status}`}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="run-stats">
        {runs
          .reduce(
            (total, run) =>
              total +
              (run.usage?.inputTokens || 0) +
              (run.usage?.outputTokens || 0),
            0,
          )
          .toLocaleString()}{" "}
        tokens
      </div>
      <nav className="foot">
        {FOOT.map(([id, icon, label]) => (
          <button
            key={id}
            className={route === id ? "active" : ""}
            onClick={() => setRoute(id)}
          >
            <Icon name={icon} />
            {label}
          </button>
        ))}
      </nav>
      {isDemo && <div className="demo-label">Demo sample data</div>}
    </aside>
  );
}

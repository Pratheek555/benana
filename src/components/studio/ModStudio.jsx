import React from "react";
import { call, on, ago } from "../../api.js";
import BuildPage from "./BuildPage.jsx";
import ModsPage from "./ModsPage.jsx";
import InsightsPage from "./InsightsPage.jsx";
import NeatlogsPage from "./NeatlogsPage.jsx";
import EntirePage from "./EntirePage.jsx";
import { Icon } from "./shared.jsx";
import "./studio.css";

const PAGES = [
  ["build", "Build"],
  ["mods", "Mods"],
  ["insights", "Insights"],
  ["neatlogs", "Neatlogs"],
  ["entire", "Entire"],
];

const ICONS = {
  build: <path d="M10 2.5 3.5 6v8L10 17.5l6.5-3.5V6L10 2.5zM3.5 6 10 9.5 16.5 6M10 9.5v8" />,
  mods: (
    <>
      <rect x="3" y="3" width="5.5" height="5.5" rx="1.2" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" />
    </>
  ),
  insights: <path d="M3 16.5h14M6 13V9.5M10 13V5M14 13V8" />,
  neatlogs: (
    <>
      <circle cx="5" cy="5" r="1.8" />
      <circle cx="15" cy="5" r="1.8" />
      <circle cx="10" cy="15" r="1.8" />
      <path d="M6.5 6.3 9 13.4M13.5 6.3 11 13.4M6.8 5h6.4" />
    </>
  ),
  entire: <path d="M10 2.5 3 6.5l7 4 7-4-7-4zM3 10.5l7 4 7-4M3 14l7 4 7-4" />,
  workspace: <path d="M3.5 5h13M3.5 10h9M3.5 15h6" />,
};

export default function ModStudio({ onOpenWorkspace }) {
  const [page, setPage] = React.useState("build");
  const [mods, setMods] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [composing, setComposing] = React.useState(true);
  const [lessons, setLessons] = React.useState([]);
  const [game, setGame] = React.useState(null);
  const [error, setError] = React.useState("");
  const mod = mods.find((m) => m.id === selectedId) || null;
  const running = mods.find((m) => m.running) || null;

  const watchMod = (id) => {
    setSelectedId(id);
    setComposing(false);
    setPage("build");
  };
  const openMod = (id) => {
    setSelectedId(id);
    setPage("mods");
  };
  const newMod = () => {
    setComposing(true);
    setPage("build");
  };

  React.useEffect(() => {
    call("studio:list")
      .then((list) => {
        setMods(list);
        const live = list.find((m) => m.running);
        setSelectedId((id) => id || live?.id || list[0]?.id || null);
        if (live) setComposing(false);
      })
      .catch((e) => setError(e.message));
    call("studio:lessons").then(setLessons).catch(() => {});
    call("game:status").then(setGame).catch(() => {});
    const offs = [
      on("studio:mod", (next) => {
        setMods((prev) => [next, ...prev.filter((m) => m.id !== next.id)].sort((a, b) => b.createdAt - a.createdAt));
        if (next.status === "passed") call("studio:lessons").then(setLessons).catch(() => {});
      }),
      on("game:status", setGame),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const server = game?.server || "stopped";
  const bot = game?.bot === "online" ? "online" : "offline";

  return (
    <div className="studio">
      <nav className="side" aria-label="Mod Studio">
        <div className="logo">
          <span className="brand-mark">B</span>
          <span>
            <strong>Benana</strong>
            <small>Mod Studio</small>
          </span>
        </div>

        <button className="new-mod" onClick={newMod}>
          <Icon name="plus" size={14} />
          New mod
        </button>

        <div className="nav">
          {PAGES.map(([key, label]) => (
            <button
              key={key}
              className={`nav-item ${page === key ? "active" : ""}`}
              onClick={() => setPage(key)}
              aria-current={page === key ? "page" : undefined}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">{ICONS[key]}</svg>
              {label}
              {key === "build" && running && <span className="live-dot" title="A mod is building" />}
            </button>
          ))}
        </div>

        <div className="side-section">
          <span className="side-label">Recent</span>
          <div className="recents">
            {mods.slice(0, 8).map((m) => (
              <button
                key={m.id}
                className={`recent-item ${page === "build" && !composing && m.id === selectedId ? "active" : ""}`}
                onClick={() => watchMod(m.id)}
                title={m.prompt}
              >
                <span className={`dot ${m.running ? "running" : m.status}`} />
                <span className="recent-name">{m.name}</span>
                <small>{ago(m.createdAt)}</small>
              </button>
            ))}
            {!mods.length && <p className="side-empty">Mods you build appear here.</p>}
          </div>
        </div>

        <div className="side-foot">
          <div className="runtime-status">
            <div>
              <span className={`dot ${server === "running" ? "passed" : server === "starting" ? "running" : "idle"}`} />
              Paper {game?.version || "server"}
              <small>{server === "running" ? "Running" : server === "starting" ? "Starting" : "Stopped"}</small>
            </div>
            <div>
              <span className={`dot ${bot === "online" ? "passed" : "idle"}`} />
              Test bot
              <small>{bot === "online" ? "In game" : "Offline"}</small>
            </div>
            {game?.mock && <span className="mock-note">Mock runtime</span>}
          </div>
          <button className="nav-item" onClick={onOpenWorkspace} title="Open the repository workspace">
            <svg viewBox="0 0 20 20" aria-hidden="true">{ICONS.workspace}</svg>
            Repository workspace
          </button>
        </div>
      </nav>

      <main className="studio-main">
        {error && <div className="alert page-alert">{error}</div>}
        {page === "build" && (
          <BuildPage
            mod={composing ? null : mod}
            running={running}
            lessons={lessons}
            onCreated={watchMod}
            onWatch={watchMod}
            onNew={newMod}
            onOpenCode={openMod}
          />
        )}
        {page === "mods" && <ModsPage mods={mods} mod={mod} setSelectedId={setSelectedId} onBuild={newMod} onWatch={watchMod} />}
        {page === "insights" && <InsightsPage mods={mods} lessons={lessons} />}
        {page === "neatlogs" && <NeatlogsPage mods={mods} onOpenMod={openMod} />}
        {page === "entire" && <EntirePage mods={mods} onOpenMod={openMod} />}
      </main>
    </div>
  );
}

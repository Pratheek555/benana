import React from "react";
import { call, on } from "../../api.js";
import BuildPage from "./BuildPage.jsx";
import ModsPage from "./ModsPage.jsx";
import InsightsPage from "./InsightsPage.jsx";
import NeatlogsPage from "./NeatlogsPage.jsx";
import EntirePage from "./EntirePage.jsx";
import "./studio.css";

const PAGES = [
  { key: "build", label: "Build", title: "Build a mod", sub: "Describe it, watch the AI player test it, and follow every fix." },
  { key: "mods", label: "Mods", title: "Mods", sub: "Every mod Benana built, with its plugin code and attempt history." },
  { key: "insights", label: "Insights", title: "Insights", sub: "Pass rates, spend, and what the agents learned across all mods." },
  { key: "neatlogs", label: "Neatlogs", title: "Neatlogs traces", sub: "Every agent session, linked to its trace." },
  { key: "entire", label: "Entire", title: "Entire checkpoints", sub: "Each commit linked to the agent session that produced it." },
];

const ICONS = {
  build: <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3zM3 7.5l9 4.5 9-4.5M12 12v9" />,
  mods: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  insights: <path d="M4 20h16M8 16v-5M12 16V7M16 16v-8" />,
  neatlogs: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M8 7l2.8 9M16 7l-2.8 9M8.2 6h7.6" />
    </>
  ),
  entire: <path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  workspace: <path d="M4 6h16M4 12h10M4 18h7" />,
};

export default function ModStudio({ onOpenWorkspace }) {
  const [page, setPage] = React.useState("build");
  const [mods, setMods] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [lessons, setLessons] = React.useState([]);
  const [game, setGame] = React.useState(null);
  const [error, setError] = React.useState("");
  const current = PAGES.find((p) => p.key === page);
  const mod = mods.find((m) => m.id === selectedId) || null;
  const running = mods.some((m) => m.running);
  const openMod = (id) => {
    setSelectedId(id);
    setPage("mods");
  };

  React.useEffect(() => {
    call("studio:list")
      .then((list) => {
        setMods(list);
        setSelectedId((id) => id || list[0]?.id || null);
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

  return (
    <div className="studio">
      <nav className="rail" aria-label="Mod Studio">
        <div className="rail-brand" title="Benana Mod Studio">B</div>
        {PAGES.map((p) => (
          <button
            key={p.key}
            className={`rail-item ${page === p.key ? "active" : ""}`}
            onClick={() => setPage(p.key)}
            aria-current={page === p.key ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[p.key]}</svg>
            <span>{p.label}</span>
            {p.key === "build" && running && <i className="rail-live" />}
          </button>
        ))}
        <button className="rail-item rail-foot" onClick={onOpenWorkspace} title="Open the repository workspace">
          <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS.workspace}</svg>
          <span>Repo</span>
        </button>
      </nav>

      <div className="studio-body">
        <header className="studio-top">
          <div>
            <h1>{current.title}</h1>
            <p>{current.sub}</p>
          </div>
          <div className="top-status">
            <span className={`status-dot ${game?.server || "stopped"}`} />
            <span>{game?.server === "running" ? "Server running" : game?.server === "starting" ? "Server starting" : "Server stopped"}</span>
            <span className="sep" />
            <span className={`status-dot ${game?.bot === "online" ? "running" : "offline"}`} />
            <span>{game?.bot === "online" ? "Bot in game" : "Bot offline"}</span>
            {game?.mock && <span className="tag mock">Mock runtime</span>}
          </div>
        </header>
        {error && <div className="studio-error page-error">{error}</div>}

        {page === "build" && (
          <BuildPage mods={mods} mod={mod} setSelectedId={setSelectedId} lessons={lessons} onSeeMods={() => setPage("mods")} />
        )}
        {page === "mods" && <ModsPage mods={mods} mod={mod} setSelectedId={setSelectedId} onBuild={() => setPage("build")} />}
        {page === "insights" && <InsightsPage mods={mods} lessons={lessons} />}
        {page === "neatlogs" && <NeatlogsPage mods={mods} onOpenMod={openMod} />}
        {page === "entire" && <EntirePage mods={mods} onOpenMod={openMod} />}
      </div>
    </div>
  );
}

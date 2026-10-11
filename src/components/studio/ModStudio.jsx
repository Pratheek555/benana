import React from "react";
import { beginDrag } from "./Split.jsx";
import { call, on, ago, isDemo } from "../../api.js";
import BuildPage from "./BuildPage.jsx";
import ModsPage from "./ModsPage.jsx";
import InsightsPage from "./InsightsPage.jsx";
import NeatlogsPage from "./NeatlogsPage.jsx";
import EntirePage from "./EntirePage.jsx";
import { Icon } from "./shared.jsx";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./studio.css";

const PAGES = [
  { id: "build", label: "Build" },
  { id: "mods", label: "Mods" },
  { id: "insights", label: "Insights" },
  { id: "neatlogs", label: "Neatlogs" },
  { id: "entire", label: "Entire" },
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

// Shown when Benana's main-process code changed after launch; builds are refused until a restart loads it.
function CodeBanner({ building }) {
  const [code, setCode] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    call("app:code").then(setCode).catch(() => {});
    return on("app:code", (next) => setCode((prev) => ({ ...prev, ...next })));
  }, []);

  if (!code?.stale) return null;
  const files = code.changed.slice(0, 3).join(", ") + (code.changed.length > 3 ? ` +${code.changed.length - 3} more` : "");
  const restart = async () => {
    setBusy(true);
    setError("");
    try {
      await call("app:restart");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="code-banner">
      <span>
        <strong>Benana's code changed.</strong> {files} won't take effect until a restart, so new builds are paused.
        {error && <em> {error}</em>}
      </span>
      {code.restartable ? (
        <button disabled={busy || building} title={building ? "A mod is building. Restart after it finishes." : undefined} onClick={restart}>
          {busy ? "Restarting…" : "Restart Benana"}
        </button>
      ) : (
        <small>Stop and rerun npm run dev to load it.</small>
      )}
    </div>
  );
}

const saved = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};

const SIDE_DEFAULT = 236;
const readSide = () => {
  try { return Number(localStorage.getItem("benana-side-width")) || SIDE_DEFAULT; } catch { return SIDE_DEFAULT; }
};

export default function ModStudio({ onOpenWorkspace }) {
  const [sideWidth, setSideWidth] = React.useState(readSide);
  const setSide = (w) => {
    setSideWidth(w);
    try { localStorage.setItem("benana-side-width", String(w)); } catch {}
  };
  const resizeSide = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sideWidth;
    const end = beginDrag("col-resize");
    let w = startW;
    const move = (ev) => { w = Math.min(Math.max(startW + ev.clientX - startX, 180), 420); setSideWidth(w); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      end();
      setSide(w);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [page, setPage] = React.useState("build");
  const [mods, setMods] = React.useState([]);
  // The open chat survives restarts.
  const [selectedId, setSelectedId] = React.useState(() => saved("benana.studio.selected", null));
  const [composing, setComposing] = React.useState(() => saved("benana.studio.composing", true));
  const [lessons, setLessons] = React.useState([]);
  const [game, setGame] = React.useState(null);
  const [error, setError] = React.useState("");
  const mod = mods.find((m) => m.id === selectedId) || null;
  const running = mods.find((m) => m.running) || null;

  React.useEffect(() => {
    localStorage.setItem("benana.studio.selected", JSON.stringify(selectedId));
    localStorage.setItem("benana.studio.composing", JSON.stringify(composing));
  }, [selectedId, composing]);

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
        setSelectedId((id) => (id && list.some((m) => m.id === id) ? id : live?.id || list[0]?.id || null));
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
  const currentPage = PAGES.find((item) => item.id === page);

  return (
    <div className="studio" style={{ "--side-w": `${sideWidth}px` }}>
      <nav className="side" aria-label="Mod Studio">
        <div
          className="side-resizer"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset"
          onPointerDown={resizeSide}
          onDoubleClick={() => setSide(SIDE_DEFAULT)}
        />
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
          <span className="side-label nav-label">Workspace</span>
          {PAGES.map(({ id, label }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => setPage(id)}
              aria-current={page === id ? "page" : undefined}
              title={label}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">{ICONS[id]}</svg>
              <span className="nav-text">{label}</span>
              {id === "build" && running && <span className="live-dot" title="A mod is building" />}
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
          <div className="runtime-status" title={game?.mock ? "Mock runtime: no real Paper server" : undefined}>
            <span className={`rt-dot ${server === "running" && bot === "online" ? "ok" : server === "starting" || server === "running" ? "busy" : ""}`} />
            <span className="rt-text">
              <strong>Paper {game?.version || "server"}</strong>
              <small>
                {server === "running" ? (bot === "online" ? "Bot in game" : "Bot offline") : server === "starting" ? "Starting…" : "Stopped"}
                {game?.mock ? " · mock" : ""}
              </small>
            </span>
          </div>
          <button className="nav-item" onClick={onOpenWorkspace} title="Open the repository workspace">
            <svg viewBox="0 0 20 20" aria-hidden="true">{ICONS.workspace}</svg>
            <span className="nav-text">Repository workspace</span>
          </button>
        </div>
      </nav>

      <main className="studio-main">
        <header className="context-bar">
          <div className="breadcrumb"><span>Benana</span><i>/</i><strong>{currentPage?.label}</strong></div>
          <div className="context-state">
            {isDemo && <span className="sample-badge">Sample data</span>}
            <span className={`context-runtime ${server === "running" && bot === "online" ? "ok" : ""}`}>
              <i />{server === "running" ? (bot === "online" ? "Runtime ready" : "Runtime online") : "Runtime stopped"}
            </span>
            <button className="context-workspace" onClick={onOpenWorkspace} title="Open the repository workspace" aria-label="Open the repository workspace">
              <svg viewBox="0 0 20 20" aria-hidden="true">{ICONS.workspace}</svg>
            </button>
          </div>
        </header>
        <CodeBanner building={Boolean(running)} />
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

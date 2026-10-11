import React from "react";
import { call, on } from "../../api.js";
import "./game.css";

const LABEL = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  error: "Error",
  offline: "Offline",
  connecting: "Joining",
  online: "In game",
};

// One-line summary of a bot tool call for the overlay.
function describe(a) {
  if (a.error) return a.error.slice(0, 80);
  const r = a.result;
  if (r?.after) return `${r.after.name} ↑ ${r.after.maxUpwardVelocity} b/t, +${r.after.maxHeightGain} blocks`;
  if (a.tool === "track_entity" && r) return `${r.name} ↑ ${r.maxUpwardVelocity} b/t, +${r.maxHeightGain} blocks`;
  if (a.tool === "nearby_entities" && Array.isArray(r)) return r.slice(0, 3).map((e) => `${e.name}#${e.id}`).join(" ") || "nothing nearby";
  if (a.tool === "game_setup") return (a.args?.commands || []).join(" · ").slice(0, 80);
  if (a.tool === "equip") return r?.holding || "";
  return JSON.stringify(a.args || {}).slice(0, 80);
}

// Live view of the test bot inside the local Paper server. Owner: Track A.
export default function GamePane({ showLog = true }) {
  const [status, setStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lines, setLines] = React.useState([]);
  const [actions, setActions] = React.useState([]);
  const [demo, setDemo] = React.useState(false);

  React.useEffect(() => {
    call("game:status").then(setStatus).catch((e) => setError(e.message));
    const offs = [
      on("game:status", setStatus),
      on("game:log", (l) => setLines((prev) => [...prev.slice(-199), l])),
      on("game:action", (a) => setActions((prev) => [...prev.slice(-29), a])),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      setStatus(await call(running ? "game:stop" : "game:start"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const running = status && status.server !== "stopped";
  const recent = actions.filter((a) => a.done).slice(-3);

  return (
    <section className="game-pane">
      <header className="game-bar">
        <strong>Live view</strong>
        {status?.version && <span className="game-meta">Minecraft {status.version}</span>}
        <span className="game-state">
          <span className={`game-dot ${status?.server || "stopped"}`} />
          Server {(LABEL[status?.server] || "unknown").toLowerCase()}
        </span>
        <span className="game-state">
          <span className={`game-dot ${status?.bot || "offline"}`} />
          Bot {(LABEL[status?.bot] || "unknown").toLowerCase()}
        </span>
        <span className="game-spacer" />
        {status?.bot === "online" && (
          <button
            className="game-btn ghost"
            onClick={() =>
              call("game:demo", { on: !demo })
                .then((r) => setDemo(r.demo))
                .catch((e) => setError(e.message))
            }
          >
            {demo ? "Stop demo" : "Demo hits"}
          </button>
        )}
        <button className="game-btn" disabled={busy} onClick={toggle}>
          {busy ? "Working…" : running ? "Stop" : "Start game"}
        </button>
      </header>
      <div className="game-view">
        {status?.viewerUrl ? (
          <iframe title="Bot view" src={status.viewerUrl} />
        ) : (
          <div className="game-empty">
            {status?.server === "starting"
              ? "Starting the Paper server…"
              : "Start the game to watch the AI player."}
          </div>
        )}
        {recent.length > 0 && (
          <div className="game-actions">
            {recent.map((a) => (
              <div key={`${a.at}-${a.tool}`} className={`game-action ${a.error ? "error" : ""}`}>
                <span>{a.tool}</span>
                <code>{describe(a)}</code>
              </div>
            ))}
          </div>
        )}
      </div>
      {(error || status?.error) && (
        <div className="game-error">{error || status.error}</div>
      )}
      {showLog && (
        <pre className="game-log">
          {lines
            .slice(-8)
            .map((l) => l.line)
            .join("\n")}
        </pre>
      )}
    </section>
  );
}

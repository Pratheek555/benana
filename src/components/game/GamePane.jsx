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

// Live view of the test bot inside the local Paper server. Owner: Track A.
export default function GamePane() {
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
  const last = actions[actions.length - 1];

  return (
    <section className="game-pane">
      <header className="game-bar">
        <strong>Minecraft {status?.version || ""}</strong>
        <span className={`game-dot ${status?.server || "stopped"}`} />
        <span>Server: {LABEL[status?.server] || "Unknown"}</span>
        <span className={`game-dot ${status?.bot || "offline"}`} />
        <span>Bot: {LABEL[status?.bot] || "Unknown"}</span>
        {status?.mock && <span className="game-tag">Mock runtime</span>}
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
        {last && (
          <div className="game-action">
            <span>{last.tool}</span>
            {last.args && <code>{JSON.stringify(last.args).slice(0, 80)}</code>}
          </div>
        )}
      </div>
      {(error || status?.error) && (
        <div className="game-error">{error || status.error}</div>
      )}
      <pre className="game-log">
        {lines
          .slice(-8)
          .map((l) => l.line)
          .join("\n")}
      </pre>
    </section>
  );
}

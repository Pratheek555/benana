import React from "react";
import { call, on } from "../../api.js";
import Hud from "./Hud.jsx";
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
  if (r?.self) return `bot +${r.self.maxHeightGain} blocks, ${r.self.launches} launch${r.self.launches === 1 ? "" : "es"}`;
  if (a.tool === "track_self" && r) return `bot +${r.maxHeightGain} blocks, ${r.launches} launch${r.launches === 1 ? "" : "es"}, ${r.health?.min} hp min`;
  if (a.tool === "boss_bars" && Array.isArray(r)) return r.map((b) => `${b.title} ${Math.round(b.health * 100)}% ${b.color}`).join(" · ") || "no boss bar";
  if (a.tool === "server_log" && Array.isArray(r?.lines ?? r)) return `${(r.lines ?? r).length} log lines`;
  if (a.tool === "read_chat" && Array.isArray(r)) return r.slice(-1).map((c) => c.text).join("") || "no chat";
  if (a.tool === "track_entity" && r) return `${r.name} ↑ ${r.maxUpwardVelocity} b/t, +${r.maxHeightGain} blocks`;
  if (a.tool === "nearby_entities" && Array.isArray(r)) return r.slice(0, 3).map((e) => `${e.name}#${e.id}`).join(" ") || "nothing nearby";
  if (a.tool === "game_setup") return (a.args?.commands || []).join(" · ").slice(0, 80);
  if (a.tool === "equip") return r?.holding || "";
  return JSON.stringify(a.args || {}).slice(0, 80);
}

// Live view of the test bot inside the local Paper server. Owner: Track A.
// With a mod (the chat the user is in) it keeps the server on that mod's build and a fresh world, and offers
// "Run mod" (an AI player shows what the mod does) and "Reset world" (back to untouched terrain).
export default function GamePane({ showLog = true, mod = null, building = false }) {
  const [status, setStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lines, setLines] = React.useState([]);
  const [actions, setActions] = React.useState([]);
  const [demo, setDemo] = React.useState(false);
  const [hud, setHud] = React.useState(null);
  const [modDemo, setModDemo] = React.useState({ modId: null, running: false, summary: "", error: null });
  const [dismissed, setDismissed] = React.useState(false);
  const synced = React.useRef(null);

  React.useEffect(() => {
    call("game:status").then(setStatus).catch((e) => setError(e.message));
    call("game:hud").then(setHud).catch(() => {});
    call("studio:demo-state").then((s) => setModDemo((prev) => ({ ...prev, ...s }))).catch(() => {});
    const offs = [
      on("game:status", setStatus),
      on("game:log", (l) => setLines((prev) => [...prev.slice(-199), l])),
      on("game:hud", setHud),
      on("game:action", (a) => setActions((prev) => [...prev.slice(-29), a])),
      on("studio:demo", (d) => {
        setModDemo({ summary: "", error: null, ...d });
        if (d.running) setDismissed(false);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const running = status && status.server !== "stopped";
  const recent = actions.filter((a) => a.done).slice(-3);
  const deploying = status?.deploying || null;
  const resetting = Boolean(status?.resetting);
  const reloading = Boolean(deploying) || resetting;
  const deployed = status?.deployed || null;
  const matches = Boolean(
    mod && deployed && mod.jar && (deployed.jar ? deployed.jar === mod.jar : deployed.plugin === mod.name),
  );
  const canLoad = Boolean(mod?.loadable) && !reloading && !matches;
  const demoRunning = modDemo.running && modDemo.modId === mod?.id;
  const demoNote = !dismissed && !demoRunning && modDemo.modId === mod?.id ? modDemo : null;
  const locked = busy || building || reloading;
  const showHud = Boolean(hud && status?.viewerUrl && !reloading && status?.bot === "online");

  const attempt = async (fn) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const loadMod = () => attempt(() => call("studio:load", { id: mod.id }));

  const toggle = () =>
    attempt(async () => {
      if (running) setStatus(await call("game:stop"));
      else if (canLoad) await call("studio:load", { id: mod.id });
      else setStatus(await call("game:start"));
    });

  const runMod = () =>
    attempt(async () => {
      setDismissed(false);
      await call("studio:demo", { id: mod.id });
    });

  const stopDemo = () => attempt(() => call("studio:demo-stop"));

  const resetWorld = () => attempt(() => call("studio:reset-world"));

  // Opening a chat puts that mod, on a fresh world, in the live view.
  React.useEffect(() => {
    synced.current = null;
    setDismissed(false);
  }, [mod?.id]);
  React.useEffect(() => {
    if (!mod?.loadable || mod.running || building || busy || reloading || matches || status?.server !== "running") return;
    if (synced.current === mod.id) return;
    synced.current = mod.id;
    loadMod();
  }, [mod?.id, mod?.loadable, mod?.running, building, busy, reloading, matches, status?.server]);

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
        <span className={`game-mod ${matches ? "match" : ""}`} title="The studio mod loaded on the server">
          {resetting ? "Resetting world…" : deploying ? `Loading ${deploying}…` : deployed?.plugin || "No mod"}
        </span>
        <span className="game-spacer" />
        {canLoad && (
          <button
            className="game-btn load"
            disabled={locked}
            title={building ? "A mod is building. Switch after it finishes." : `Load ${mod.name}'s latest build onto a fresh world`}
            onClick={loadMod}
          >
            Load {mod.name}
          </button>
        )}
        {mod ? (
          <>
            {status?.bot === "online" && (
              <button
                className="game-btn ghost"
                disabled={locked || demoRunning}
                title="Wipe the world back to untouched terrain and restart the mod"
                onClick={resetWorld}
              >
                Reset world
              </button>
            )}
            {demoRunning ? (
              <button className="game-btn" disabled={busy} onClick={stopDemo}>
                Stop demo
              </button>
            ) : (
              <button
                className="game-btn"
                disabled={locked || !mod.loadable}
                title={
                  building
                    ? "A mod is building. Run it after it finishes."
                    : mod.loadable
                      ? `Watch an AI player show what ${mod.name} does`
                      : `${mod.name} has no build yet`
                }
                onClick={runMod}
              >
                Run mod
              </button>
            )}
          </>
        ) : (
          status?.bot === "online" && (
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
          )
        )}
        <button className={`game-btn ${mod ? "ghost" : ""}`} disabled={busy || reloading} onClick={toggle}>
          {busy ? "Working…" : running ? "Stop" : "Start game"}
        </button>
      </header>
      <div className={`game-view ${showHud ? "hud-on" : ""} ${demoRunning || demoNote ? "demo" : ""}`}>
        {status?.viewerUrl && !reloading ? (
          <>
            <iframe title="Bot view" src={status.viewerUrl} />
            {showHud && <Hud hud={hud} viewerUrl={status.viewerUrl} />}
          </>
        ) : (
          <div className="game-empty">
            {resetting
              ? "Resetting the world…"
              : deploying
                ? `Loading ${deploying} on a fresh world…`
                : status?.server === "starting"
                  ? "Starting the Paper server…"
                  : mod && canLoad
                    ? `Start the game to load ${mod.name} on a fresh world.`
                    : "Start the game to watch the AI player."}
          </div>
        )}
        {(demoRunning || demoNote) && (
          <div className={`game-demo ${demoNote?.error ? "error" : ""}`}>
            {demoRunning ? (
              <>
                <span className="spinner" />
                <span>Showing what {mod.name} does…</span>
              </>
            ) : (
              <>
                <span>{demoNote.error ? `Demo failed: ${demoNote.error}` : demoNote.summary || "Demo finished."}</span>
                <button aria-label="Dismiss" onClick={() => setDismissed(true)}>
                  ×
                </button>
              </>
            )}
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
      {(error || status?.error) && <div className="game-error">{error || status.error}</div>}
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

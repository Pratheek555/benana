import React from "react";
import { call, on } from "../../api.js";
import GamePane from "../game/GamePane.jsx";
import { ROLE, allSessions, fmtDuration, shortModel, shortSha } from "./shared.jsx";

const clock = (ts) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";

export function useNow(active, ms = 1000) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function useStickyScroll(dep) {
  const ref = React.useRef(null);
  const stick = React.useRef(true);
  const [away, setAway] = React.useState(false);
  React.useLayoutEffect(() => {
    if (ref.current && stick.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep]);
  const onScroll = (e) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAway(!stick.current);
  };
  const jump = () => {
    stick.current = true;
    setAway(false);
    if (ref.current) ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  };
  return { ref, onScroll, away, jump };
}

export default function TestPanel({ mod }) {
  return (
    <section className="test-panel">
      <GamePane showLog={false} />
      <div className="lanes">
        <ServerLog mod={mod} />
        <div className="lane-stack">
          <NeatlogsLane mod={mod} />
          <EntireLane mod={mod} />
        </div>
      </div>
    </section>
  );
}

function parseLine(entry) {
  const raw = entry.line || "";
  const time = raw.match(/^\[(\d{2}:\d{2}:\d{2})/)?.[1] || clock(entry.at);
  let text = raw.replace(/^(\[[^\]]*\]\s*)+:?\s*/, "");
  let source = "server";
  const prefix = raw.match(/^\[(bot|chat|benana)\]\s*/);
  if (prefix) {
    source = prefix[1];
    text = raw.slice(prefix[0].length);
  }
  const plugin = text.match(/^\[([A-Za-z0-9_]+)\]\s*/);
  if (plugin) text = text.slice(plugin[0].length);
  return { time, text: text || raw, source, plugin: plugin?.[1] || null, level: entry.level || "info" };
}

function ServerLog({ mod }) {
  const [lines, setLines] = React.useState([]);
  const seq = React.useRef(0);
  const stamp = (l) => ({ ...parseLine(l), key: ++seq.current });

  React.useEffect(() => {
    let live = true;
    call("game:logs", { limit: 200 })
      .then((backlog) => live && setLines((prev) => [...backlog.map(stamp), ...prev].slice(-500)))
      .catch(() => {});
    const offs = [
      on("game:log", (l) => setLines((prev) => [...prev.slice(-499), stamp(l)])),
      on("game:action", (a) => {
        if (!a.done) return;
        const text = a.error ? `${a.tool} failed: ${a.error}` : `${a.tool} ${JSON.stringify(a.args || {}).slice(0, 90)}`;
        setLines((prev) => [
          ...prev.slice(-499),
          { time: clock(a.done), text, source: "bot", plugin: null, level: a.error ? "error" : "info", key: ++seq.current },
        ]);
      }),
    ];
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, []);

  const errors = lines.filter((l) => l.level === "error").length;
  const warns = lines.filter((l) => l.level === "warn").length;
  const { ref, onScroll, away, jump } = useStickyScroll(lines.length);
  const modName = mod?.name;

  return (
    <section className="lane server-lane">
      <header className="lane-head">
        <span className="lane-mark server" />
        <strong>Server log</strong>
        <span className={`lane-live ${lines.length ? "on" : ""}`}>Live</span>
        <span className="lane-meta">
          {lines.length} lines
          {warns > 0 && <b className="warn"> · {warns} warn</b>}
          {errors > 0 && <b className="error"> · {errors} error</b>}
        </span>
      </header>
      <div className="lane-body log" ref={ref} onScroll={onScroll}>
        {!lines.length && <p className="lane-empty">Start the game to stream the Paper console.</p>}
        {lines.map((l) => (
          <div
            key={l.key}
            className={`log-line ${l.level} ${l.source} ${modName && l.plugin === modName ? "mine" : ""}`}
          >
            <time>{l.time}</time>
            <span className="log-text">
              {l.source !== "server" && <em className={`log-src ${l.source}`}>{l.source}</em>}
              {l.plugin && <em className="log-plugin">{l.plugin}</em>}
              {l.text}
            </span>
          </div>
        ))}
      </div>
      {away && (
        <button className="jump" onClick={jump}>
          Jump to latest
        </button>
      )}
    </section>
  );
}

const RETRY_MS = 20000;

function NeatlogsLane({ mod }) {
  const [status, setStatus] = React.useState(null);
  const [evidence, setEvidence] = React.useState({});
  const pending = React.useRef(new Set());
  const sessions = React.useMemo(
    () => (mod ? allSessions([mod]).filter((s) => s.sessionId).reverse() : []),
    [mod],
  );
  const running = sessions.some((s) => !s.endedAt);
  const now = useNow(running);

  React.useEffect(() => {
    call("studio:partners")
      .then((p) => setStatus(p.neatlogs))
      .catch(() => setStatus({ configured: true, ok: false }));
  }, []);

  const timers = React.useRef({});
  const clearTimers = () => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
  };
  React.useEffect(() => clearTimers, []);

  React.useEffect(() => {
    clearTimers();
    setEvidence({});
    pending.current = new Set();
  }, [mod?.id]);

  React.useEffect(() => {
    if (status?.configured === false) return;
    for (const s of sessions) {
      const id = s.sessionId;
      if (!s.endedAt || pending.current.has(id)) continue;
      const prev = evidence[id];
      if (prev && (prev.matched || prev.configured === false || prev.tries >= 3)) continue;
      pending.current.add(id);
      const lookup = () =>
        call("studio:evidence", { sessionId: id })
          .catch((e) => ({ matched: false, traces: [], error: e.message }))
          .then((r) => {
            pending.current.delete(id);
            delete timers.current[id];
            setEvidence((m) => ({ ...m, [id]: { ...r, tries: (m[id]?.tries || 0) + 1 } }));
          });
      if (prev) timers.current[id] = setTimeout(lookup, RETRY_MS);
      else lookup();
    }
  }, [sessions, evidence, status?.configured]);

  const matched = Object.values(evidence).filter((e) => e.matched).length;
  const { ref, onScroll } = useStickyScroll(sessions.length + matched);

  return (
    <section className="lane">
      <header className="lane-head">
        <span className="lane-mark neatlogs" />
        <strong>Neatlogs</strong>
        {running && <span className="lane-live on">Tracing</span>}
        <span className="lane-meta">
          {status?.configured === false ? "Not configured" : `${matched}/${sessions.length} traced`}
        </span>
      </header>
      <div className="lane-body" ref={ref} onScroll={onScroll}>
        {!sessions.length && (
          <p className="lane-empty">
            {status?.configured === false
              ? "Add NEATLOGS_API_KEY and NEATLOGS_PROJECT_ID to .env to trace agent sessions."
              : "Each agent session is traced here as it runs."}
          </p>
        )}
        {sessions.map((s) => {
          const ev = evidence[s.sessionId];
          const trace = ev?.traces?.[0];
          const spans = trace?.spans || [];
          const live = !s.endedAt;
          return (
            <article key={s.key} className={`ntrace ${live ? "live" : ev?.matched ? "matched" : ""}`}>
              <div className="trace-row">
                <span className={`role-dot ${s.role}`} />
                <strong>{ROLE[s.role] || s.role}</strong>
                <span className="lane-meta">{s.attemptN ? `attempt ${s.attemptN}` : "spec"}</span>
                <span className="trace-state">
                  {live
                    ? `Tracing · ${fmtDuration(now - s.startedAt)}`
                    : status?.configured === false
                      ? "Not configured"
                      : !ev
                        ? "Looking up trace…"
                        : ev.matched
                          ? `${spans.length} spans`
                          : ev.tries >= 3
                            ? "No trace found"
                            : "Waiting for trace…"}
                </span>
              </div>
              <div className="trace-sub">
                <code>{s.sessionId.slice(0, 18)}</code>
                <span>{shortModel(s.model)}</span>
                {trace?.durationMs != null && <span>{fmtDuration(trace.durationMs)}</span>}
              </div>
              {live && <div className="trace-progress" />}
              {spans.length > 0 && (
                <div className="span-strip" title={spans.map((sp) => sp.spanName || sp.name).join(" · ")}>
                  {spans.slice(0, 40).map((sp, i) => (
                    <i key={i} className={sp.status === "error" || sp.status_code === "ERROR" ? "err" : ""} />
                  ))}
                </div>
              )}
              {spans
                .filter((sp) => sp.status === "error" || sp.status_code === "ERROR")
                .slice(0, 2)
                .map((sp, i) => (
                  <p key={i} className="trace-error">
                    {sp.spanName || sp.name}: {sp.failure || "error"}
                  </p>
                ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EntireLane({ mod }) {
  const [cps, setCps] = React.useState(null);
  const enabled = mod?.partners?.entire?.enabled !== false;

  React.useEffect(() => {
    setCps(null);
    if (!mod?.repoDir) return;
    call("studio:checkpoints", { id: mod.id })
      .then(setCps)
      .catch(() => setCps({ ok: false, items: [] }));
  }, [mod?.id, mod?.repoDir, mod?.attempts.length, mod?.status]);

  const events = mod
    ? mod.attempts.flatMap((a) =>
        [
          a.context?.entireCheckpoints != null && {
            key: `${a.n}-ctx`,
            kind: "read",
            title: `Fixer read ${a.context.entireCheckpoints} checkpoint${a.context.entireCheckpoints === 1 ? "" : "s"}`,
            sub: `Before attempt ${a.n}${a.context.neatlogsTrace ? " · with a Neatlogs trace" : ""}`,
          },
          a.commit?.sha && {
            key: `${a.n}-c`,
            kind: "commit",
            title: `Attempt ${a.n} · ${a.role === "seeded" ? "seeded fixture" : (ROLE[a.role] || a.role).toLowerCase()}`,
            sha: a.commit.sha,
            checkpoint: a.commit.checkpoint,
          },
          a.playtestCommit?.sha && {
            key: `${a.n}-p`,
            kind: "commit",
            title: `Playtest ${a.n} · ${a.verdict?.passed ? "passed" : "failed"}`,
            sha: a.playtestCommit.sha,
            checkpoint: a.playtestCommit.checkpoint,
          },
        ].filter(Boolean),
      )
    : [];
  const linked = events.filter((e) => e.checkpoint).length;
  const { ref, onScroll } = useStickyScroll(events.length);

  return (
    <section className="lane">
      <header className="lane-head">
        <span className="lane-mark entire" />
        <strong>Entire</strong>
        <span className="lane-meta">
          {!enabled ? "Off" : `${linked} checkpoint${linked === 1 ? "" : "s"}${cps?.ok ? ` · ${cps.items.length} in repo` : ""}`}
        </span>
      </header>
      <div className="lane-body" ref={ref} onScroll={onScroll}>
        {!events.length && <p className="lane-empty">Each agent commit gets an Entire checkpoint here.</p>}
        {events.map((e) =>
          e.kind === "read" ? (
            <article key={e.key} className="cp-card read">
              <strong>{e.title}</strong>
              <span className="lane-meta">{e.sub}</span>
            </article>
          ) : (
            <article key={e.key} className="cp-card">
              <strong>{e.title}</strong>
              <div className="cp-link">
                <code className="sha-chip">{shortSha(e.sha)}</code>
                <span className="cp-arrow" />
                {e.checkpoint ? <code className="cp-chip">{e.checkpoint.slice(0, 12)}</code> : <span className="lane-meta">no checkpoint</span>}
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  );
}

import React from "react";
import { call, ago } from "../../api.js";
import { Empty, Icon, PageHead, ROLE, Status, shortSha, shortModel } from "./shared.jsx";

// Every agent commit of a mod, grouped by attempt, each linked to its Entire checkpoint.
function commitsOf(mod) {
  return (mod?.attempts || []).map((a) => ({
    n: a.n,
    status: a.status,
    rows: [
      a.commit?.sha && {
        key: `${a.n}-c`,
        sha: a.commit.sha,
        checkpoint: a.commit.checkpoint || null,
        label: a.role === "seeded" ? "Seeded fixture" : `${ROLE[a.role] || a.role}`,
        kind: "code",
        ok: !a.failure || a.failure.kind !== "build",
      },
      a.playtestCommit?.sha && {
        key: `${a.n}-p`,
        sha: a.playtestCommit.sha,
        checkpoint: a.playtestCommit.checkpoint || null,
        label: a.verdict?.passed ? "Playtest passed" : "Playtest failed",
        kind: "playtest",
        ok: Boolean(a.verdict?.passed),
      },
    ].filter(Boolean),
  })).filter((g) => g.rows.length);
}

const coverage = (mod) => {
  const rows = commitsOf(mod).flatMap((g) => g.rows);
  return { linked: rows.filter((r) => r.checkpoint).length, total: rows.length };
};

function Copy({ text, label = "Copy" }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      className="ent-copy"
      title={`Copy ${text}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export default function EntirePage({ mods, onOpenMod }) {
  const repos = mods.filter((m) => m.repoDir);
  const [selectedId, setSelectedId] = React.useState(null);
  const mod = repos.find((m) => m.id === selectedId) || repos[0] || null;
  const [filter, setFilter] = React.useState("all");
  const [rowKey, setRowKey] = React.useState(null);

  const groups = commitsOf(mod);
  const rows = groups.flatMap((g) => g.rows);
  const row = rows.find((r) => r.key === rowKey) || null;
  const { linked, total } = coverage(mod);
  const missing = total - linked;
  const entireOn = mod?.partners?.entire?.enabled !== false;

  React.useEffect(() => { setRowKey(null); setFilter("all"); }, [mod?.id]);

  const shown = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => filter === "all" || (filter === "missing" && !r.checkpoint) || (filter === "failed" && !r.ok)) }))
    .filter((g) => g.rows.length);

  return (
    <div className="view ent-view">
      <PageHead title="Entire" sub="Every agent commit, linked to the Entire checkpoint of the session that wrote it." />

      {!repos.length ? (
        <section className="panel pad">
          <Empty>No mod repositories yet. Each mod gets its own git repository with Entire enabled.</Empty>
        </section>
      ) : (
        <div className="ent-layout">
          {/* Repositories */}
          <nav className="ent-repos" aria-label="Mod repositories">
            <span className="ent-label">Repositories</span>
            {repos.map((m) => {
              const c = coverage(m);
              const gap = c.total - c.linked;
              return (
                <button key={m.id} className={`ent-repo ${m.id === mod?.id ? "active" : ""}`} onClick={() => setSelectedId(m.id)}>
                  <span className="ent-repo-name">{m.name}</span>
                  <span className={`ent-badge ${gap ? "warn" : c.total ? "ok" : ""}`} title={`${c.linked} of ${c.total} commits linked`}>
                    {c.linked}/{c.total}
                  </span>
                  <small>{ago(m.createdAt)} ago</small>
                </button>
              );
            })}
          </nav>

          {/* Timeline */}
          <section className="ent-main">
            <header className="ent-head">
              <div>
                <div className="run-name">
                  <h2>{mod.name}</h2>
                  <Status status={mod.running ? "running" : mod.status} />
                </div>
                <div className="ent-stats">
                  <span className={`ent-stat ${missing ? "warn" : "ok"}`}>
                    <strong>{linked}/{total}</strong> commits linked
                  </span>
                  <span className="ent-stat"><strong>{groups.length}</strong> attempts</span>
                  {!entireOn && <span className="ent-stat warn">Entire is off for this repo</span>}
                </div>
              </div>
              <div className="page-actions">
                <button className="btn" onClick={() => onOpenMod(mod.id)}><Icon name="code" size={14} />Open mod</button>
                <button className="btn" onClick={() => call("open-path", mod.repoDir)}><Icon name="folder" size={14} />Repository</button>
              </div>
            </header>

            {missing > 0 && (
              <div className="ent-alert" role="alert">
                <Icon name="alert" size={14} />
                <span>
                  {missing} commit{missing === 1 ? " has" : "s have"} no Entire checkpoint, so {missing === 1 ? "its" : "their"} session history is missing.
                </span>
                <button className="ent-link" onClick={() => setFilter("missing")}>Show {missing === 1 ? "it" : "them"}</button>
              </div>
            )}

            <div className="ent-filters" role="tablist">
              {[["all", `All (${total})`], ["missing", `Missing checkpoint (${missing})`], ["failed", `Failed (${rows.filter((r) => !r.ok).length})`]].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>

            <ol className="ent-timeline">
              {shown.map((g) => (
                <li key={g.n} className="ent-attempt">
                  <div className="ent-attempt-head">
                    <span>Attempt {g.n}</span>
                    <Status status={g.status} />
                  </div>
                  {g.rows.map((r) => (
                    <button key={r.key} className={`ent-row ${r.ok ? "ok" : "bad"} ${r.key === rowKey ? "active" : ""}`} onClick={() => setRowKey(r.key)}>
                      <span className={`ent-kind ${r.kind}`}>{r.kind === "playtest" ? "Playtest" : "Code"}</span>
                      <span className="ent-row-label">{r.label}</span>
                      <code className="ent-sha">{shortSha(r.sha)}</code>
                      {r.checkpoint ? (
                        <span className="ent-chip"><i />{r.checkpoint.slice(0, 10)}…</span>
                      ) : (
                        <span className="ent-chip missing"><Icon name="alert" size={12} />No checkpoint</span>
                      )}
                    </button>
                  ))}
                </li>
              ))}
              {!shown.length && <Empty>{total ? "Nothing matches this filter." : "Commits appear here as each attempt finishes."}</Empty>}
            </ol>
          </section>

          {/* Detail */}
          <aside className="ent-detail">
            {row ? <Detail key={`${mod.id}:${row.key}`} mod={mod} row={row} /> : (
              <div className="ent-detail-empty">
                <Icon name="info" size={18} />
                <p>Select a commit to see its checkpoint: agent, model, session, tokens, files and the code change.</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Detail({ mod, row }) {
  const [cp, setCp] = React.useState(null);
  const [diff, setDiff] = React.useState(null);
  React.useEffect(() => {
    setCp(null);
    setDiff(null);
    if (row.checkpoint) call("studio:checkpoint", { id: mod.id, checkpointId: row.checkpoint }).then(setCp).catch((e) => setCp({ ok: false, error: e.message }));
  }, [mod.id, row.key, row.checkpoint]);

  const session = cp?.ok ? cp.sessions?.[0] : null;
  const tokens = cp?.ok
    ? (cp.sessions || []).reduce((n, s) => n + (s.token_usage?.input_tokens || 0) + (s.token_usage?.output_tokens || 0) + (s.token_usage?.cache_read_tokens || 0), 0)
    : 0;

  return (
    <div className="ent-detail-body">
      <span className="ent-label">{row.label}</span>
      <dl className="ent-facts">
        <dt>Commit</dt>
        <dd><code>{shortSha(row.sha)}</code><Copy text={row.sha} /></dd>
        <dt>Checkpoint</dt>
        <dd>
          {row.checkpoint ? <><code>{row.checkpoint}</code><Copy text={row.checkpoint} /></> : <span className="ent-chip missing">No checkpoint</span>}
        </dd>
        {session && (
          <>
            <dt>Agent</dt><dd>{session.agent}{session.model ? ` · ${shortModel(session.model)}` : ""}</dd>
            <dt>Session</dt><dd><code>{String(session.session_id).slice(0, 13)}…</code><Copy text={session.session_id} /></dd>
            <dt>Tokens</dt><dd>{tokens.toLocaleString()}</dd>
            <dt>When</dt><dd>{session.created_at ? new Date(session.created_at).toLocaleString() : "—"}</dd>
          </>
        )}
      </dl>

      {row.checkpoint && !cp && <p className="ent-muted">Reading checkpoint…</p>}
      {cp && !cp.ok && <div className="alert">{cp.error}</div>}
      {!row.checkpoint && (
        <p className="ent-muted">Entire did not link this commit to a session. The code is here, but there is no record of the agent's work behind it.</p>
      )}

      {cp?.ok && cp.files_touched?.length > 0 && (
        <>
          <span className="ent-label">Files ({cp.files_touched.length})</span>
          <ul className="ent-files">{cp.files_touched.map((f) => <li key={f}><Icon name="file" size={12} />{f}</li>)}</ul>
        </>
      )}

      <div className="ent-actions">
        <button className="btn" onClick={() => call("studio:diff", { id: mod.id, sha: row.sha }).then(setDiff).catch((e) => setDiff(`Could not load the diff: ${e.message}`))}>
          <Icon name="code" size={14} />{diff ? "Reload change" : "Show code change"}
        </button>
        {row.checkpoint && <Copy text={`entire checkpoint explain ${row.checkpoint}`} label="Copy explain command" />}
      </div>
      {diff && <pre className="ent-diff">{diff}</pre>}
    </div>
  );
}

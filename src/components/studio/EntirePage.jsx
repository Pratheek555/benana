import React from "react";
import { call } from "../../api.js";
import { shortModel, shortSha } from "./shared.jsx";
import "./entire.css";
import GraphWindow from "./GraphWindow.jsx";

const IDLE = Object.freeze({ state: "idle" });

function Icon({ name, size = 16 }) {
  const paths = {
    search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.1 3.1" /></>,
    arrow: <path d="M4 8h8m-3.5-3.5L12 8l-3.5 3.5" />,
    back: <path d="M12 8H4m3.5-3.5L4 8l3.5 3.5" />,
    retry: <><path d="M12.5 6A5 5 0 1 0 13 9" /><path d="M9.5 3.5h3v3" /></>,
    chevron: <path d="m5 6.5 3 3 3-3" />,
    check: <path d="M4 8.5 6.8 11 12 5.5" />,
    close: <path d="m4.5 4.5 7 7m0-7-7 7" />,
    copy: <><rect x="5.5" y="5.5" width="7" height="7" rx="1.5" /><path d="M10.5 5.5V4a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h1.5" /></>,
    folder: <path d="M2.5 4.5a1 1 0 0 1 1-1h2.8l1.4 1.5h4.8a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
    branch: <path d="M4 2.2v7.8M12 6c0 3.3-2.7 6-6 6M13.8 4a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0ZM5.8 12a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0Z" />,
    checkpoint: <><path d="M1 8h4.2M10.8 8H15" /><path d="M8 5.2 10.8 8 8 10.8 5.2 8z" /></>,
    session: <path d="M13.5 10.5a1 1 0 0 1-1 1H5.2l-2.2 2V3.5a1 1 0 0 1 1-1h8.5a1 1 0 0 1 1 1z" />,
    commit: <><circle cx="8" cy="8" r="2.6" /><path d="M1 8h4.4M10.6 8H15" /></>,
  };
  return <svg className="en-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">{paths[name]}</svg>;
}

const KIND = { builder: "Builder", fixer: "Fixer", seeded: "Seeded", playtest: "Playtest", scaffold: "Scaffold", commit: "Commit" };
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const dayOf = (date) => new Date(date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
const timeOf = (date) => new Date(date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const sameSha = (a, b) => Boolean(a && b && (a.startsWith(b) || b.startsWith(a)));

function describe(commit, mod) {
  const playtest = mod.attempts.find((a) => sameSha(commit.sha, a.playtestCommit?.sha));
  if (playtest) return { kind: "playtest", title: `Playtest ${playtest.n}`, outcome: playtest.verdict?.passed ? "passed" : "failed", attempt: playtest };
  const attempt = mod.attempts.find((a) => sameSha(commit.sha, a.commit?.sha));
  if (attempt) return { kind: KIND[attempt.role] ? attempt.role : "builder", title: `Attempt ${attempt.n}`, outcome: attempt.failure?.kind === "build" ? "failed" : null, attempt };
  const pt = /^Playtest attempt (\d+): (PASS|FAIL)/i.exec(commit.subject);
  if (pt) return { kind: "playtest", title: `Playtest ${pt[1]}`, outcome: pt[2].toUpperCase() === "PASS" ? "passed" : "failed" };
  const at = /^Attempt (\d+) \((\w+)\)/.exec(commit.subject);
  if (at) return { kind: KIND[at[2]] ? at[2] : "builder", title: `Attempt ${at[1]}` };
  if (/^Scaffold /.test(commit.subject)) return { kind: "scaffold", title: "Scaffold" };
  return { kind: "commit", title: shortSha(commit.sha) };
}

function parsePatch(text) {
  const files = [];
  let file = null, oldN = 0, newN = 0;
  for (const line of (text || "").split("\n")) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) { file = { path: head[2], lines: [] }; files.push(file); continue; }
    if (!file || /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity |rename |\\ No newline)/.test(line)) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) { oldN = Number(hunk[1]); newN = Number(hunk[2]); file.lines.push({ kind: "hunk", text: line }); continue; }
    if (line.startsWith("@@")) { file.lines.push({ kind: "hunk", text: line }); continue; }
    if (line.startsWith("+")) file.lines.push({ kind: "add", text: line.slice(1), newN: newN++ });
    else if (line.startsWith("-")) file.lines.push({ kind: "del", text: line.slice(1), oldN: oldN++ });
    else file.lines.push({ kind: "ctx", text: line.slice(1), oldN: oldN++, newN: newN++ });
  }
  for (const f of files) while (f.lines.length && f.lines.at(-1).kind === "ctx" && !f.lines.at(-1).text) f.lines.pop();
  return files;
}

function useCopy() {
  const [copied, setCopied] = React.useState(null);
  const timer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (value) => {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(value);
      setCopied(value);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  };
  return [copied, copy];
}

function Delta({ commit }) {
  return <span className="en-delta"><b className="add">+{commit.additions.toLocaleString()}</b><i>/</i><b className="del">-{commit.deletions.toLocaleString()}</b></span>;
}

function KindBadge({ info }) {
  return <span className={`en-kind ${info.kind}${info.outcome ? ` ${info.outcome}` : ""}`}>{info.outcome && <i />}{KIND[info.kind]}</span>;
}

function TokenBar({ usage }) {
  const parts = [
    ["input", "Input", usage.input_tokens || 0],
    ["write", "Cache write", usage.cache_creation_tokens || 0],
    ["read", "Cache read", usage.cache_read_tokens || 0],
    ["output", "Output", usage.output_tokens || 0],
  ];
  const total = parts.reduce((n, [, , v]) => n + v, 0);
  return (
    <div className="en-tokens">
      <div className="en-token-bar" aria-hidden="true">{total > 0 && parts.map(([key, , v]) => v > 0 && <i className={key} style={{ flexGrow: v }} key={key} />)}</div>
      <dl>{parts.map(([key, label, v]) => <div key={key}><dt><i className={key} />{label}</dt><dd>{v.toLocaleString()}</dd></div>)}</dl>
    </div>
  );
}

function FileDiff({ file, stat, initiallyOpen }) {
  const [open, setOpen] = React.useState(initiallyOpen);
  return (
    <section className={`en-file${open ? " open" : ""}`}>
      <button className="en-file-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chevron" size={13} />
        <span className="en-file-path"><span>{file.path.slice(0, file.path.lastIndexOf("/") + 1)}</span>{file.path.slice(file.path.lastIndexOf("/") + 1)}</span>
        {stat && <Delta commit={stat} />}
      </button>
      {open && (
        <div className="en-diff" role="table" aria-label={`Changes to ${file.path}`}>
          {file.lines.map((line, i) => line.kind === "hunk"
            ? <div className="en-diff-line hunk" key={i}><span className="en-ln" /><span className="en-ln" /><code>{line.text}</code></div>
            : <div className={`en-diff-line ${line.kind}`} key={i}><span className="en-ln">{line.oldN ?? ""}</span><span className="en-ln">{line.newN ?? ""}</span><code>{line.text || " "}</code></div>)}
          {!file.lines.length && <div className="en-diff-note">Binary file or mode change only.</div>}
        </div>
      )}
    </section>
  );
}

function Changes({ mod, commit }) {
  const [patch, setPatch] = React.useState({ state: "loading" });
  React.useEffect(() => {
    let current = true;
    setPatch({ state: "loading" });
    call("studio:diff", { id: mod.id, sha: commit.sha })
      .then((text) => { if (current) setPatch({ state: "ready", files: parsePatch(text) }); })
      .catch((e) => { if (current) setPatch({ state: "error", error: e.message }); });
    return () => { current = false; };
  }, [mod.id, commit.sha]);
  return (
    <section className="en-section">
      <div className="en-section-head"><span className="en-label">Changes</span><span className="en-count">{plural(commit.files.length, "file")}</span><Delta commit={commit} /></div>
      {patch.state === "loading" && <div className="en-loading"><i /><span>Reading the commit</span></div>}
      {patch.state === "error" && <div className="en-message error"><h4>Could not read the commit</h4><p>{patch.error}</p></div>}
      {patch.state === "ready" && (patch.files.length
        ? <div className="en-files">{patch.files.map((file, i) => {
            const stat = commit.files.find((f) => f.path === file.path);
            return <FileDiff file={file} stat={stat} initiallyOpen={i < 3 && file.lines.length < 400} key={file.path} />;
          })}</div>
        : <div className="en-message"><p>This commit changes no files.</p></div>)}
    </section>
  );
}

function Trail({ commit, checkpoint, sessions }) {
  return (
    <div className="en-trail" aria-label="Commit, checkpoint and sessions">
      <span className="en-pill commit"><Icon name="commit" size={14} /><code>{shortSha(commit.sha)}</code><span>{commit.subject}</span></span>
      <i className="en-sync" />
      <span className={`en-node${checkpoint ? "" : " empty"}`} title={checkpoint || "No checkpoint"}><Icon name="checkpoint" size={16} /></span>
      <i className="en-sync" />
      <span className="en-pill"><Icon name="session" size={14} />{checkpoint ? (sessions == null ? "Sessions" : plural(sessions, "session")) : "No session"}</span>
    </div>
  );
}

function CheckpointView({ mod, branch, commit, info, lookup, commits, onRetry, onClose, onOpenMod, onOpenGraph, onSelect }) {
  const [copied, copy] = useCopy();
  const cp = lookup.item || null;
  const sessions = cp?.sessions || [];
  const usage = sessions.reduce((sum, s) => {
    for (const [k, v] of Object.entries(s.token_usage || {})) sum[k] = (sum[k] || 0) + (v || 0);
    return sum;
  }, {});
  const tokens = (usage.input_tokens || 0) + (usage.cache_creation_tokens || 0) + (usage.cache_read_tokens || 0) + (usage.output_tokens || 0);
  const agents = [...new Set(sessions.map((s) => s.agent).filter(Boolean))];
  const models = [...new Set(sessions.map((s) => shortModel(s.model)).filter(Boolean))];
  const pending = commit.checkpoint && !cp;
  const read = info.kind === "fixer" ? info.attempt?.context : null;
  const readBy = commit.checkpoint ? mod.attempts.filter((a) => a.context?.checkpoints?.some((c) => c.id === commit.checkpoint)) : [];
  const commitFor = (id) => commits.find((c) => c.checkpoint === id);
  const stats = [
    ["Agent", agents.join(", ") || (pending ? "…" : "—"), models.join(", ") || (commit.checkpoint ? "Model not reported" : "No agent session")],
    ["Tokens", cp ? tokens.toLocaleString() : pending ? "…" : "—", cp ? `${(usage.input_tokens || 0).toLocaleString()} in · ${((usage.cache_creation_tokens || 0) + (usage.cache_read_tokens || 0)).toLocaleString()} cache · ${(usage.output_tokens || 0).toLocaleString()} out` : "From the checkpoint"],
    ["API calls", cp ? (usage.api_call_count || 0).toLocaleString() : pending ? "…" : "—", cp ? `Across ${plural(sessions.length, "session")}` : "From the checkpoint"],
  ];

  return (
    <section className="en-cp-view" aria-label="Commit checkpoint">
      <header className="en-cp-head">
        <div className="en-cp-title">
          <span className="en-crumbs">{mod.name}<i>/</i><Icon name="branch" size={12} />{branch}<i>/</i><code>{shortSha(commit.sha)}</code></span>
          <h2>{info.title}<KindBadge info={info} /></h2>
          <p>{commit.subject}</p>
        </div>
        <div className="en-cp-actions">
          {commit.checkpoint && <button className="en-icon-button" onClick={onRetry} disabled={lookup.state === "loading"} title="Refresh checkpoint" aria-label="Refresh checkpoint"><Icon name="retry" size={14} /></button>}
          <button className="en-button" onClick={() => onOpenGraph(mod)}>View graph</button>
          <button className="en-button" onClick={() => onOpenMod(mod.id)}>Open mod <Icon name="arrow" size={14} /></button>
          <button className="en-icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close commit"><Icon name="close" size={14} /></button>
        </div>
      </header>

      <dl className="en-stats">
        <div className="en-stat-id">
          <dt>Checkpoint</dt>
          <dd>{commit.checkpoint ? <><Icon name="checkpoint" size={14} /><code title={commit.checkpoint}>{commit.checkpoint}</code><button className="en-icon-button small" onClick={() => copy(commit.checkpoint)} aria-label="Copy checkpoint ID" title={copied === commit.checkpoint ? "Copied" : "Copy"}><Icon name={copied === commit.checkpoint ? "check" : "copy"} size={13} /></button></> : <span className="en-none">None</span>}</dd>
          <small>{copied === commit.checkpoint ? "Copied" : commit.checkpoint ? "Entire-Checkpoint trailer" : "This commit has no trailer"}</small>
        </div>
        {stats.map(([label, value, sub]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><small>{sub}</small></div>)}
        <div><dt>Changes</dt><dd><Delta commit={commit} /></dd><small>{plural(commit.files.length, "file")} · {timeOf(commit.date)}</small></div>
      </dl>

      <div className="en-cp-body">
        <Trail commit={commit} checkpoint={commit.checkpoint} sessions={cp ? sessions.length : null} />

        {!commit.checkpoint && (
          <div className="en-message">
            <h4>No checkpoint on this commit</h4>
            <p>{info.kind === "scaffold" ? "Benana created this commit from the Paper template before any agent ran, so there is no session to link." : "Entire adds a checkpoint when an agent session in this repository leads to the commit. This one had none."}</p>
          </div>
        )}

        {commit.checkpoint && (
          <section className="en-section">
            <div className="en-section-head"><span className="en-label">Sessions</span>{cp && <span className="en-count">{sessions.length}</span>}{readBy.length > 0 && <span className="en-read-by"><Icon name="check" size={12} />Read by {readBy.map((a) => `Fixer ${a.n}`).join(", ")} before it changed the plugin</span>}</div>
            {(lookup.state === "idle" || (lookup.state === "loading" && !cp)) && <div className="en-loading"><i /><span>Reading the checkpoint from Entire</span></div>}
            {lookup.state === "error" && <div className="en-message error"><h4>Checkpoint lookup failed</h4><p>{lookup.error}</p><button onClick={onRetry}><Icon name="retry" size={14} /> Retry</button></div>}
            {lookup.state === "loading" && cp && <div className="en-refreshing"><i />Refreshing checkpoint</div>}
            {cp && sessions.map((s) => (
              <article className="en-session" key={s.session_id || s.index}>
                <header>
                  <span className={`en-agent${/claude/i.test(s.agent || "") ? " claude" : ""}`}>{s.agent || "Agent"}</span>
                  {s.model && <code className="en-model">{s.model}</code>}
                  {s.created_at && <time>{timeOf(s.created_at)}</time>}
                  <span className="en-session-id"><code title={s.session_id}>{s.session_id}</code>{s.session_id && <button className="en-icon-button small" onClick={() => copy(s.session_id)} aria-label="Copy session ID" title={copied === s.session_id ? "Copied" : "Copy"}><Icon name={copied === s.session_id ? "check" : "copy"} size={13} /></button>}</span>
                </header>
                <TokenBar usage={s.token_usage || {}} />
                {s.files_touched?.length > 0 && <div className="en-touched"><span>Files touched</span><ul>{s.files_touched.map((f) => <li key={f}><code>{f}</code></li>)}</ul></div>}
              </article>
            ))}
            {cp && !sessions.length && <div className="en-message"><p>Entire recorded no sessions for this checkpoint.</p></div>}
            {cp?.tasks?.length > 0 && <p className="en-tasks">{plural(cp.tasks.length, "subagent task")} captured in this checkpoint.</p>}
          </section>
        )}

        {read?.checkpoints?.length > 0 && (
          <section className="en-section">
            <div className="en-section-head"><span className="en-label">Read before fixing</span><span className="en-count">{read.entireCheckpoints ?? read.checkpoints.length}</span></div>
            <p className="en-section-sub">The fixer read {plural(read.entireCheckpoints ?? read.checkpoints.length, "checkpoint")} from this repository before it changed the plugin. The latest are below.</p>
            <ol className="en-read">{read.checkpoints.map((c) => {
              const target = commitFor(c.id);
              return <li key={c.id}><button disabled={!target} onClick={() => target && onSelect(target.sha)}><Icon name="checkpoint" size={14} /><code>{c.id.slice(0, 12)}</code><span>{c.message}</span>{target && <Icon name="arrow" size={13} />}</button></li>;
            })}</ol>
          </section>
        )}

        <Changes mod={mod} commit={commit} />
      </div>
    </section>
  );
}

function groupByDay(commits) {
  return [...commits.reduce((groups, c) => {
    const day = dayOf(c.date);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(c);
    return groups;
  }, new Map())];
}

export default function EntirePage({ mods, onOpenMod }) {
  const repos = mods.filter((m) => m.repoDir);
  const [repoId, setRepoId] = React.useState(null);
  const mod = repos.find((m) => m.id === repoId) || repos[0] || null;
  const [graphMod, setGraphMod] = React.useState(null);
  const [cli, setCli] = React.useState({ state: "loading" });
  const [logs, setLogs] = React.useState({});
  const logRequests = React.useRef({});
  const [checkpoints, setCheckpoints] = React.useState({});
  const [selectedSha, setSelectedSha] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const railRef = React.useRef(null);
  const commitCount = mod ? mod.attempts.reduce((n, a) => n + (a.commit?.sha ? 1 : 0) + (a.playtestCommit?.sha ? 1 : 0), 0) : 0;

  React.useEffect(() => {
    call("studio:partners").then((p) => setCli({ state: "ready", value: p.entire })).catch((e) => setCli({ state: "error", error: e.message }));
  }, []);

  const loadLog = React.useCallback((target) => {
    const request = (logRequests.current[target.id] || 0) + 1;
    logRequests.current[target.id] = request;
    setLogs((all) => ({ ...all, [target.id]: { ...all[target.id], state: "loading" } }));
    call("studio:commits", { id: target.id })
      .then((res) => {
        if (logRequests.current[target.id] !== request) return;
        setLogs((all) => ({ ...all, [target.id]: res.ok ? { state: "ready", branch: res.branch, items: res.items } : { ...all[target.id], state: "error", error: res.error } }));
      })
      .catch((e) => {
        if (logRequests.current[target.id] !== request) return;
        setLogs((all) => ({ ...all, [target.id]: { ...all[target.id], state: "error", error: e.message } }));
      });
  }, []);

  React.useEffect(() => { if (mod) loadLog(mod); }, [mod?.id, commitCount, loadLog]);

  const log = (mod && logs[mod.id]) || IDLE;
  const commits = log.items || [];
  const branch = log.branch || "main";
  const described = React.useMemo(() => new Map(commits.map((c) => [c.sha, describe(c, mod)])), [commits, mod]);
  const selected = commits.find((c) => c.sha === selectedSha) || null;
  const cpKey = selected?.checkpoint && `${mod.id}:${selected.checkpoint}`;

  const loadCheckpoint = React.useCallback((target, commit) => {
    const key = `${target.id}:${commit.checkpoint}`;
    setCheckpoints((all) => ({ ...all, [key]: { ...all[key], state: "loading" } }));
    call("studio:checkpoint", { id: target.id, checkpoint: commit.checkpoint })
      .then((res) => setCheckpoints((all) => ({ ...all, [key]: res.ok ? { state: "ready", item: res.item } : { ...all[key], state: "error", error: res.error } })))
      .catch((e) => setCheckpoints((all) => ({ ...all, [key]: { ...all[key], state: "error", error: e.message } })));
  }, []);

  React.useEffect(() => {
    if (cpKey && !checkpoints[cpKey]) loadCheckpoint(mod, selected);
  }, [cpKey]);

  const filtered = commits.filter((c) => {
    const info = described.get(c.sha);
    const haystack = [c.sha, c.subject, c.checkpoint, info.title, KIND[info.kind]].filter(Boolean).join(" ").toLowerCase();
    const kindOk = filter === "all" || (filter === "code" && ["builder", "fixer", "seeded"].includes(info.kind)) || (filter === "playtest" && info.kind === "playtest") || (filter === "unlinked" && !c.checkpoint);
    return kindOk && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  });

  React.useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest?.("input, select, textarea, [contenteditable]")) return;
      if (event.key === "Escape") { setSelectedSha(null); return; }
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
      const index = filtered.findIndex((c) => c.sha === selected.sha);
      const next = step && (index < 0 ? filtered[step > 0 ? 0 : filtered.length - 1] : filtered[index + step]);
      if (next) { event.preventDefault(); setSelectedSha(next.sha); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, filtered]);

  React.useEffect(() => { railRef.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" }); }, [selectedSha]);

  const pickRepo = (id) => { setRepoId(id); setSelectedSha(null); };
  const clearFilters = () => { setQuery(""); setFilter("all"); };

  const allCommits = mods.flatMap((m) => m.attempts.flatMap((a) => [a.commit, a.playtestCommit].filter((c) => c?.sha)));
  const linked = allCommits.filter((c) => c.checkpoint).length;
  const enabled = repos.filter((m) => m.partners?.entire?.enabled).length;
  const fixes = mods.flatMap((m) => m.attempts.filter((a) => a.context?.entireCheckpoints != null));
  const read = fixes.reduce((n, a) => n + a.context.entireCheckpoints, 0);
  const playtests = mods.reduce((n, m) => n + m.attempts.filter((a) => a.playtestCommit?.sha).length, 0);

  const value = cli.state === "ready" ? cli.value : null;
  const cliKind = cli.state === "loading" ? "loading" : cli.state === "error" || !value?.installed ? "missing" : enabled || !repos.length ? "connected" : "off";
  const cliLabel = { loading: "Checking Entire CLI", missing: "Entire CLI not installed", off: "Not enabled in mod repositories", connected: `Entire CLI ${value?.version || ""}`.trim() }[cliKind];
  const cliDetail = cli.state === "error" ? cli.error : cliKind === "missing" ? value?.error || "Install the Entire CLI so each agent commit gets a checkpoint." : null;

  const search = <label className="en-search"><Icon name="search" size={15} /><span className="sr-only">Search commits</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commits" /></label>;
  const repoPicker = mod && (
    <label className="en-repo-picker">
      <Icon name="folder" size={14} />
      <span className="sr-only">Repository</span>
      <select value={mod.id} onChange={(event) => pickRepo(event.target.value)}>{repos.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select>
      <Icon name="chevron" size={13} />
    </label>
  );

  return (
    <div className={`view entire-page${selected ? " inspecting" : ""}`}>
      <header className="en-header">
        <div className="en-heading"><span className="en-mark" aria-hidden="true"><Icon name="checkpoint" size={20} /></span><div><h1>Entire</h1><p>Every agent commit, linked to the session that wrote it.</p></div></div>
        <div className={`en-connection ${cliKind}`} title={cliDetail || cliLabel}><i /><span>{cliLabel}</span></div>
      </header>
      {cliDetail && <div className={`en-connection-detail ${cliKind}`}>{cliDetail}</div>}

      {selected ? (
        <div className="en-focus">
          <aside className="en-rail" aria-label="Commits">
            <button className="en-back" onClick={() => setSelectedSha(null)}><Icon name="back" size={14} />Commits</button>
            <div className="en-rail-head">{repoPicker}<span className="en-branch"><Icon name="branch" size={12} />{branch}</span></div>
            <div className="en-rail-search">{search}</div>
            <div className="en-rail-list" ref={railRef}>
              {groupByDay(filtered).map(([day, list]) => (
                <section key={day}>
                  <h3>{day}</h3>
                  <ol>{list.map((c) => {
                    const info = described.get(c.sha);
                    return <li key={c.sha}><button className={`${c.sha === selected.sha ? "active" : ""}${info.outcome === "failed" ? " failed" : ""}`} aria-current={c.sha === selected.sha} onClick={() => setSelectedSha(c.sha)}>
                      <code>{shortSha(c.sha)}</code>
                      <span>{info.title}{info.kind !== "playtest" && info.kind !== "commit" && info.kind !== "scaffold" && <small>{KIND[info.kind]}</small>}</span>
                      {c.checkpoint ? <span className="en-rail-cp" title={c.checkpoint}><Icon name="checkpoint" size={13} /></span> : <span className="en-rail-cp none" title="No checkpoint" />}
                    </button></li>;
                  })}</ol>
                </section>
              ))}
              {!filtered.length && <p className="en-rail-empty">No commits match. <button onClick={clearFilters}>Clear filters</button></p>}
            </div>
          </aside>
          <CheckpointView mod={mod} branch={branch} commit={selected} info={described.get(selected.sha)} lookup={(cpKey && checkpoints[cpKey]) || IDLE} commits={commits}
            onRetry={() => selected.checkpoint && loadCheckpoint(mod, selected)} onClose={() => setSelectedSha(null)} onOpenMod={onOpenMod} onOpenGraph={setGraphMod} onSelect={setSelectedSha} />
        </div>
      ) : <>
        <section className="en-kpis" aria-label="Entire summary">
          <article><span>Repositories</span><strong>{repos.length.toLocaleString()}</strong><small>{repos.length ? `${enabled} with Entire enabled` : "One per mod"}</small></article>
          <article><span>Agent commits</span><strong>{allCommits.length.toLocaleString()}</strong><small>{allCommits.length - playtests} code · {playtests} playtest</small></article>
          <article><span>Checkpoint coverage</span><strong>{allCommits.length ? `${Math.round((linked / allCommits.length) * 100)}%` : "—"}</strong><small>{linked} of {plural(allCommits.length, "commit")} linked</small></article>
          <article><span>Read by the fixer</span><strong>{read.toLocaleString()}</strong><small>{fixes.length ? `Checkpoints across ${plural(fixes.length, "fix attempt")}` : "No fix attempts yet"}</small></article>
        </section>

        <section className="en-browser" aria-label="Commits">
          {!mod ? (
            <div className="en-empty"><Icon name="checkpoint" size={24} /><h3>No repositories yet</h3><p>Each mod gets its own git repository with Entire enabled. Its commits appear here.</p></div>
          ) : <>
            <div className="en-browser-head">
              <div>{repoPicker}<span className="en-branch"><Icon name="branch" size={12} />{branch}</span></div>
              <div>
                <span className="en-browser-count">{plural(commits.length, "commit")}</span>
                <button className="en-icon-button" onClick={() => loadLog(mod)} disabled={log.state === "loading"} title="Refresh commits" aria-label="Refresh commits"><Icon name="retry" size={14} /></button>
                <button className="en-button" onClick={() => call("open-path", mod.repoDir)}><Icon name="folder" size={14} />Repository</button>
              </div>
            </div>
            <div className="en-toolbar">
              {search}
              <div className="en-segments" aria-label="Filter commits">{[["all", "All"], ["code", "Code"], ["playtest", "Playtests"], ["unlinked", "No checkpoint"]].map(([key, label]) => <button className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)} key={key}>{label}</button>)}</div>
            </div>
            <div className="en-list">
              {log.state === "error" && commits.length > 0 && <div className="en-inline-error"><span>Refresh failed. Showing the last commit list.</span><button onClick={() => loadLog(mod)}>Retry</button></div>}
              {log.state === "error" && !commits.length ? <div className="en-message error inset"><h4>Could not read the repository</h4><p>{log.error}</p><button onClick={() => loadLog(mod)}><Icon name="retry" size={14} /> Retry</button></div>
                : !log.items ? <div className="en-loading inset"><i /><span>Reading commits</span></div>
                : !commits.length ? <div className="en-empty"><Icon name="commit" size={24} /><h3>No commits yet</h3><p>Commits appear here as each attempt finishes.</p></div>
                : !filtered.length ? <div className="en-empty"><Icon name="search" size={22} /><h3>No commits match</h3><p>Clear the filters to see every commit.</p><button onClick={clearFilters}>Clear filters</button></div>
                : groupByDay(filtered).map(([day, list]) => (
                  <section className="en-day" key={day}>
                    <div className="en-day-head"><span>{day}</span><span>{plural(list.length, "commit")}</span></div>
                    <ul>{list.map((c) => {
                      const info = described.get(c.sha);
                      return <li key={c.sha}><button className="en-row" onClick={() => setSelectedSha(c.sha)}>
                        <code className="en-sha">{shortSha(c.sha)}</code>
                        <span className="en-subject">{c.subject}</span>
                        <KindBadge info={info} />
                        <span className={`en-cp${c.checkpoint ? "" : " none"}`} title={c.checkpoint || "No checkpoint"}>{c.checkpoint ? <><Icon name="checkpoint" size={13} />1 checkpoint</> : "No checkpoint"}</span>
                        <Delta commit={c} />
                        <span className="en-nfiles">{plural(c.files.length, "file")}</span>
                        <span className="en-open"><Icon name="arrow" size={14} /></span>
                      </button></li>;
                    })}</ul>
                  </section>
                ))}
            </div>
          </>}
        </section>
      </>}
      {graphMod && <GraphWindow mod={graphMod} onClose={() => setGraphMod(null)} />}
    </div>
  );
}

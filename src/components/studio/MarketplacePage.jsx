import React from "react";
import { call, ago } from "../../api.js";
import { fmtDuration } from "./shared.jsx";
import "./marketplace.css";

// Marketplace: mods published from the Studio. Each listing is a public Entire repo (source, sanitized checkpoints, and a
// meta branch with the spec, test plan and evidence); Supabase holds the rows (listings, versions, votes). Remixing clones a
// version or checkpoint from Entire with that context, so the remixer's agents can build on top of it.

const since = (date) => (date ? `${ago(new Date(date).getTime())} ago` : "");
const short = (s, n = 10) => (s ? s.slice(0, n) : "");
const latest = (l) => l.versions?.[0] || null;
const originOf = (l) => l.versions?.find((v) => v.entire?.origin)?.entire?.origin || null;
const repoOf = (l) => l.versions?.find((v) => v.entire?.remote?.repo)?.entire?.remote?.repo || null;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Entire's mark, used once per surface to say where a mod lives.
const EntireMark = () => (
  <svg className="mk-mark" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h4.2M10.8 8H15M8 5.2 10.8 8 8 10.8 5.2 8z" /></svg>
);

function CopyText({ text, children }) {
  const [done, setDone] = React.useState(false);
  return (
    <button className="mk-textbtn" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1300); }); }}>
      {done ? "Copied" : children}
    </button>
  );
}

export default function MarketplacePage({ mods, onOpenMod = () => {} }) {
  const [state, setState] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [publishing, setPublishing] = React.useState(false);

  const load = React.useCallback(() => {
    setError("");
    call("market:list").then(setState).catch((e) => setError(e.message));
    call("market:status").then(setStatus).catch(() => setStatus({ entire: { loggedIn: false } }));
  }, []);
  React.useEffect(load, [load]);

  const listings = state?.listings || [];
  const remixesOf = React.useMemo(() => {
    const map = new Map();
    for (const l of listings) { const o = originOf(l); if (o?.slug) map.set(o.slug, [...(map.get(o.slug) || []), l]); }
    return map;
  }, [listings]);
  const listing = listings.find((l) => l.id === selected) || null;
  const filtered = listings.filter((l) => {
    const kind = filter === "all" || (filter === "remixes" && originOf(l)) || (filter === "tested" && latest(l)?.playtest_status === "passed");
    return kind && (!query.trim() || `${l.name} ${l.summary || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  });
  const entire = status?.entire;
  const signedIn = Boolean(entire?.loggedIn);

  React.useEffect(() => {
    if (!listing) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !e.target.closest?.("input, textarea")) setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listing]);

  return (
    <div className="view market-page">
      {listing ? (
        <ListingView listing={listing} listings={listings} remixes={remixesOf.get(listing.slug) || []} onSelect={setSelected} onBack={() => setSelected(null)} onOpenMod={onOpenMod} signedIn={signedIn} />
      ) : (
        <div className="mk-page">
          <header className="mk-head">
            <div>
              <h1>Marketplace</h1>
              <p>Mods built in Benana, hosted on <span className="mk-entire-name"><EntireMark />Entire</span> with their full agent history. Remix any of them.</p>
            </div>
            <button className="mk-btn primary" onClick={() => setPublishing(true)}>Publish</button>
          </header>
          {status && !signedIn && <p className="mk-note">Sign in to Entire (<code>entire login</code>) to publish or remix.</p>}
          {error && <p className="mk-note bad">{error}</p>}

          <div className="mk-bar">
            <nav className="mk-filters" aria-label="Filter">
              {[["all", "All", listings.length], ["tested", "Tested", null], ["remixes", "Remixes", null]].map(([value, label, n]) => (
                <button key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{n != null && <span>{n}</span>}</button>
              ))}
            </nav>
            <input className="mk-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search mods" />
          </div>

          {!state ? <p className="mk-empty">Loading…</p>
            : filtered.length ? (
              <ul className="mk-list">
                <li className="mk-list-head" aria-hidden="true"><span>Mod</span><span>Version</span><span>Checkpoints</span><span>Remixes</span><span>Playtest</span><span>Hosted</span></li>
                {filtered.map((l) => <ListingRow key={l.id} listing={l} remixes={(remixesOf.get(l.slug) || []).length} onOpen={() => setSelected(l.id)} />)}
              </ul>
            ) : <p className="mk-empty">{listings.length ? "No mods match." : "Nothing published yet."}</p>}
        </div>
      )}

      {publishing && <PublishSheet mods={mods} listings={listings} signedIn={signedIn} onClose={() => setPublishing(false)} onPublished={load} />}
    </div>
  );
}

function ListingRow({ listing, remixes, onOpen }) {
  const v = latest(listing);
  const origin = originOf(listing);
  const onEntire = Boolean(repoOf(listing));
  return (
    <li>
      <button className="mk-row" onClick={onOpen}>
        <div className="mk-row-main">
          <h3>{listing.name}{origin && <span className="mk-row-from">remix of {origin.name || origin.slug}</span>}</h3>
          <p>{listing.summary || "No description."}</p>
        </div>
        <span className="mk-num">v{v?.number || 0}</span>
        <span className="mk-num">{v?.checkpoint_count || 0}</span>
        <span className="mk-num">{remixes}</span>
        <span className={v?.playtest_status === "passed" ? "good" : "mk-dim"}>{v?.playtest_status === "passed" ? "Passed" : v?.playtest_status === "failed" ? "Failed" : "—"}</span>
        <span className={`mk-row-host${onEntire ? " on" : ""}`}>{onEntire ? <><EntireMark />Entire</> : "Local"}</span>
      </button>
    </li>
  );
}

// One line per checkpoint: what it did. AI summaries start with the agent's own framing ("Continue work on the existing
// GodMob Paper plugin (…)"), so keep the first clause; without a summary, name the files it touched.
function cpTitle(c) {
  const intent = c.summary?.intent?.split(/[(:;.—]/)[0]?.trim();
  if (intent) return intent;
  const names = (c.files || []).map((f) => f.split("/").pop());
  return names.length ? `Changed ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}` : "Checkpoint";
}

function ListingView({ listing, listings, remixes, onSelect, onBack, onOpenMod, signedIn }) {
  const [vn, setVn] = React.useState(latest(listing)?.number);
  const [open, setOpen] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => { setVn(latest(listing)?.number); setError(""); setOpen(null); }, [listing.id]);
  const version = listing.versions?.find((v) => v.number === vn) || latest(listing);
  const ent = version?.entire || {};
  const repo = ent.remote?.repo || null;
  const origin = originOf(listing);
  const parent = origin ? listings.find((l) => l.slug === origin.slug) : null;
  const canRemix = Boolean(repo && signedIn);
  const cps = [...(ent.checkpoints || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const remix = (checkpointId = null) => {
    setBusy(checkpointId || "version");
    setError("");
    call("market:open-checkpoint", { slug: listing.slug, number: version.number, checkpointId })
      .then((mod) => onOpenMod(mod.id))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <div className="mk-page">
      <button className="mk-crumb" onClick={onBack}>Marketplace</button>
      <header className="mk-head">
        <div>
          <h1>{listing.name}</h1>
          <p>{listing.summary}</p>
        </div>
        {canRemix && <button className="mk-btn primary" disabled={Boolean(busy)} onClick={() => remix(null)}>{busy === "version" ? "Cloning…" : `Remix v${version?.number}`}</button>}
      </header>
      {error && <p className="mk-note bad">{error}</p>}

      <div className="mk-columns">
        <section className="mk-main">
          <div className="mk-section-head">
            <h2>History</h2>
            <span>{plural(cps.length, "checkpoint")} recorded by Entire</span>
          </div>
          {cps.length ? (
            <ol className="mk-history">
              {cps.map((c) => (
                <li key={c.id} className={open === c.id ? "open" : ""}>
                  <div className="mk-commit">
                    <button className="mk-commit-main" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                      <span className="mk-commit-title">{cpTitle(c)}</span>
                      <span className="mk-commit-sub">{c.agent || "Agent"}{c.model ? ` · ${c.model.replace(/^claude-/, "")}` : ""} · {since(c.createdAt)}</span>
                    </button>
                    <code className="mk-sha" title={c.id}>{short(c.id, 8).toLowerCase()}</code>
                    {canRemix && c.commit && <button className="mk-btn small" disabled={Boolean(busy)} onClick={() => remix(c.id)}>{busy === c.id ? "Cloning…" : "Remix from here"}</button>}
                  </div>
                  {open === c.id && (
                    <div className="mk-commit-body">
                      {c.summary?.outcome && <p>{c.summary.outcome}</p>}
                      {c.files?.length > 0 && <ul className="mk-paths">{c.files.map((f) => <li key={f}>{f}</li>)}</ul>}
                      <p className="mk-dim">Checkpoint <code>{c.id}</code>{c.commit ? <> · commit <code>{short(c.commit, 7)}</code></> : null}{c.hasTranscript ? " · transcript published" : ""}</p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : <p className="mk-empty">No checkpoints in this version.</p>}
        </section>

        <aside className="mk-side">
          <section>
            <h4>Source</h4>
            {repo ? <>
              <p className="mk-host"><EntireMark />Hosted on Entire</p>
              <code className="mk-repo">{repo}</code>
              <div className="mk-repo-links">
                <button className="mk-textbtn" onClick={() => call("open-external", `https://entire.io${repo}`)}>View on Entire</button>
                <CopyText text={`entire repo clone ${repo}`}>Copy clone command</CopyText>
              </div>
            </> : <p className="mk-dim">Not on Entire yet. The creator needs to publish it again before it can be remixed.</p>}
          </section>
          <section>
            <h4>Version</h4>
            {listing.versions?.length > 1 ? (
              <select className="mk-select" value={version?.number} onChange={(e) => setVn(Number(e.target.value))}>{listing.versions.map((v) => <option key={v.id} value={v.number}>v{v.number} · {since(v.created_at)}</option>)}</select>
            ) : <p>v{version?.number} · {since(version?.created_at)}</p>}
          </section>
          <section>
            <h4>Playtest</h4>
            <p className={version?.playtest_status === "passed" ? "good" : ""}>{version?.playtest_status === "passed" ? "Passed every check" : version?.playtest_status === "failed" ? "Failed" : "Not playtested"}</p>
          </section>
          {origin && (
            <section>
              <h4>Remixed from</h4>
              {parent ? <button className="mk-textbtn" onClick={() => onSelect(parent.id)}>{origin.name || origin.slug} v{origin.version}</button> : <p>{origin.name || origin.slug} v{origin.version}</p>}
            </section>
          )}
          <section>
            <h4>Remixes</h4>
            {remixes.length ? <ul className="mk-links">{remixes.map((r) => <li key={r.id}><button className="mk-textbtn" onClick={() => onSelect(r.id)}>{r.name}</button></li>)}</ul> : <p className="mk-dim">None yet</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function PublishSheet({ mods, listings, signedIn, onClose, onPublished }) {
  const publishable = mods.filter((m) => m.repoDir && ["passed", "failed"].includes(m.status));
  const [summaries, setSummaries] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="mk-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="mk-sheet" role="dialog" aria-label="Publish">
        <header>
          <h2>Publish</h2>
          <button className="mk-textbtn" onClick={onClose}>Close</button>
        </header>
        <p className="mk-sheet-intro">Each mod goes to its own public repo on Entire, with its checkpoints. Paths, names and secrets are removed first.</p>
        {!signedIn && <p className="mk-note">Run <code>entire login</code> first.</p>}
        <label className="mk-check"><input type="checkbox" checked={summaries} onChange={(e) => setSummaries(e.target.checked)} />Write AI summaries for checkpoints</label>
        <ul className="mk-publist">
          {!publishable.length && <li className="mk-dim">Build and playtest a mod first.</li>}
          {publishable.map((m) => <PublishRow key={m.id} mod={m} published={listings.find((l) => l.slug === m.marketSlug)} disabled={!signedIn} summaries={summaries} onPublished={onPublished} />)}
        </ul>
      </aside>
    </div>
  );
}

function PublishRow({ mod, published, disabled, summaries, onPublished }) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [started, setStarted] = React.useState(0);
  const [, tick] = React.useState(0);
  React.useEffect(() => { if (!busy) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [busy]);
  const run = (metadataOnly) => {
    setBusy(true);
    setStarted(Date.now());
    setResult(null);
    call("market:publish", { id: mod.id, metadataOnly, withSummaries: summaries })
      .then((r) => { setResult(r); onPublished(); })
      .catch((e) => setResult({ ok: false, error: e.message }))
      .finally(() => setBusy(false));
  };
  const blocked = result && result.ok === false && result.blocked;
  const findings = blocked ? [...(result.gate?.findings || []), ...(result.gate?.suspicious || [])] : [];
  const last = published?.versions?.[0];
  const note = busy ? `Publishing… ${fmtDuration(Date.now() - started) || ""}`
    : result?.ok && !result.skipped ? `Published v${result.version.number}`
    : result?.ok ? "Already up to date"
    : last ? `v${last.number}, ${since(last.created_at)}` : mod.origin ? `Remix of ${mod.origin.name || mod.origin.marketplace}` : "Not published";
  return (
    <li>
      <div className="mk-pubrow">
        <div><strong>{mod.name}</strong><span className={result?.ok && !result.skipped ? "good" : ""}>{note}</span></div>
        <button className="mk-btn small" disabled={busy || disabled} onClick={() => run(false)}>{published ? "Update" : "Publish"}</button>
      </div>
      {result && !result.ok && !blocked && <p className="mk-note bad">{result.error}</p>}
      {blocked && (findings.length ? (
        <div className="mk-note bad">
          Blocked: {plural(findings.length, "possible secret")} in {[...new Set(findings.map((f) => f.file || "transcript"))].slice(0, 3).join(", ")}.
          {result.metadataOnlyPossible && <> <button className="mk-textbtn" disabled={busy} onClick={() => run(true)}>Publish without transcripts</button></>}
        </div>
      ) : (
        // No findings means the scan itself could not run; the gate fails closed.
        <p className="mk-note bad">Couldn't scan for secrets, so nothing was published. {result.gate?.error || "The secret scanner failed."}</p>
      ))}
    </li>
  );
}

import React from "react";
import { call, ago } from "../../api.js";
import { Empty, Icon, PageHead, Status } from "./shared.jsx";

// Marketplace: listings published from the Studio. Rows live in Supabase; the files live on this
// machine. Publishing runs the gate (sanitize, secret scan) and writes the evidence bundle.
export default function MarketplacePage({ mods }) {
  const [state, setState] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    call("market:list").then(setState).catch((e) => setError(e.message));
  }, []);
  React.useEffect(load, [load]);

  const listing = state?.listings?.find((l) => l.id === selected) || state?.listings?.[0] || null;
  const publishable = mods.filter((m) => m.repoDir && ["passed", "failed"].includes(m.status));

  return (
    <div className="view mk-view">
      <PageHead title="Marketplace" sub="Mods published from this Studio. Files stay on this machine; the listing rows are in Supabase." />
      {error && <div className="alert">{error}</div>}
      {state && !state.configured && <div className="alert">The marketplace is not configured. Add the Supabase keys to .env.</div>}

      <div className="mk-layout">
        <section className="mk-list" aria-label="Listings">
          <span className="ent-label">Listings ({state?.listings?.length ?? 0})</span>
          {!state && <p className="mk-muted">Loading…</p>}
          {state?.listings?.map((l) => (
            <button key={l.id} className={`mk-row ${listing?.id === l.id ? "active" : ""}`} onClick={() => setSelected(l.id)}>
              <strong>{l.name}</strong>
              <span>
                v{l.versions?.[0]?.number || 0} · {l.stats?.votes || 0} votes
                {l.stats?.stars ? ` · ${Number(l.stats.stars).toFixed(1)}★` : ""}
              </span>
              <small>{l.versions?.[0]?.playtest_status === "passed" ? "Playtest passed" : l.versions?.[0]?.playtest_status === "failed" ? "Playtest failed" : "Not playtested"}</small>
            </button>
          ))}
          {state?.listings && !state.listings.length && <Empty>Nothing published yet. Publish a mod from the panel on the right.</Empty>}
        </section>

        <section className="mk-detail">
          {listing ? <Listing listing={listing} onChanged={load} /> : <Empty>Select a listing.</Empty>}
        </section>

        <aside className="mk-publish">
          <span className="ent-label">Publish a mod</span>
          {!publishable.length && <p className="mk-muted">Finish a mod's build and playtest first. Only passed or failed mods can be published.</p>}
          {publishable.map((m) => (
            <PublishCard key={m.id} mod={m} published={state?.listings?.find((l) => l.name === m.name)} onPublished={load} />
          ))}
        </aside>
      </div>
    </div>
  );
}

const clip = (t, n) => (t.length <= n ? t : `${t.slice(0, t.lastIndexOf(' ', n) > 0 ? t.lastIndexOf(' ', n) : n)}…`);

function Listing({ listing, onChanged }) {
  const version = listing.versions?.[0];
  const cps = version?.version_checkpoints || [];
  return (
    <>
      <div className="mk-head">
        <div>
          <h2>{listing.name}</h2>
          <p className="mk-muted">{listing.summary}</p>
        </div>
        <Status status={listing.status === "live" ? "passed" : listing.status} />
      </div>

      <dl className="ent-facts">
        <dt>Version</dt><dd>v{version?.number} · {ago(new Date(version?.created_at).getTime())} ago</dd>
        <dt>Commit</dt><dd><code>{version?.commit_sha?.slice(0, 10)}</code></dd>
        <dt>Playtest</dt><dd>{version?.playtest_status}{version?.playtest_summary ? ` — ${clip(version.playtest_summary, 160)}` : ""}</dd>
        <dt>Checkpoints</dt><dd>{version?.checkpoint_count} ({version?.transcripts} with transcripts)</dd>
        <dt>Tokens</dt><dd>{Number(version?.tokens || 0).toLocaleString()}</dd>
        <dt>Jar SHA-256</dt><dd><code>{version?.jar_sha256?.slice(0, 16)}…</code></dd>
        <dt>Files</dt><dd><code>{version?.localDir}</code></dd>
      </dl>

      <div className="ent-actions">
        <button className="btn" onClick={() => call("open-path", version?.localDir)}><Icon name="folder" size={14} />Open files</button>
        <button className="btn" onClick={() => call("open-path", `${version?.localDir}/bundle/code-map.md`)}><Icon name="file" size={14} />Code map</button>
        <button className="btn" onClick={() => call("open-path", `${version?.localDir}/bundle/changelog.json`)}><Icon name="code" size={14} />Changelog</button>
      </div>

      <span className="ent-label">Versions ({listing.versions?.length || 0})</span>
      <ul className="mk-versions">
        {(listing.versions || []).map((v) => (
          <li key={v.id}><strong>v{v.number}</strong> <code>{v.commit_sha?.slice(0, 7)}</code> <span className="mk-muted">{v.playtest_status} · {v.version_checkpoints?.length || 0} checkpoints</span></li>
        ))}
      </ul>

      {version?.entire && <EntireSummary entire={version.entire} />}

      <span className="ent-label">Checkpoints in v{version?.number}</span>
      {cps.length ? (
        <ul className="mk-cps">{cps.map((c) => <li key={c.checkpoint_id}><code>{c.checkpoint_id}</code>{c.has_transcript ? <span className="ent-chip">transcript</span> : <span className="mk-muted"> metadata only</span>}</li>)}</ul>
      ) : <p className="mk-muted">No checkpoints.</p>}
    </>
  );
}

// The same Entire provenance the website shows: checkpoints with agent and model, the changelog, the code map.
function EntireSummary({ entire }) {
  const cps = entire.checkpoints || [];
  const cl = entire.changelog;
  const cm = entire.codeMap;
  return (
    <section className="mk-entire">
      <span className="ent-label">Built with Entire</span>
      <div className="mk-stats">
        <span className="ent-stat"><strong>{cps.length}</strong> checkpoints</span>
        {cl && <span className="ent-stat"><strong>{cl.filesChanged}</strong> files changed</span>}
        {cm && <span className="ent-stat"><strong>{cm.symbols}</strong> symbols · <strong>{cm.relations}</strong> relations</span>}
      </div>
      <ol className="mk-timeline">
        {cps.map((c) => (
          <li key={c.id}>
            <code>{c.id.slice(0, 12)}…</code>
            <span className="ent-chip">{c.agent || "agent"}</span>
            {c.model && <span className="mk-muted">{c.model}</span>}
            <span className="mk-muted">{Number(c.tokens || 0).toLocaleString()} tokens</span>
          </li>
        ))}
      </ol>
      {cl?.files?.length > 0 && (
        <>
          <span className="ent-label">Changelog</span>
          <ul className="mk-changes">
            {cl.files.slice(0, 12).map((f) => (
              <li key={f.path}>
                <span className={`mk-status ${f.status}`}>{f.status === "A" ? "added" : f.status === "D" ? "deleted" : "changed"}</span>
                <code>{f.path}</code>
                {f.signatureChanged > 0 && <span className="mk-muted">{f.signatureChanged} signature change{f.signatureChanged === 1 ? "" : "s"}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PublishCard({ mod, published, onPublished }) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [log, setLog] = React.useState([]);

  const run = (metadataOnly) => {
    setBusy(true);
    setResult(null);
    call("market:publish", { id: mod.id, metadataOnly })
      .then((r) => { setResult(r); onPublished(); })
      .catch((e) => setResult({ ok: false, error: e.message }))
      .finally(() => setBusy(false));
  };

  const blocked = result && result.ok === false && result.blocked;
  const findings = blocked ? [...(result.gate?.findings || []), ...(result.gate?.suspicious || [])] : [];

  return (
    <div className="mk-card">
      <div className="mk-card-head">
        <strong>{mod.name}</strong>
        <Status status={mod.status} />
      </div>
      <p className="mk-muted">{mod.spec?.summary || mod.prompt}</p>
      {published && <p className="mk-ok">Published as v{published.versions?.[0]?.number}{published.versions?.[0]?.playtest_status ? ` · playtest ${published.versions[0].playtest_status}` : ""}</p>}
      <button className="btn solid" disabled={busy} onClick={() => run(false)}>{busy ? "Publishing…" : published ? "Publish update" : "Publish with transcripts"}</button>

      {result?.ok && !result.skipped && <p className="mk-ok">Published v{result.version.number}.</p>}
      {result?.ok && result.skipped && <p className="mk-muted">{result.skipped}</p>}
      {result && !result.ok && !blocked && <p className="mk-err">{result.error}</p>}
      {blocked && (
        <div className="mk-blocked" role="alert">
          <p>Blocked by the secret gate: {findings.length} item{findings.length === 1 ? "" : "s"} need review before transcripts can be published.</p>
          <ul>{findings.slice(0, 6).map((f, i) => <li key={i}>{f.file || "transcript"} line {f.line} — {f.rule || "random-looking token"}</li>)}</ul>
          {result.metadataOnlyPossible && (
            <button className="btn" disabled={busy} onClick={() => run(true)}>Publish metadata only</button>
          )}
        </div>
      )}
    </div>
  );
}

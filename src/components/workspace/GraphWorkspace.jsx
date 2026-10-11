import React, { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { call, ago } from "../../api.js";
import { Badge } from "./ui.jsx";

function EntireGraph({ graphTick }) {
  const host = useRef(null);
  const cy = useRef(null);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    setData(null);
    call("entire:graph", {})
      .then((value) => live && setData(value))
      .catch(
        (error) => live && setData({ available: false, error: error.message }),
      );
    return () => {
      live = false;
    };
  }, [graphTick]);
  const visible = useMemo(() => {
    const nodes = data?.nodes || [];
    const term = query.trim().toLowerCase();
    if (!term) return { nodes, edges: data?.edges || [] };
    const ids = new Set(
      nodes
        .filter((node) =>
          [node.label, node.file, node.kind].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(term),
          ),
        )
        .map((node) => node.id),
    );
    return {
      nodes: nodes.filter((node) => ids.has(node.id)),
      edges: (data?.edges || []).filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    };
  }, [data, query]);
  useEffect(() => () => cy.current?.destroy(), []);
  useEffect(() => {
    if (!host.current || !data?.available || !visible.nodes.length) return;
    cy.current?.destroy();
    cy.current = cytoscape({
      container: host.current,
      elements: [
        ...visible.nodes.map((node) => ({
          data: { ...node, label: node.label || node.file || node.id },
        })),
        ...visible.edges.map((edge) => ({ data: edge })),
      ],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": "#e8c45a",
            color: "#f2f0e9",
            "font-size": 10,
            "text-wrap": "ellipsis",
            "text-max-width": 110,
            "text-valign": "bottom",
            "text-margin-y": 7,
            width: 22,
            height: 22,
          },
        },
        {
          selector: "node[kind = 'file']",
          style: {
            shape: "round-rectangle",
            "background-color": "#4da77a",
            width: 28,
            height: 20,
          },
        },
        {
          selector: "node:selected",
          style: { "border-width": 3, "border-color": "#f2b84b" },
        },
        {
          selector: "edge",
          style: {
            width: 1.4,
            "line-color": "#4b4e57",
            "target-arrow-color": "#4b4e57",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(relation)",
            "font-size": 7,
            color: "#aaaeb7",
          },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        randomize: true,
        nodeRepulsion: () => 9000,
        idealEdgeLength: () => 90,
      },
    });
    cy.current.on("tap", "node", (event) => setSelected(event.target.data()));
    cy.current.fit(undefined, 36);
  }, [data?.available, visible]);
  if (!data)
    return (
      <div className="plain-card">Loading Entire relationship graph...</div>
    );
  if (!data.available)
    return (
      <div className="notice error">
        <strong>Entire graph unavailable</strong>
        <p>
          {data.error ||
            "Install and enable the Entire CLI for this repository."}
        </p>
      </div>
    );
  if (!data.nodes?.length)
    return (
      <div className="plain-card">
        Entire returned no repository relationships.
      </div>
    );
  return (
    <>
      {data.error && <div className="notice error">{data.error}</div>}
      <div className="graph-tools">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files or symbols"
        />
        <button onClick={() => cy.current?.fit(undefined, 36)}>
          Fit graph
        </button>
      </div>
      <div className="entire-graph-layout">
        <div className="relationship-graph" ref={host} />
        <aside className="node-details">
          <h3>{selected?.label || "Select a node"}</h3>
          {selected ? (
            <>
              <Badge tone="green">{selected.kind || "symbol"}</Badge>
              {selected.file && <code>{selected.file}</code>}
              <p>{selected.id}</p>
            </>
          ) : (
            <p>Choose a file or symbol to inspect its source location.</p>
          )}
        </aside>
      </div>
    </>
  );
}

function History({ data }) {
  const groups = [
    ["Checkpoints", data?.checkpoints],
    ["Entire sessions", data?.sessions],
  ];
  return (
    <div className="history-sections">
      {groups.map(([label, group]) => (
        <section key={label}>
          <h2>{label}</h2>
          {!group ? (
            <div className="plain-card">Loading...</div>
          ) : !group.available ? (
            <div className="notice error">
              {group.error || `${label} are unavailable.`}
            </div>
          ) : group.items?.length ? (
            <div className="card-list">
              {group.items.map((item, index) => (
                <article key={item.id || index}>
                  <Badge tone="green">Entire</Badge>
                  <h3>
                    {item.title || item.summary || item.id || "Untitled record"}
                  </h3>
                  {item.summary && item.summary !== item.title && (
                    <p>{item.summary}</p>
                  )}
                  <small>{item.at ? ago(item.at) : "Time unavailable"}</small>
                </article>
              ))}
            </div>
          ) : (
            <div className="plain-card">
              No {label.toLowerCase()} are available.
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Insights({ runs, stats }) {
  const complete = runs.filter(
    (run) => run.verify?.length || ["passed", "failed"].includes(run.status),
  );
  const versions = new Map();
  complete.forEach((run) => {
    const version = run.harnessVersion ?? run.harness?.version ?? "unknown";
    const row = versions.get(version) || { total: 0, passed: 0, failed: 0 };
    row.total += 1;
    row[run.status === "passed" ? "passed" : "failed"] += 1;
    versions.set(version, row);
  });
  return (
    <>
      <div className="stats-grid">
        <article>
          <strong>{stats?.runs ?? complete.length}</strong>
          <span>Runs with outcomes</span>
        </article>
        <article>
          <strong>
            {stats?.passed ??
              complete.filter((run) => run.status === "passed").length}
          </strong>
          <span>Passed outcomes</span>
        </article>
        <article>
          <strong>
            {stats?.retries ?? complete.filter((run) => run.retryOf).length}
          </strong>
          <span>Retries</span>
        </article>
      </div>
      {(stats?.before || stats?.after) && (
        <div className="stats-grid comparison-grid">
          {[stats.before, stats.after].filter(Boolean).map((period, index) => (
            <article key={period.label || index}>
              <span>
                {index === 0
                  ? "Earlier recorded version"
                  : "Later recorded version"}
              </span>
              <strong>{period.label || "Harness version"}</strong>
              <span>
                {period.passed || 0} passed of {period.runs || 0} outcomes
              </span>
            </article>
          ))}
        </div>
      )}
      <p className="section-note">
        Counts are grouped by recorded harness version. Earlier and later groups
        describe observed outcomes. They do not prove the harness caused a
        change.
      </p>
      <div className="card-list">
        {[...versions.entries()].map(([version, row]) => (
          <article key={version}>
            <Badge tone="violet">Harness v{version}</Badge>
            <h3>
              {row.total} completed run{row.total === 1 ? "" : "s"}
            </h3>
            <p>
              {row.passed} passed | {row.failed} failed
            </p>
          </article>
        ))}
        {!versions.size && (
          <div className="plain-card">
            No completed run outcomes are available.
          </div>
        )}
      </div>
    </>
  );
}

export default function GraphWorkspace({ kind, runs = [], graphTick = 0 }) {
  const [overview, setOverview] = useState(null);
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (kind === "history")
      call("entire:overview", {})
        .then(setOverview)
        .catch((error) =>
          setOverview({
            checkpoints: { available: false, error: error.message },
            sessions: { available: false, error: error.message },
          }),
        );
    if (kind === "insights")
      call("improve:stats", {})
        .then(setStats)
        .catch((error) => setStats({ error: error.message }));
  }, [kind, graphTick]);
  if (kind === "entire")
    return (
      <main className="page">
        <header>
          <Badge tone="green">Entire</Badge>
          <h1>Repository relationships</h1>
          <p>Explore files, symbols, and their recorded code relationships.</p>
        </header>
        <EntireGraph graphTick={graphTick} />
      </main>
    );
  return (
    <main className="page">
      <header>
        <h1>{kind === "history" ? "History" : "Insights"}</h1>
        <p>
          {kind === "history"
            ? "Entire checkpoints and sessions retained as separate records."
            : "Recorded run outcomes by harness version."}
        </p>
      </header>
      {kind === "history" ? (
        <History data={overview} />
      ) : stats?.error ? (
        <div className="notice error">{stats.error}</div>
      ) : (
        <Insights runs={runs} stats={stats} />
      )}
    </main>
  );
}

import React from "react";
import cytoscape from "cytoscape";
import { call } from "../../api.js";
import { Icon } from "./shared.jsx";

// A small window over the Entire page showing a mod's code graph from entire-graph.
// Everything shown is also reachable by agents: each node offers the exact CLI query an agent runs.
const KIND_COLOR = { file: "#4cc38a", class: "#f5c84c", interface: "#f5c84c", method: "#a78bfa", function: "#a78bfa", field: "#4fb8d0", external: "#6e727c" };
const colorOf = (kind = "") => KIND_COLOR[kind] || KIND_COLOR[kind.split(":")[0]] || "#8b8fa3";
const shortKind = (kind = "") => (kind.startsWith("external") ? "external" : kind || "symbol");

export default function GraphWindow({ mod, onClose }) {
  const host = React.useRef(null);
  const cy = React.useRef(null);
  const [data, setData] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [hidden, setHidden] = React.useState(() => new Set(["external"]));
  const [selectedId, setSelectedId] = React.useState(null);

  React.useEffect(() => {
    let live = true;
    call("studio:graph", { id: mod.id })
      .then((d) => live && setData(d))
      .catch((e) => live && setData({ available: false, error: e.message }));
    return () => { live = false; };
  }, [mod.id]);

  React.useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byId = React.useMemo(() => new Map((data?.nodes || []).map((n) => [n.id, n])), [data]);
  const kinds = React.useMemo(() => [...new Set((data?.nodes || []).map((n) => shortKind(n.kind)))].sort(), [data]);

  const visible = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    const nodes = (data?.nodes || []).filter((n) => !hidden.has(shortKind(n.kind)) &&
      (!term || [n.label, n.file, n.kind].some((v) => String(v || "").toLowerCase().includes(term))));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: (data?.edges || []).filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [data, query, hidden]);

  React.useEffect(() => {
    if (!host.current || !data?.available) return;
    cy.current?.destroy();
    cy.current = cytoscape({
      container: host.current,
      elements: [
        ...visible.nodes.map((n) => ({ data: { id: n.id, label: n.label || n.file || n.id, color: colorOf(n.kind), file: n.kind === "file" ? 1 : 0 } })),
        ...visible.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, relation: e.relation } })),
      ],
      style: [
        { selector: "node", style: { label: "data(label)", "background-color": "data(color)", color: "#c9ccd6", "font-size": 9, "text-valign": "bottom", "text-margin-y": 5, "text-wrap": "ellipsis", "text-max-width": 110, width: 14, height: 14 } },
        { selector: "node[file = 1]", style: { shape: "round-rectangle", width: 22, height: 14 } },
        { selector: "node:selected", style: { "border-width": 3, "border-color": "#ffd60a" } },
        { selector: "edge", style: { width: 1, "line-color": "#3a3d48", "target-arrow-color": "#3a3d48", "target-arrow-shape": "triangle", "arrow-scale": 0.6, "curve-style": "bezier" } },
        { selector: "edge.lit", style: { width: 2, "line-color": "#ffd60a", "target-arrow-color": "#ffd60a" } },
        { selector: "node.dim", style: { opacity: 0.25 } },
      ],
      layout: { name: "cose", animate: false, randomize: true, nodeRepulsion: () => 7000, idealEdgeLength: () => 70 },
      wheelSensitivity: 0.25,
    });
    cy.current.on("tap", "node", (e) => setSelectedId(e.target.id()));
    cy.current.on("tap", (e) => { if (e.target === cy.current) setSelectedId(null); });
    cy.current.fit(undefined, 30);
    return () => cy.current?.destroy();
  }, [data?.available, visible]);

  // Highlight the selected node's neighbourhood.
  React.useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.elements().removeClass("lit dim");
    if (!selectedId) return;
    const node = c.getElementById(selectedId);
    if (!node.length) return;
    c.nodes().addClass("dim");
    node.closedNeighborhood().removeClass("dim");
    node.connectedEdges().addClass("lit");
    node.select();
    c.animate({ center: { eles: node }, duration: 250 });
  }, [selectedId, visible]);

  const selected = selectedId ? byId.get(selectedId) : null;
  const outgoing = selected ? (data.edges || []).filter((e) => e.source === selected.id) : [];
  const incoming = selected ? (data.edges || []).filter((e) => e.target === selected.id) : [];
  const symbol = selected ? (selected.kind === "file" ? selected.file : selected.label) : "";

  const toggleKind = (k) => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="gw-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gw-window" role="dialog" aria-label={`${mod.name} code graph`}>
        <header className="gw-head">
          <strong>{mod.name} · code graph</strong>
          <span className="gw-sub">entire-graph{data?.available ? ` · ${data.nodes.length} nodes · ${data.edges.length} relations` : ""}</span>
          <button className="gw-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        {!data && <p className="gw-msg">Building the graph…</p>}
        {data && !data.available && <p className="gw-msg error">{data.error || "Entire could not build a graph for this repository."}</p>}

        {data?.available && (
          <div className="gw-body">
            <div className="gw-canvas-col">
              <div className="gw-tools">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files and symbols" aria-label="Search the graph" />
                <button className="btn" onClick={() => cy.current?.fit(undefined, 30)}>Fit</button>
              </div>
              <div className="gw-kinds">
                {kinds.map((k) => (
                  <button key={k} className={hidden.has(k) ? "off" : ""} onClick={() => toggleKind(k)}>
                    <i style={{ background: colorOf(k) }} />{k}
                  </button>
                ))}
              </div>
              <div className="gw-canvas" ref={host} />
              {!visible.nodes.length && <p className="gw-msg">Nothing matches.</p>}
            </div>

            <aside className="gw-side">
              {!selected ? (
                <p className="gw-msg">Click a node to see what it is, where it lives, and everything connected to it.</p>
              ) : (
                <>
                  <span className="ent-label">{shortKind(selected.kind)}</span>
                  <h3 className="gw-title">{selected.label}</h3>
                  {selected.file && <code className="gw-file">{selected.file}</code>}
                  <Relations title="Uses" edges={outgoing} pick="target" byId={byId} onPick={setSelectedId} />
                  <Relations title="Used by" edges={incoming} pick="source" byId={byId} onPick={setSelectedId} />
                  <span className="ent-label">Agent queries</span>
                  <AgentQuery text={`entire graph neighbors --symbol "${symbol}" --repo .`} />
                  <AgentQuery text={`entire graph impact --symbol "${symbol}" --repo .`} />
                </>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function Relations({ title, edges, pick, byId, onPick }) {
  if (!edges.length) return null;
  const groups = {};
  for (const e of edges) (groups[e.relation] ||= []).push(e);
  return (
    <div className="gw-rel">
      <span className="ent-label">{title} ({edges.length})</span>
      {Object.entries(groups).map(([rel, list]) => (
        <div key={rel} className="gw-rel-group">
          <span className="gw-rel-name">{rel.toLowerCase().replace(/_/g, " ")}</span>
          {list.slice(0, 12).map((e) => {
            const other = byId.get(e[pick]);
            return (
              <button key={e.id} className="gw-rel-item" onClick={() => onPick(e[pick])} title={other?.file || ""}>
                {other?.label || e[pick]}
              </button>
            );
          })}
          {list.length > 12 && <span className="gw-rel-more">+{list.length - 12} more</span>}
        </div>
      ))}
    </div>
  );
}

function AgentQuery({ text }) {
  const [done, setDone] = React.useState(false);
  return (
    <button className="gw-query" title="Copy — agents run this same query" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      <Icon name="terminal" size={12} /><code>{text}</code><span>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { call } from "../api.js";

const STYLE = {
  Decision: { color: "#ffd60a", shape: "ellipse", size: 16 },
  DeadEnd: { color: "#ff5f56", shape: "ellipse", size: 14 },
  Direction: { color: "#ffffff", shape: "diamond", size: 26 },
  Intent: { color: "#ffd60a", shape: "round-triangle", size: 16 },
  AgentRun: { color: "#3ddc84", shape: "round-rectangle", size: 14 },
  Issue: { color: "#8f8f8f", shape: "ellipse", size: 10 },
  PR: { color: "#4a4a4a", shape: "ellipse", size: 9 },
  File: { color: "#2a2a2a", shape: "rectangle", size: 6 },
  Person: { color: "#2a2a2a", shape: "ellipse", size: 6 },
};

function visible(graph, mode, focus) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let keep;
  if (mode === "all") keep = new Set(graph.nodes.map((n) => n.id));
  else if (focus.length) {
    keep = new Set(focus.filter((id) => byId.has(id)));
    for (const e of graph.edges) {
      if (keep.has(e.from) && byId.has(e.to)) keep.add(e.to);
      if (keep.has(e.to) && byId.has(e.from)) keep.add(e.from);
    }
  } else {
    // Overview: directions and what advances them, recent dead ends, and agent runs.
    const advancing = new Set(
      graph.edges
        .filter((e) => e.type === "advances")
        .flatMap((e) => [e.from, e.to]),
    );
    const recentDead = graph.nodes
      .filter((n) => n.type === "DeadEnd")
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, 20)
      .map((n) => n.id);
    keep = new Set([
      ...advancing,
      ...recentDead,
      ...graph.nodes
        .filter(
          (n) =>
            ["Direction", "AgentRun", "Intent"].includes(n.type) ||
            (n.type === "Decision" && n.status === "recorded"),
        )
        .map((n) => n.id),
    ]);
    for (const e of graph.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (
        keep.has(e.from) &&
        b &&
        (b.type === "Issue" || b.type === "PR" || b.type === "Direction")
      )
        keep.add(e.to);
      if (keep.has(e.to) && a && (a.type === "Issue" || a.type === "PR"))
        keep.add(e.from);
    }
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

export default function GraphPanel({ tick, focus, onClearFocus, project }) {
  const el = useRef(null);
  const cy = useRef(null);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [history, setHistory] = useState([]);
  const [pos, setPos] = useState(-1); // -1 = live
  const [mode, setMode] = useState("task");
  const [card, setCard] = useState(null);

  useEffect(
    () => () => {
      cy.current?.destroy();
      cy.current = null;
    },
    [],
  );

  useEffect(() => {
    call("graph:history")
      .then((h) => {
        setHistory(h);
        setPos(-1);
      })
      .catch(() => {});
  }, [tick, project?.repo]);

  useEffect(() => {
    const sha =
      pos >= 0 && pos < history.length - 1 ? history[pos].sha : undefined;
    call("graph:load", sha ? { sha } : {})
      .then(setGraph)
      .catch(() => {});
  }, [pos, history, tick]);

  const view = useMemo(() => visible(graph, mode, focus), [graph, mode, focus]);

  useEffect(() => {
    if (!el.current) return;
    if (!cy.current) {
      cy.current = cytoscape({
        container: el.current,
        wheelSensitivity: 0.25,
        minZoom: 0.15,
        maxZoom: 3,
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              shape: "data(shape)",
              width: "data(size)",
              height: "data(size)",
              label: "data(label)",
              color: "#9a9a9a",
              "font-size": 7,
              "font-family": "SF Mono, Menlo, monospace",
              "text-valign": "bottom",
              "text-margin-y": 3,
              "text-max-width": 90,
              "text-wrap": "ellipsis",
              "min-zoomed-font-size": 7,
              "border-width": 0,
              opacity: "data(opacity)",
            },
          },
          {
            selector: 'node[status = "inferred"]',
            style: {
              "border-width": 1.5,
              "border-style": "dashed",
              "border-color": "data(color)",
              "background-opacity": 0.35,
            },
          },
          {
            selector: 'node[type = "Direction"]',
            style: { color: "#ffffff", "font-size": 10, "font-weight": 700 },
          },
          {
            selector: "node.focus",
            style: {
              "border-width": 3,
              "border-color": "#ffd60a",
              "border-style": "solid",
              color: "#ffd60a",
              "font-size": 9,
              "z-index": 10,
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": 3,
              "border-color": "#ffffff",
              "border-style": "solid",
            },
          },
          {
            selector: "edge",
            style: {
              width: 0.8,
              "line-color": "#262626",
              "curve-style": "haystack",
              opacity: 0.9,
            },
          },
          {
            selector:
              'edge[type = "rejected_in"], edge[type = "flagged_by_intent"], edge[type = "reverts"]',
            style: { "line-color": "#5a1f1c", width: 1.2 },
          },
          {
            selector: 'edge[type = "advances"]',
            style: { "line-color": "#4d4100", width: 1 },
          },
          {
            selector: 'edge[type = "recorded_in"], edge[type = "works_on"]',
            style: { "line-color": "#3a3a3a" },
          },
        ],
      });
      cy.current.on("tap", "node", (e) => setCard(e.target.data("raw")));
      cy.current.on("tap", (e) => {
        if (e.target === cy.current) setCard(null);
      });
    }
    const c = cy.current;
    const focusSet = new Set(focus);
    c.elements().remove();
    c.add([
      ...view.nodes.map((n) => {
        const s = STYLE[n.type] || STYLE.Issue;
        const label =
          n.type === "Direction"
            ? n.title
            : n.type === "File" || n.type === "Person"
              ? ""
              : `${n.id.replace(/^(issue|pr)_/, "#")} ${n.title || ""}`.slice(
                  0,
                  40,
                );
        return {
          data: {
            id: n.id,
            label,
            type: n.type,
            status: n.status,
            color: s.color,
            shape: s.shape,
            size: s.size,
            opacity: 0.45 + 0.55 * (n.confidence ?? 1),
            raw: n,
          },
          classes: focusSet.has(n.id) ? "focus" : "",
        };
      }),
      ...view.edges.map((e) => ({
        data: { id: e.id, source: e.from, target: e.to, type: e.type },
      })),
    ]);
    c.layout({
      name: "cose",
      animate: false,
      nodeRepulsion: () => 9000,
      idealEdgeLength: () => 42,
      gravity: 0.6,
      numIter: 900,
      randomize: true,
      componentSpacing: 24,
      nodeOverlap: 6,
    }).run();
    if (focusSet.size) c.fit(c.nodes(".focus").closedNeighborhood(), 60);
    else c.fit(undefined, 30);
  }, [view, focus]);

  const at = pos >= 0 && pos < history.length ? history[pos] : history.at(-1);
  const counts = view.nodes.reduce(
    (m, n) => ({ ...m, [n.type]: (m[n.type] || 0) + 1 }),
    {},
  );

  return (
    <div className="graph">
      <div className="tabs">
        <span className="mono faint" style={{ fontSize: 11 }}>
          INTENT GRAPH{" "}
          <span className="muted">
            {view.nodes.length}/{graph.nodes.length}
          </span>
        </span>
        <span>
          {focus.length > 0 && (
            <button className="tab bee" onClick={onClearFocus}>
              x focus ({focus.length})
            </button>
          )}
          {["task", "all"].map((m) => (
            <button
              key={m}
              className={`tab ${mode === m ? "on" : ""}`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </span>
      </div>
      <div className="cy" ref={el} />
      <div className="legend">
        {Object.entries(STYLE)
          .filter(([t]) => counts[t])
          .map(([t, s]) => (
            <span key={t}>
              <i style={{ background: s.color }} />
              {t} {counts[t]}
            </span>
          ))}
        <span className="faint">dashed = inferred | solid = recorded</span>
      </div>
      {card && (
        <div className="card">
          <button className="x" onClick={() => setCard(null)}>
            x
          </button>
          <div className="kv">
            <b className="bee">{card.type}</b> | {card.id}
          </div>
          <h4>{card.title}</h4>
          <div className="kv">
            conf <b>{(card.confidence ?? 1).toFixed(2)}</b> |{" "}
            <b>{card.status}</b>
            {card.at ? <> | {new Date(card.at).toLocaleDateString()}</> : null}
          </div>
          {card.outcome && (
            <div className="kv">
              outcome{" "}
              <b className={card.outcome === "passed" ? "ok" : "bad"}>
                {card.outcome}
              </b>{" "}
              | harness v{card.harnessVersion}
            </div>
          )}
          {card.reason && (
            <p>
              <span className="bee">why: </span>
              {card.reason}
            </p>
          )}
          {card.body && <p className="muted">{card.body.slice(0, 600)}</p>}
          {card.touches?.length > 0 && (
            <div className="kv">
              touches: <b>{card.touches.slice(0, 6).join(", ")}</b>
            </div>
          )}
          {card.sources?.length > 0 && (
            <div className="kv">
              src:{" "}
              {card.sources.map((s) => {
                const m = s.match(/^github:(pr|issue)\/(\d+)$/);
                return m ? (
                  <a
                    key={s}
                    onClick={() =>
                      window.benana.openExternal(
                        `https://github.com/${project.repo}/${m[1] === "pr" ? "pull" : "issues"}/${m[2]}`,
                      )
                    }
                  >
                    {s}{" "}
                  </a>
                ) : (
                  <span key={s}>{s} </span>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className="scrub">
        <input
          type="range"
          min={0}
          max={Math.max(0, history.length - 1)}
          value={pos < 0 ? history.length - 1 : pos}
          onChange={(e) => setPos(Number(e.target.value))}
        />
        <div className="labels">
          <span>
            {history[0] ? new Date(history[0].ts).toLocaleDateString() : ""}
          </span>
          <span className="now">
            {at
              ? `${at.sha.slice(0, 7)} | ${at.actor} | ${at.subject}`
              : "no snapshots"}
          </span>
          <span>
            {pos < 0 || pos === history.length - 1
              ? "now"
              : `${history.length - 1 - pos} back`}
          </span>
        </div>
      </div>
    </div>
  );
}

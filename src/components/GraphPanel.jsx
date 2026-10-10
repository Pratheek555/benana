import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { call } from '../api.js';

const STYLE = {
  Direction: { color: '#ffffff', shape: 'diamond', size: 26 },
  Intent: { color: '#ffd60a', shape: 'round-triangle', size: 16 },
  Decision: { color: '#ffd60a', shape: 'ellipse', size: 15 },
  DeadEnd: { color: '#ff5f56', shape: 'ellipse', size: 14 },
  AgentRun: { color: '#3ddc84', shape: 'round-rectangle', size: 14 },
  Issue: { color: '#8f8f8f', shape: 'ellipse', size: 10 },
  PR: { color: '#6b6b6b', shape: 'ellipse', size: 9 },
  File: { color: '#3a3a3a', shape: 'rectangle', size: 6 },
  Person: { color: '#3a3a3a', shape: 'ellipse', size: 6 },
};

// Which nodes a mode shows. Pure, so the same inputs always give the same view.
function visible(graph, mode, focus, hidden) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let keep;
  if (mode === 'all') keep = new Set(graph.nodes.map((n) => n.id));
  else if (focus.length) {
    keep = new Set(focus.filter((id) => byId.has(id)));
    for (const e of graph.edges) {
      if (keep.has(e.from) && byId.has(e.to)) keep.add(e.to);
      if (keep.has(e.to) && byId.has(e.from)) keep.add(e.from);
    }
  } else {
    // Overview: directions and what advances them, recent dead ends, and agent runs.
    const advancing = new Set(graph.edges.filter((e) => e.type === 'advances').flatMap((e) => [e.from, e.to]));
    const recentDead = graph.nodes.filter((n) => n.type === 'DeadEnd').sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20).map((n) => n.id);
    keep = new Set([
      ...advancing, ...recentDead,
      ...graph.nodes.filter((n) => ['Direction', 'AgentRun', 'Intent'].includes(n.type) || (n.type === 'Decision' && n.status === 'recorded')).map((n) => n.id),
    ]);
    for (const e of graph.edges) {
      const a = byId.get(e.from); const b = byId.get(e.to);
      if (keep.has(e.from) && b && (b.type === 'Issue' || b.type === 'PR' || b.type === 'Direction')) keep.add(e.to);
      if (keep.has(e.to) && a && (a.type === 'Issue' || a.type === 'PR')) keep.add(e.from);
    }
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id) && !hidden.has(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to) };
}

const labelOf = (n) => (n.type === 'Direction' ? n.title
  : n.type === 'File' || n.type === 'Person' ? ''
    : `${n.id.replace(/^(issue|pr)_/, '#')} ${n.title || ''}`.slice(0, 42));

// Stable per-id jitter so new nodes land in the same spot every time.
const jitter = (id, r) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
};

const LAYOUT = { name: 'cose', nodeRepulsion: () => 9000, idealEdgeLength: () => 46, gravity: 0.5, numIter: 1000, componentSpacing: 40, nodeOverlap: 8, padding: 30 };

export default function GraphPanel({ tick, focus, onClearFocus, project }) {
  const el = useRef(null);
  const cy = useRef(null);
  const positions = useRef(new Map()); // id → {x,y}; survives reloads, mode switches and scrubbing
  const fitKey = useRef('');
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [history, setHistory] = useState([]);
  const [pos, setPos] = useState(-1); // -1 = live
  const [mode, setMode] = useState('task');
  const [card, setCard] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [query, setQuery] = useState('');

  // History follows the graph; a new snapshot snaps the scrubber back to live.
  useEffect(() => {
    call('graph:history').then(setHistory).catch(() => {});
  }, [tick, project?.repo]);
  useEffect(() => { setPos(-1); positions.current.clear(); fitKey.current = ''; }, [project?.repo]);

  const sha = pos >= 0 && pos < history.length - 1 ? history[pos].sha : null;
  // One load per (snapshot | live tick). Scrubbing is debounced so dragging doesn't flood IPC.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      call('graph:load', sha ? { sha } : {}).then((g) => { if (!cancelled) setGraph(g); }).catch(() => {});
    }, sha ? 120 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [sha, sha ? null : tick]);

  const view = useMemo(() => visible(graph, mode, focus, hidden), [graph, mode, focus, hidden]);

  // Create the instance once.
  useEffect(() => {
    const c = cytoscape({
      container: el.current,
      wheelSensitivity: 0.25,
      minZoom: 0.1,
      maxZoom: 4,
      boxSelectionEnabled: false,
      style: [
        { selector: 'node', style: {
          'background-color': 'data(color)', shape: 'data(shape)', width: 'data(size)', height: 'data(size)',
          label: 'data(label)', color: '#a0a0a0', 'font-size': 8, 'font-family': 'Geist Mono, SF Mono, Menlo, monospace',
          'text-valign': 'bottom', 'text-margin-y': 4, 'text-max-width': 110, 'text-wrap': 'ellipsis', 'min-zoomed-font-size': 9,
          'text-background-color': '#000', 'text-background-opacity': 0.6, 'text-background-padding': 1,
          'border-width': 0, opacity: 'data(opacity)',
          'transition-property': 'opacity, border-width, width, height', 'transition-duration': 180,
        } },
        { selector: 'node[status = "inferred"]', style: { 'border-width': 1.5, 'border-style': 'dashed', 'border-color': 'data(color)', 'background-opacity': 0.35 } },
        { selector: 'node[type = "Direction"]', style: { color: '#ffffff', 'font-size': 11, 'font-weight': 700, 'min-zoomed-font-size': 4 } },
        { selector: 'node[outcome = "failed"]', style: { 'background-color': '#ff5f56' } },
        { selector: 'node.focus', style: { 'border-width': 3, 'border-color': '#ffd60a', 'border-style': 'solid', color: '#ffd60a', 'min-zoomed-font-size': 4, 'z-index': 10 } },
        { selector: 'node.match', style: { 'border-width': 3, 'border-color': '#ffffff', 'border-style': 'solid', color: '#ffffff', 'min-zoomed-font-size': 4, 'z-index': 11 } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff', 'border-style': 'solid', 'min-zoomed-font-size': 4 } },
        { selector: 'node.hl', style: { 'min-zoomed-font-size': 4, color: '#ededed', 'z-index': 9 } },
        { selector: 'edge', style: {
          width: 1, 'line-color': '#2a2a2a', 'curve-style': 'bezier', 'control-point-step-size': 20, opacity: 0.85,
          'target-arrow-shape': 'none', 'transition-property': 'opacity, line-color', 'transition-duration': 180,
        } },
        { selector: 'edge[type = "rejected_in"], edge[type = "flagged_by_intent"], edge[type = "reverts"]', style: { 'line-color': '#6b2420', width: 1.4 } },
        { selector: 'edge[type = "advances"]', style: { 'line-color': '#5c4d00', width: 1.2, 'target-arrow-shape': 'triangle', 'target-arrow-color': '#5c4d00', 'arrow-scale': 0.6 } },
        { selector: 'edge[type = "works_on"]', style: { 'line-color': '#245a3a', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#245a3a', 'arrow-scale': 0.6 } },
        { selector: 'edge.hl', style: { 'line-color': '#ffd60a', opacity: 1, width: 1.6, 'z-index': 9 } },
        { selector: '.faded', style: { opacity: 0.12 } },
      ],
    });
    c.on('tap', 'node', (e) => setCard(e.target.data('raw')));
    c.on('tap', (e) => { if (e.target === c) setCard(null); });
    c.on('mouseover', 'node', (e) => {
      const nb = e.target.closedNeighborhood();
      c.batch(() => { c.elements().not(nb).addClass('faded'); nb.addClass('hl'); });
    });
    c.on('mouseout', 'node', () => c.batch(() => c.elements().removeClass('faded hl')));
    // Remember where the user drags things.
    c.on('dragfree', 'node', (e) => positions.current.set(e.target.id(), { ...e.target.position() }));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    cy.current = c;
    return () => { ro.disconnect(); c.destroy(); cy.current = null; };
  }, []);

  // Diff the view into the instance. Existing nodes keep their positions; new nodes start
  // next to a placed neighbour; a layout runs only when the view changes a lot, and animates.
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    const focusSet = new Set(focus);
    const want = new Set([...view.nodes.map((n) => n.id), ...view.edges.map((e) => e.id)]);
    const degree = new Map();
    for (const e of view.edges) { degree.set(e.from, (degree.get(e.from) || 0) + 1); degree.set(e.to, (degree.get(e.to) || 0) + 1); }
    const known = positions.current;
    const neighbours = new Map();
    for (const e of view.edges) {
      if (!neighbours.has(e.from)) neighbours.set(e.from, []);
      if (!neighbours.has(e.to)) neighbours.set(e.to, []);
      neighbours.get(e.from).push(e.to); neighbours.get(e.to).push(e.from);
    }
    const ext = c.extent();
    const center = c.nodes().length ? { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 } : { x: 0, y: 0 };
    const placeNew = (id) => {
      if (known.has(id)) return known.get(id);
      const placed = (neighbours.get(id) || []).map((n) => known.get(n)).filter(Boolean);
      const base = placed.length ? { x: placed.reduce((s, p) => s + p.x, 0) / placed.length, y: placed.reduce((s, p) => s + p.y, 0) / placed.length } : center;
      const j = jitter(id, placed.length ? 40 : 160);
      return { x: base.x + j.x, y: base.y + j.y };
    };

    let added = 0;
    c.batch(() => {
      c.elements().filter((x) => !want.has(x.id())).remove();
      for (const n of view.nodes) {
        const s = STYLE[n.type] || STYLE.Issue;
        const data = {
          id: n.id, label: labelOf(n), type: n.type, status: n.status, outcome: n.outcome || '', color: s.color, shape: s.shape,
          size: s.size + Math.min(10, (degree.get(n.id) || 0) * 0.8), opacity: 0.45 + 0.55 * (n.confidence ?? 1), raw: n,
        };
        const ex = c.getElementById(n.id);
        if (ex.nonempty()) ex.data(data);
        else { c.add({ group: 'nodes', data, position: placeNew(n.id) }); if (!known.has(n.id)) added++; }
        c.getElementById(n.id).toggleClass('focus', focusSet.has(n.id));
      }
      for (const e of view.edges) {
        if (c.getElementById(e.id).empty()) c.add({ group: 'edges', data: { id: e.id, source: e.from, target: e.to, type: e.type } });
      }
    });

    const total = view.nodes.length;
    const firstTime = known.size === 0;
    const key = `${mode}|${[...focusSet].sort().join(',')}|${project?.repo}`;
    if (!total) return; // keep the fit pending until there is something to frame
    const refit = firstTime || key !== fitKey.current;
    fitKey.current = key;
    const after = () => {
      c.nodes().forEach((n) => known.set(n.id(), { ...n.position() }));
      if (refit) fitView(c, focusSet, true);
    };
    if (firstTime || added > Math.max(3, total * 0.25)) {
      // Big change: settle everything, but start from current positions and animate.
      c.layout({ ...LAYOUT, randomize: firstTime, animate: !firstTime, animationDuration: 450, animationEasing: 'ease-out-cubic', fit: false, stop: after }).run();
    } else {
      after();
    }
  }, [view, focus, mode, project?.repo]);

  // Search: highlight matches and frame them.
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    const q = query.trim().toLowerCase();
    c.nodes().removeClass('match');
    if (!q) return;
    const hits = c.nodes().filter((n) => `${n.id()} ${n.data('raw')?.title || ''}`.toLowerCase().includes(q));
    hits.addClass('match');
    if (hits.nonempty()) c.animate({ fit: { eles: hits.closedNeighborhood(), padding: 60 }, duration: 300, easing: 'ease-out-cubic' });
  }, [query, view]);

  const fit = useCallback(() => cy.current && fitView(cy.current, new Set(focus), true), [focus]);
  const relayout = useCallback(() => {
    const c = cy.current;
    if (!c) return;
    c.layout({ ...LAYOUT, randomize: false, animate: true, animationDuration: 500, animationEasing: 'ease-out-cubic', fit: true, stop: () => c.nodes().forEach((n) => positions.current.set(n.id(), { ...n.position() })) }).run();
  }, []);
  const toggleType = (t) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const at = pos >= 0 && pos < history.length ? history[pos] : history.at(-1);
  const counts = graph.nodes.reduce((m, n) => ({ ...m, [n.type]: (m[n.type] || 0) + 1 }), {});
  const shown = view.nodes.reduce((m, n) => ({ ...m, [n.type]: (m[n.type] || 0) + 1 }), {});

  return (
    <div className="graph">
      <div className="tabs">
        <span className="mono faint" style={{ fontSize: 11 }}>INTENT GRAPH <span className="muted">{view.nodes.length}/{graph.nodes.length}</span></span>
        <span className="gtools">
          <input className="gsearch" placeholder="find…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          {focus.length > 0 && <button className="tab bee" onClick={onClearFocus}>✕ focus ({focus.length})</button>}
          {['task', 'all'].map((m) => <button key={m} className={`tab ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{m}</button>)}
          <button className="tab" title="fit to view" onClick={fit}>⤢</button>
          <button className="tab" title="re-run layout" onClick={relayout}>↻</button>
        </span>
      </div>
      <div className="cy" ref={el} />
      {!view.nodes.length && <div className="gempty">{graph.nodes.length ? 'Nothing in this view. Try “all”, or clear focus and filters.' : 'No intent yet. Ingest GitHub history or finish a run.'}</div>}
      <div className="legend">
        {Object.entries(STYLE).filter(([t]) => counts[t]).map(([t, s]) => (
          <button key={t} className={`lg ${hidden.has(t) ? 'off' : ''}`} onClick={() => toggleType(t)} title={hidden.has(t) ? 'show' : 'hide'}>
            <i style={{ background: s.color }} />{t} <span className="faint">{shown[t] || 0}/{counts[t]}</span>
          </button>
        ))}
        <span className="faint hint">dashed = inferred · hover = neighbours · drag to pin</span>
      </div>
      {card && (
        <div className="card">
          <button className="x" onClick={() => setCard(null)}>✕</button>
          <div className="kv"><b className="bee">{card.type}</b> · {card.id}</div>
          <h4>{card.title}</h4>
          <div className="kv">conf <b>{(card.confidence ?? 1).toFixed(2)}</b> · <b>{card.status}</b>{card.at ? <> · {new Date(card.at).toLocaleDateString()}</> : null}</div>
          {card.outcome && <div className="kv">outcome <b className={card.outcome === 'passed' ? 'ok' : 'bad'}>{card.outcome}</b> · harness v{card.harnessVersion}{card.arm === 'candidate' ? ' (trial)' : ''}{card.tokens ? ` · ${card.tokens.toLocaleString()} tok` : ''}</div>}
          {card.reason && <p><span className="bee">why: </span>{card.reason}</p>}
          {card.body && <p className="muted">{card.body.slice(0, 600)}</p>}
          {card.touches?.length > 0 && <div className="kv">touches: <b>{card.touches.slice(0, 6).join(', ')}</b></div>}
          {card.sources?.length > 0 && <div className="kv">src: {card.sources.map((s) => {
            const m = s.match(/^github:(pr|issue)\/(\d+)$/);
            return m ? <a key={s} onClick={() => window.benana.openExternal(`https://github.com/${project.repo}/${m[1] === 'pr' ? 'pull' : 'issues'}/${m[2]}`)}>{s} </a> : <span key={s}>{s} </span>;
          })}</div>}
        </div>
      )}
      <div className="scrub">
        <input type="range" min={0} max={Math.max(0, history.length - 1)} value={pos < 0 ? Math.max(0, history.length - 1) : pos} onChange={(e) => { const v = Number(e.target.value); setPos(v === history.length - 1 ? -1 : v); }} />
        <div className="labels">
          <span>{history[0] ? new Date(history[0].ts).toLocaleDateString() : ''}</span>
          <span className="now">{at ? `${at.sha.slice(0, 7)} · ${at.actor} · ${at.subject}` : 'no snapshots'}</span>
          <span>{pos < 0 ? 'live' : <a className="bee" onClick={() => setPos(-1)}>{history.length - 1 - pos} back · live ▸</a>}</span>
        </div>
      </div>
    </div>
  );
}

function fitView(c, focusSet, animate) {
  const eles = focusSet.size ? c.nodes().filter((n) => focusSet.has(n.id())).closedNeighborhood() : c.elements();
  if (eles.empty()) return;
  if (animate) c.animate({ fit: { eles, padding: focusSet.size ? 60 : 30 }, duration: 350, easing: 'ease-out-cubic' });
  else c.fit(eles, 30);
}

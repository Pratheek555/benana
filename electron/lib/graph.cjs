// The intent graph: node/edge file format, loading (now or at any commit), and the
// three agent-facing operations: context, check, record.
const { words } = require('./extract.cjs');

const fileSafe = (id) => id.replace(/[^a-zA-Z0-9._-]+/g, '_');
const nodePath = (n) => `nodes/${n.type.toLowerCase()}/${fileSafe(n.id)}.md`;

function serializeNode(n) {
  const { body = '', ...meta } = n;
  return `---\n${JSON.stringify(meta, null, 2)}\n---\n${body}\n`;
}

function parseNode(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  return { ...JSON.parse(m[1]), body: m[2].trim() };
}

function writeGraph(store, { nodes, edges }) {
  for (const n of nodes) store.write(nodePath(n), serializeNode(n));
  for (const e of edges) store.write(`edges/${fileSafe(e.id)}.json`, e);
}

function writeEvent(store, event) {
  const d = new Date(event.at || Date.now());
  const id = event.id || `evt_${d.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  store.write(`events/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}.json`, { id, ...event });
}

function loadFromFiles(entries) {
  const nodes = [];
  const edges = [];
  for (const [name, text] of entries) {
    try {
      if (name.startsWith('nodes/')) { const n = parseNode(text); if (n) nodes.push(n); }
      else if (name.startsWith('edges/')) edges.push(JSON.parse(text));
    } catch { /* skip malformed file */ }
  }
  return { nodes, edges };
}

function loadGraph(store) {
  const entries = [...store.list('nodes'), ...store.list('edges')].map((f) => [f, store.read(f)]);
  return loadFromFiles(entries);
}

async function loadGraphAt(store, sha) {
  return loadFromFiles([...(await store.readAt(sha, 'nodes')), ...(await store.readAt(sha, 'edges'))]);
}

// Score intent nodes against a free-text query and/or a set of files.
function relevant(graph, { text = '', files = [] }, types) {
  const q = new Set(words(text));
  // Hub files (README, index) are touched by most changes, so they are not evidence of overlap.
  const freq = new Map();
  const intentNodes = graph.nodes.filter((n) => n.touches?.length);
  for (const n of intentNodes) for (const f of new Set(n.touches)) freq.set(f, (freq.get(f) || 0) + 1);
  const hub = Math.max(3, intentNodes.length * 0.15);
  const fileSet = new Set(files.filter((f) => (freq.get(f) || 0) <= hub));
  return graph.nodes
    .filter((n) => types.includes(n.type))
    .map((n) => {
      const overlap = words(`${n.title} ${n.body || ''} ${n.reason || ''}`).filter((w) => q.has(w)).length;
      const fileHits = (n.touches || []).filter((f) => fileSet.has(f) || [...fileSet].some((g) => g.endsWith(f) || f.endsWith(g))).length;
      const titleOverlap = [...new Set(words(n.title))].filter((w) => q.has(w)).length;
      return { node: n, score: overlap + fileHits * 3, fileHits, overlap, titleOverlap };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (b.node.confidence || 0) - (a.node.confidence || 0));
}

function context(graph, query, limit = 8) {
  const hits = relevant(graph, query, ['Decision', 'DeadEnd', 'Direction', 'Intent']).slice(0, limit);
  return hits.map(({ node: n, score }) => ({
    id: n.id, type: n.type, title: n.title, reason: n.reason || '', status: n.status,
    confidence: n.confidence, sources: n.sources, touches: (n.touches || []).slice(0, 5), score,
  }));
}

// Flag plans/diffs that repeat a dead end or overlap a recorded decision.
// A hit needs real evidence: shared files AND shared vocabulary, or most of the node's title words.
// Nodes written by the same attempt are ignored, and conflicts the agent explicitly
// acknowledged (by citing the node id in its reply or a recorded Decision) count as resolved.
function check(graph, { text = '', files = [], attempt, acknowledge = '' }) {
  const own = new Set(graph.nodes.filter((n) => attempt && n.attempt === attempt).map((n) => n.id));
  const ackText = `${acknowledge} ${graph.nodes.filter((n) => own.has(n.id)).map((n) => `${n.title} ${n.reason}`).join(' ')}`;
  const strong = (h) => {
    const titleWords = new Set(words(h.node.title)).size || 1;
    return (h.fileHits > 0 && h.titleOverlap >= 1 && h.overlap >= 2) || (h.titleOverlap >= 3 && h.titleOverlap / titleWords >= 0.5);
  };
  const conflicts = [];
  for (const [kind, type] of [['repeats_dead_end', 'DeadEnd'], ['touches_decision', 'Decision']]) {
    for (const h of relevant(graph, { text, files }, [type])) {
      if (own.has(h.node.id) || !strong(h)) continue;
      if (type === 'Decision' && h.fileHits === 0) continue;
      conflicts.push({
        kind, node: h.node.id, title: h.node.title, reason: h.node.reason, sources: h.node.sources,
        strength: h.score, acknowledged: ackText.includes(h.node.id),
      });
    }
  }
  return conflicts.sort((a, b) => b.strength - a.strength).slice(0, 5);
}

function record(store, { type, title, reason = '', touches = [], source = 'agent', attempt }) {
  const allowed = ['Decision', 'DeadEnd', 'Intent'];
  if (!allowed.includes(type)) throw new Error(`type must be one of ${allowed.join(', ')}`);
  const id = `${type === 'DeadEnd' ? 'dead' : type === 'Decision' ? 'dec' : 'int'}_${Date.now().toString(36)}`;
  const node = { id, type, title, reason, touches, at: Date.now(), status: 'recorded', confidence: 0.9, sources: [source], attempt };
  store.write(nodePath(node), serializeNode(node));
  return node;
}

module.exports = { writeGraph, writeEvent, loadGraph, loadGraphAt, context, check, record, serializeNode, nodePath };

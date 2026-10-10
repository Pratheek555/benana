// Bridges Entire's code graph (files, symbols, imports, calls, co-change) and the intent graph.
// Entire answers "what is connected to this file"; the intent graph answers "why is it this way".
// Together they let an agent find past decisions on files its task will ripple into.
const entire = require('./entire.cjs');
const { git } = require('./git.cjs');
const graphLib = require('./graph.cjs');

// File-level links worth following, with how strongly each implies "changing A affects B".
const LINK_WEIGHT = { FILE_CHANGES_WITH: 1, IMPORTS: 0.8, CALLS: 0.7, USES_TYPE: 0.6, PARAM_TYPE: 0.5 };

const cache = new Map(); // repoPath -> { key, at, value }
const TTL_MS = 5 * 60 * 1000;

// Entire snapshot rolled up to files, cached per checkout HEAD (snapshots take ~0.5s).
async function snapshot(repoPath, deps = {}) {
  if (!repoPath) return { available: false, files: [], links: [], error: 'Open a local project first.' };
  let key = '';
  try { key = (await git(repoPath, ['rev-parse', 'HEAD'])).trim(); } catch { /* not a git checkout */ }
  const hit = cache.get(repoPath);
  if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) return hit.value;
  const raw = await (deps.graph || entire.graph)(repoPath);
  const value = raw.available ? { available: true, ...fileGraph(raw) } : { available: false, files: [], links: [], error: raw.error };
  cache.set(repoPath, { key, at: Date.now(), value });
  return value;
}

function fileGraph({ nodes, edges }) {
  const fileOf = new Map();
  for (const n of nodes) if (n.file && !String(n.kind || '').startsWith('external')) fileOf.set(n.id, n.file);
  const links = new Map();
  for (const e of edges) {
    const weight = LINK_WEIGHT[e.relation];
    const from = fileOf.get(e.source);
    const to = fileOf.get(e.target);
    if (!weight || !from || !to || from === to) continue;
    const id = `${from}|${to}|${e.relation}`;
    const link = links.get(id) || { from, to, type: e.relation, count: 0, confidence: 0, reason: e.reason || '' };
    link.count += 1;
    link.confidence = Math.max(link.confidence, Number(e.confidence) || 0);
    links.set(id, link);
  }
  const files = [...new Set(nodes.filter((n) => n.kind === 'file' && n.file).map((n) => n.file))];
  return { files, links: [...links.values()] };
}

// Files one hop from `files` in the code graph, strongest first.
function related(code, files, limit = 12) {
  const given = new Set(files);
  const scores = new Map();
  for (const l of code.links || []) {
    for (const [a, b] of [[l.from, l.to], [l.to, l.from]]) {
      if (!given.has(a) || given.has(b)) continue;
      const s = scores.get(b) || { file: b, weight: 0, via: new Set() };
      s.weight += LINK_WEIGHT[l.type] * Math.max(l.confidence, 0.5);
      s.via.add(l.type);
      scores.set(b, s);
    }
  }
  return [...scores.values()]
    .sort((x, y) => y.weight - x.weight)
    .slice(0, limit)
    .map((s) => ({ file: s.file, weight: +s.weight.toFixed(2), via: [...s.via] }));
}

// Code map with the intent overlay: each file carries the decisions, dead ends and runs behind it.
function overlay(intent, code) {
  const files = code.files.map((file) => {
    const h = graphLib.fileHistory(intent, file);
    return {
      file,
      decisions: h.counts.Decision || 0,
      deadEnds: h.counts.DeadEnd || 0,
      runs: h.counts.AgentRun || 0,
      intents: h.counts.Intent || 0,
      latest: h.timeline.at(-1) || null,
    };
  });
  return { available: code.available, error: code.error, files, links: code.links };
}

// Why a file is the way it is: its own history plus the history of files it moves with.
function why(intent, code, file) {
  const own = graphLib.fileHistory(intent, file);
  const neighbours = related(code, [file], 6).map((r) => ({ ...r, history: graphLib.fileHistory(intent, r.file).timeline.slice(-3) }))
    .filter((r) => r.history.length);
  return { ...own, related: neighbours };
}

module.exports = { snapshot, fileGraph, related, overlay, why, _clear: () => cache.clear() };

// Turns GitHub history into intent nodes + typed edges.
// Pass 1 is deterministic (always runs). Pass 2 optionally asks the local `claude` CLI
// to enrich the most important PRs; anything it produces is marked `inferred`.
const { pullFiles } = require('./github.cjs');
const { askClaude } = require('./llm.cjs');

const STOP = new Set('the a an and or of to in for on with from by is are be this that it as at use add fix update remove support when into not build deps bump chore docs added typo typos fixed minor small change changes readme'.split(' '));
// Bot PRs (dependency bumps etc.) carry no human intent; keep them as PR nodes only.
const isBot = (p) => p.user?.type === 'Bot' || /\[bot\]$|^dependabot|^renovate/i.test(p.user?.login || '');
const stem = (w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s = '') => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).map(stem);
const short = (s, n = 280) => (s || '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, n);
const closesRe = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
const revertRe = /^revert\s+"?(.+?)"?$/i;

function addEdge(edges, from, to, type, props = {}) {
  edges.push({ id: `e_${from}_${type}_${to}`, from, to, type, confidence: 1, status: 'recorded', ...props });
}

async function extract(repo, hist, { filesForTop = 25, deep = false, log = () => {} } = {}) {
  const nodes = [];
  const edges = [];
  const now = Date.now();

  for (const i of hist.issues) {
    nodes.push({
      id: `issue_${i.number}`, type: 'Issue', title: i.title, body: short(i.body), state: i.state,
      labels: i.labels.map((l) => l.name), author: i.user?.login, at: Date.parse(i.created_at),
      sources: [`github:issue/${i.number}`], status: 'recorded', confidence: 1, url: i.html_url,
    });
  }

  const titleIndex = new Map(hist.pulls.map((p) => [p.title.toLowerCase(), p]));
  // Fetch touched files for the most recent merged (decisions) and unmerged (dead ends) PRs.
  const closed = hist.pulls.filter((p) => p.state === 'closed');
  const half = Math.ceil(filesForTop / 2);
  const top = new Set([
    ...closed.filter((p) => p.merged_at && !isBot(p)).slice(0, half),
    ...closed.filter((p) => !p.merged_at && !isBot(p)).slice(0, half),
  ].map((p) => p.number));

  for (const p of hist.pulls) {
    const merged = Boolean(p.merged_at);
    const state = merged ? 'merged' : p.state;
    const files = top.has(p.number) ? await pullFiles(repo, p.number) : [];
    const prId = `pr_${p.number}`;
    nodes.push({
      id: prId, type: 'PR', title: p.title, body: short(p.body), state, author: p.user?.login,
      at: Date.parse(p.created_at), touches: files, sources: [`github:pr/${p.number}`],
      status: 'recorded', confidence: 1, url: p.html_url,
    });
    if (p.user?.login) addEdge(edges, prId, `person_${p.user.login}`, 'authored_by');

    for (const m of `${p.title} ${p.body || ''}`.matchAll(closesRe)) addEdge(edges, prId, `issue_${m[1]}`, 'closes');

    // Merged PRs encode a decision; closed-unmerged PRs encode a dead end.
    if (isBot(p)) { /* no intent */ } else if (merged) {
      nodes.push({
        id: `dec_${p.number}`, type: 'Decision', title: p.title, body: short(p.body, 400),
        reason: firstReason(p.body), at: Date.parse(p.merged_at), touches: files,
        sources: [`github:pr/${p.number}`], status: 'inferred', confidence: 0.6,
      });
      addEdge(edges, `dec_${p.number}`, prId, 'recorded_in');
    } else if (p.state === 'closed') {
      nodes.push({
        id: `dead_${p.number}`, type: 'DeadEnd', title: p.title, body: short(p.body, 400),
        reason: 'Closed without merging', at: Date.parse(p.closed_at), touches: files,
        sources: [`github:pr/${p.number}`], status: 'inferred', confidence: 0.55,
      });
      addEdge(edges, `dead_${p.number}`, prId, 'rejected_in', { status: 'inferred', confidence: 0.55 });
    }

    const rev = p.title.match(revertRe);
    if (rev && titleIndex.has(rev[1].toLowerCase())) {
      const orig = titleIndex.get(rev[1].toLowerCase());
      addEdge(edges, prId, `pr_${orig.number}`, 'reverts');
      nodes.push({
        id: `dead_rev_${orig.number}`, type: 'DeadEnd', title: orig.title, reason: `Reverted by #${p.number}`,
        at: Date.parse(p.created_at), touches: files, sources: [`github:pr/${orig.number}`, `github:pr/${p.number}`],
        status: 'recorded', confidence: 0.9,
      });
      addEdge(edges, `dead_rev_${orig.number}`, `pr_${orig.number}`, 'rejected_in');
    }
    for (const f of files) addEdge(edges, prId, `file_${f}`, 'touches');
  }

  // People and files are first-class nodes so agents can traverse to them.
  for (const e of edges) {
    if (e.to.startsWith('person_') && !nodes.some((n) => n.id === e.to)) nodes.push({ id: e.to, type: 'Person', title: e.to.slice(7), status: 'recorded', confidence: 1, sources: [] });
    if (e.to.startsWith('file_') && !nodes.some((n) => n.id === e.to)) nodes.push({ id: e.to, type: 'File', title: e.to.slice(5), status: 'recorded', confidence: 1, sources: [] });
  }

  directions(nodes, edges);
  if (deep) await enrich(nodes, log);
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: dedupe(edges).filter((e) => ids.has(e.from) && ids.has(e.to)), at: now };
}

function firstReason(body = '') {
  const m = (body || '').match(/(?:because|so that|in order to|motivation[:\s]+|why[:\s]+)([^\n.]{12,200})/i);
  return m ? m[1].trim() : '';
}

// Directions: recurring themes across merged work, from labels and title keywords.
function directions(nodes, edges) {
  const counts = new Map();
  const decisions = nodes.filter((n) => n.type === 'Decision');
  for (const d of decisions) for (const w of new Set(words(d.title))) counts.set(w, (counts.get(w) || 0) + 1);
  const themes = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [w, c] of themes) {
    const id = `dir_${w}`;
    const members = decisions.filter((d) => words(d.title).includes(w));
    nodes.push({
      id, type: 'Direction', title: w, body: `${c} merged changes advance "${w}".`,
      at: Math.min(...members.map((m) => m.at)), status: 'inferred', confidence: Math.min(0.9, 0.3 + c * 0.1), sources: [],
    });
    for (const m of members) addEdge(edges, m.id, id, 'advances', { status: 'inferred', confidence: 0.6 });
  }
}

async function enrich(nodes, log) {
  const targets = nodes.filter((n) => n.type === 'DeadEnd' || n.type === 'Decision').slice(0, 20);
  log(`deep extraction: asking claude about ${targets.length} nodes`);
  const prompt = `For each item, state in one sentence WHY it was done (Decision) or WHY it was abandoned (DeadEnd), using only the given text. If the text does not say, answer "unknown". Reply with JSON only: {"<id>": "<reason>"}.\n\n${targets.map((t) => `${t.id} [${t.type}] ${t.title}\n${(t.body || '').slice(0, 300)}`).join('\n\n')}`;
  const out = await askClaude(prompt, { json: true }).catch((e) => { log(`deep extraction skipped: ${e.message}`); return null; });
  if (!out) return;
  for (const t of targets) {
    const r = out[t.id];
    if (r && r !== 'unknown') { t.reason = r; t.confidence = Math.min(0.85, t.confidence + 0.15); }
  }
}

function dedupe(edges) {
  const m = new Map();
  for (const e of edges) m.set(e.id, e);
  return [...m.values()];
}

module.exports = { extract, words };

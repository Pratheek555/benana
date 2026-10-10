const test = require("node:test");
const assert = require("node:assert/strict");
const graph = require("../electron/lib/graph.cjs");
const codeGraph = require("../electron/lib/code-graph.cjs");

const g = {
  nodes: [
    { id: "dec_1", type: "Decision", title: "Use dark palette on visit page", touches: ["app/contact/page.module.css"], at: 2, status: "recorded" },
    { id: "dead_1", type: "DeadEnd", title: "Inline map iframe", touches: ["app/components/deferred-map.tsx"], at: 1, status: "inferred" },
    { id: "run_a", type: "AgentRun", title: "claude · darken visit", touches: ["app/contact/page.module.css"], at: 3, outcome: "passed", status: "recorded" },
    { id: "dir_ui", type: "Direction", title: "ui polish", status: "inferred" },
  ],
  edges: [
    { id: "e1", from: "dec_1", to: "dir_ui", type: "advances" },
    { id: "e2", from: "run_a", to: "dec_1", type: "touches" },
  ],
};
const entireRaw = {
  available: true,
  nodes: [
    { id: "f:css", kind: "file", file: "app/contact/page.module.css" },
    { id: "f:page", kind: "file", file: "app/contact/page.tsx" },
    { id: "f:map", kind: "file", file: "app/components/deferred-map.tsx" },
    { id: "s:Contact", kind: "function", file: "app/contact/page.tsx" },
    { id: "x:react", kind: "external:import" },
  ],
  edges: [
    { source: "f:page", target: "f:css", relation: "IMPORTS", confidence: 1 },
    { source: "s:Contact", target: "f:map", relation: "CALLS", confidence: 0.9 },
    { source: "f:page", target: "x:react", relation: "IMPORTS", confidence: 0.8 },
    { source: "f:page", target: "f:page", relation: "FILE_CHANGES_WITH", confidence: 1 },
  ],
};

test("fileHistory lists everything that touched a file, oldest first, with its directions", () => {
  const h = graph.fileHistory(g, "app/contact/page.module.css");
  assert.deepEqual(h.timeline.map((n) => n.id), ["dec_1", "run_a"]);
  assert.deepEqual(h.directions.map((n) => n.id), ["dir_ui"]);
  assert.deepEqual(h.counts, { Decision: 1, AgentRun: 1 });
});

test("node returns both edge directions and neighborhood stays within depth", () => {
  const n = graph.node(g, "dec_1");
  assert.deepEqual(n.out.map((x) => x.node.id), ["dir_ui"]);
  assert.deepEqual(n.in.map((x) => x.node.id), ["run_a"]);
  assert.equal(graph.node(g, "missing"), null);
  const sub = graph.neighborhood(g, "run_a", 1);
  assert.deepEqual(sub.nodes.map((x) => x.id).sort(), ["dec_1", "run_a"]);
});

test("diff reports added, removed and changed nodes and edges", () => {
  const after = { nodes: [{ ...g.nodes[0], title: "changed" }, g.nodes[2], { id: "int_1", type: "Intent", title: "new" }], edges: [g.edges[1]] };
  const d = graph.diff(g, after);
  assert.deepEqual(d.added.map((n) => n.id), ["int_1"]);
  assert.deepEqual(d.removed.map((n) => n.id).sort(), ["dead_1", "dir_ui"]);
  assert.deepEqual(d.changed.map((n) => n.id), ["dec_1"]);
  assert.deepEqual(d.edgesRemoved.map((e) => e.id), ["e1"]);
});

test("code graph rolls symbols up to file links and drops externals and self links", async () => {
  codeGraph._clear();
  const code = await codeGraph.snapshot("/nonexistent", { graph: async () => entireRaw });
  assert.equal(code.available, true);
  assert.deepEqual(code.links.map((l) => `${l.from}>${l.to}:${l.type}`).sort(), [
    "app/contact/page.tsx>app/components/deferred-map.tsx:CALLS",
    "app/contact/page.tsx>app/contact/page.module.css:IMPORTS",
  ]);
  assert.deepEqual(codeGraph.related(code, ["app/contact/page.tsx"]).map((r) => r.file), [
    "app/contact/page.module.css",
    "app/components/deferred-map.tsx",
  ]);
});

test("related files surface intent in context but never raise intent_check conflicts", () => {
  const related = [{ file: "app/components/deferred-map.tsx", weight: 0.9 }];
  const ctx = graph.context(g, { text: "tweak contact page", files: ["app/contact/page.tsx"], related });
  const dead = ctx.find((c) => c.id === "dead_1");
  assert.equal(dead?.via, "related-file");
  const conflicts = graph.check(g, { text: "inline map iframe", files: ["app/contact/page.tsx"] });
  assert.equal(conflicts.length, 0);
});

test("why combines a file's own history with connected files' history", () => {
  const code = codeGraph.fileGraph(entireRaw);
  const w = codeGraph.why(g, code, "app/contact/page.tsx");
  assert.deepEqual(w.timeline, []);
  assert.deepEqual(w.related.map((r) => r.file).sort(), ["app/components/deferred-map.tsx", "app/contact/page.module.css"]);
});

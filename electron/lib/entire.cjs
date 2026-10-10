const { execFile } = require("node:child_process");

const execute = (args, cwd, exec = execFile) =>
  new Promise((resolve) =>
    exec(
      "entire",
      args,
      { cwd, timeout: 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          out: String(stdout || "").trim(),
          error: String(stderr || error?.message || "").trim(),
          missing: error?.code === "ENOENT",
        }),
    ),
  );
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
function items(value) {
  if (Array.isArray(value)) return value;
  for (const key of [
    "items",
    "results",
    "matches",
    "checkpoints",
    "sessions",
    "data",
  ])
    if (Array.isArray(value?.[key])) return value[key];
  return value && typeof value === "object" ? [value] : [];
}
function sourcedItems(value) {
  return items(value).map((item) => ({ ...item, source: "entire", raw: item }));
}
function searchEntries(raw) {
  return items(raw).map((match, index) => {
    const file = match.file_path || match.file || match.path || match.symbol?.file_path;
    const symbol = match.symbol_name || match.qualified_name || match.name || match.symbol?.name;
    const lines = match.start_line ? `:${match.start_line}${match.end_line && match.end_line !== match.start_line ? `-${match.end_line}` : ""}` : "";
    return {
      id: String(match.id || match.symbol_id || match.symbol?.id || `entire_${index}`),
      title: String(match.title || (symbol && file ? `${symbol} (${file}${lines})` : symbol || file || `Entire match ${index + 1}`)),
      summary: String(
        match.summary || match.snippet || match.context || match.text || match.content || JSON.stringify(match),
      ).slice(0, 4000),
      reason: String(
        match.reason || match.explanation || match.rank_reason || match.ranking?.reason ||
          (match.signals?.length ? `matched on ${match.signals.join(", ")}` : ""),
      ),
      file: file || undefined,
      source: "entire",
      raw: match,
    };
  });
}
function snapshotGraph(text) {
  const nodes = [];
  const edges = [];
  const errors = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const record = json(line);
    if (!record) {
      errors.push(`line ${index + 1} was not JSON`);
      continue;
    }
    const type = String(record.record_type || "").toLowerCase();
    if (type === "relation") {
      const source = record.from_id;
      const target = record.to_id;
      if (source && target)
        edges.push({
          id: String(record.id || `entire_edge_${edges.length}`),
          source: String(source),
          target: String(target),
          relation: String(record.type),
          reason: record.reason,
          confidence: record.confidence,
          file: record.evidence?.[0]?.file_path,
        });
    } else if (
      type === "symbol" || type === "file" || type === "external"
    ) {
      const id = record.id;
      if (id)
        nodes.push({
          id: String(id),
          label: String(
            record.qualified_name || record.name || record.path || record.value || id,
          ),
          file: record.file_path || record.path,
          kind: type === "external"
            ? `external:${record.kind || "unknown"}`
            : record.kind || (type === "file" ? "file" : undefined),
          source: "entire",
        });
    }
  }
  const ids = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  if (validEdges.length !== edges.length)
    errors.push(`${edges.length - validEdges.length} relation(s) referenced nodes absent from the snapshot.`);
  return { nodes, edges: validEdges, errors };
}
async function status(repoPath, deps = {}) {
  const call = deps.execute || execute;
  const version = await call(["version", "--json"], repoPath);
  if (version.missing)
    return {
      installed: false,
      error: "Install Entire and ensure the entire executable is on PATH.",
    };
  if (!version.ok)
    return {
      installed: true,
      enabled: false,
      error: version.error || version.out,
    };
  if (!repoPath) return { installed: true, enabled: false, version: json(version.out) || version.out };
  const state = await call(["status", "--json"], repoPath);
  const stateData = json(state.out);
  const reportedEnabled = stateData?.enabled ?? stateData?.repository?.enabled ?? stateData?.entire_enabled;
  return {
    installed: true,
    enabled: state.ok && reportedEnabled !== false,
    version: json(version.out) || version.out,
    ...(!state.ok || reportedEnabled === false
      ? { error: state.error || (!state.ok ? state.out : "") || "Entire is not enabled for this repository." }
      : {}),
  };
}
async function overview(repoPath, deps = {}) {
  if (!repoPath) {
    const missing = {
      available: false,
      items: [],
      error: "Open a local project first.",
    };
    return {
      status: { installed: false },
      checkpoints: missing,
      sessions: missing,
      graph: { available: false, error: missing.error },
    };
  }
  const call = deps.execute || execute;
  const [state, cps, sessions, version] = await Promise.all([
    status(repoPath, deps),
    call(["checkpoint", "list", "--json", "--no-pager"], repoPath),
    call(["sessions", "list", "--json"], repoPath),
    call(["graph", "version", "--json"], repoPath),
  ]);
  const normalize = (result) =>
    result.ok
      ? { available: true, items: sourcedItems(json(result.out) || result.out) }
      : {
          available: false,
          items: [],
          error: result.missing
            ? "Entire is not installed or is not on PATH."
            : result.error || result.out || "Entire command failed.",
        };
  return {
    status: state,
    checkpoints: normalize(cps),
    sessions: normalize(sessions),
    graph: version.ok
      ? { available: true }
      : {
          available: false,
          error: version.error || version.out || "Entire Graph is unavailable.",
        },
  };
}
async function context(repoPath, text, deps = {}) {
  if (!repoPath)
    return {
      provider: "entire",
      available: false,
      entries: [],
      errors: ["Open a local project first."],
    };
  const result = await (deps.execute || execute)(
    [
      "graph",
      "search",
      "--repo",
      repoPath,
      "--profile",
      "full",
      "--query",
      text,
      "--format",
      "json",
      "--top-k",
      "5",
      "--max-context-bytes",
      "12000",
    ],
    repoPath,
  );
  if (!result.ok)
    return {
      provider: "entire",
      available: false,
      entries: [],
      errors: [
        result.missing
          ? "Entire is not installed or is not on PATH."
          : result.error || result.out || "Entire Graph search failed.",
      ],
    };
  const parsed = json(result.out);
  return parsed
    ? { provider: "entire", available: true, entries: searchEntries(parsed) }
    : {
        provider: "entire",
        available: true,
        entries: [],
        errors: ["Entire Graph returned an unrecognized response."],
        raw: result.out,
      };
}
async function graph(repoPath, deps = {}) {
  if (!repoPath)
    return {
      available: false,
      nodes: [],
      edges: [],
      error: "Open a local project first.",
    };
  const result = await (deps.execute || execute)(
    [
      "graph",
      "snapshot",
      "--repo",
      repoPath,
      "--format",
      "ndjson",
      "--worktree",
    ],
    repoPath,
  );
  if (!result.ok)
    return {
      available: false,
      nodes: [],
      edges: [],
      error: result.missing
        ? "Entire is not installed or is not on PATH."
        : result.error || result.out || "Entire Graph snapshot failed.",
    };
  const parsed = snapshotGraph(result.out);
  if (!parsed.nodes.length && !parsed.edges.length)
    return {
      available: false,
      nodes: [],
      edges: [],
      error: parsed.errors[0] || "Entire Graph returned an empty snapshot.",
    };
  return {
    available: true,
    nodes: parsed.nodes,
    edges: parsed.edges,
    ...(parsed.errors.length ? { error: parsed.errors.join("; ") } : {}),
  };
}
module.exports = {
  context,
  graph,
  overview,
  searchEntries,
  snapshotGraph,
  status,
};

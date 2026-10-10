import React from "react";
import { call } from "../../api.js";
import { Empty, ROLE, shortSha } from "./shared.jsx";

function groupByDir(paths) {
  const groups = new Map();
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    const dir = i < 0 ? "" : p.slice(0, i);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(p);
  }
  return [...groups.entries()];
}

function diffKind(line) {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("@@")) return "hunk";
  if (/^(commit |Author:|Date:)/.test(line)) return "meta";
  return "";
}

export default function CodeView({ mod, initialSha }) {
  const commits = React.useMemo(
    () =>
      mod.attempts.flatMap((a) =>
        [
          a.commit?.sha && {
            sha: a.commit.sha,
            title: `Attempt ${a.n} · ${a.role === "seeded" ? "Seeded" : ROLE[a.role]}`,
            failed: a.failure?.kind === "build",
          },
          a.playtestCommit?.sha && { sha: a.playtestCommit.sha, title: `Playtest ${a.n}`, failed: !a.verdict?.passed },
        ].filter(Boolean),
      ),
    [mod],
  );

  const [view, setView] = React.useState(initialSha ? "changes" : "files");
  const [files, setFiles] = React.useState(null);
  const [filesError, setFilesError] = React.useState("");
  const [openPath, setOpenPath] = React.useState(null);
  const [content, setContent] = React.useState("");
  const [sha, setSha] = React.useState(initialSha || commits.at(-1)?.sha || null);
  const [patch, setPatch] = React.useState("");

  React.useEffect(() => {
    setFiles(null);
    setFilesError("");
    if (!mod.repoDir) return;
    call("studio:files", { id: mod.id })
      .then((list) => {
        setFiles(list);
        setOpenPath((cur) => (cur && list.includes(cur) ? cur : list.find((f) => f.endsWith(".java")) || list[0] || null));
      })
      .catch((e) => setFilesError(e.message));
  }, [mod.id, mod.repoDir, mod.attempts.length]);

  React.useEffect(() => {
    if (!openPath) return;
    setContent("");
    call("studio:file", { id: mod.id, path: openPath })
      .then(setContent)
      .catch((e) => setContent(`// ${e.message}`));
  }, [mod.id, openPath, mod.attempts.length]);

  React.useEffect(() => {
    if (initialSha) setSha(initialSha);
  }, [initialSha]);

  React.useEffect(() => {
    if (!sha) return;
    setPatch("");
    call("studio:diff", { id: mod.id, sha })
      .then(setPatch)
      .catch((e) => setPatch(e.message));
  }, [mod.id, sha]);

  if (!mod.repoDir) return <Empty>This mod has no repository yet. Code appears after the repo is created.</Empty>;

  return (
    <div className="code">
      <div className="segmented">
        <button className={view === "files" ? "on" : ""} onClick={() => setView("files")}>
          Files
          <span>{files?.length ?? ""}</span>
        </button>
        <button className={view === "changes" ? "on" : ""} onClick={() => setView("changes")}>
          Changes
          <span>{commits.length}</span>
        </button>
      </div>

      {view === "files" ? (
        <div className="code-split">
          <nav className="file-tree" aria-label="Files">
            {filesError && <div className="studio-error">{filesError}</div>}
            {!files && !filesError && <Empty>Loading files…</Empty>}
            {files &&
              groupByDir(files).map(([dir, list]) => (
                <div key={dir || "root"} className="tree-group">
                  <small>{dir || "/"}</small>
                  {list.map((p) => (
                    <button key={p} className={p === openPath ? "on" : ""} onClick={() => setOpenPath(p)}>
                      {p.slice(p.lastIndexOf("/") + 1)}
                    </button>
                  ))}
                </div>
              ))}
          </nav>
          <div className="viewer">
            <div className="viewer-head mono">{openPath}</div>
            <div className="code-body">
              {content.split("\n").map((line, i) => (
                <div key={i} className="code-line">
                  <span className="ln">{i + 1}</span>
                  <span className="lc">{line || " "}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="code-split">
          <nav className="file-tree commit-list" aria-label="Commits">
            {commits.map((c) => (
              <button key={c.sha} className={c.sha === sha ? "on" : ""} onClick={() => setSha(c.sha)}>
                <span>{c.title}</span>
                <small className="mono">
                  {shortSha(c.sha)}
                  {c.failed ? " · failed" : ""}
                </small>
              </button>
            ))}
            {!commits.length && <Empty>No commits yet.</Empty>}
          </nav>
          <div className="viewer">
            <div className="viewer-head mono">{sha ? shortSha(sha) : "No commit selected"}</div>
            <div className="code-body">
              {patch.split("\n").map((line, i) => (
                <div key={i} className={`code-line ${diffKind(line)}`}>
                  <span className="lc">{line || " "}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

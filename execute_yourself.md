# Run benana yourself

benana is a desktop harness for coding agents built around an **intent graph**. It reads a repo's history to learn why changes were made, which approaches failed, and where the project is heading. Agents check that graph before they write code. The harness also improves itself through four loops:

| Loop | What it does in this MVP |
|---|---|
| **L1 agent** | Runs `claude` or `codex` in its own git worktree, with the `benana-intent` MCP tools and the relevant intent loaded into the prompt |
| **L2 verify** | Runs graders after each attempt: files changed, diff scope, optional test command, `intent.check`. Failures go back to the agent (2 attempts by default) |
| **L3 events** | Polls GitHub issues every 2 minutes. An issue labelled `benana:auto` starts a run automatically |
| **L4 improve** | An analyst reads past runs (plus Neatlogs traces when configured) and proposes a **harness PR**. You approve or reject it |

---

## 1. Prerequisites

| Need | Why | Check |
|---|---|---|
| Node 20+ (tested on 22) | Electron and Vite | `node -v` |
| git | Intent and harness stores, worktrees | `git --version` |
| `claude` CLI, logged in | Agent runs, deep extraction, the L4 analyst (uses your own login, no API key needed) | `claude --version` |
| `codex` CLI (optional) | Run Codex as the agent | `codex --version` |
| `gh` CLI logged in **or** `GITHUB_TOKEN` | GitHub API (unauthenticated is limited to 60 requests per hour) | `gh auth status` |
| `entire` CLI (optional) | Code-to-session provenance | `brew install --cask entireio/tap/entire` |

## 2. Environment

benana reads `.env` at the repo root (copy `.env.example` to start).

| Variable | Required | Used for |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes, for Artifacts | Intent and harness repos, per-agent forks, scoped tokens. Set it in `.env`. |
| `CLOUDFLARE_ACCOUNT_ID` | no | Otherwise it is read from the token |
| `ARTIFACTS_NAMESPACE` | no | Default `benana-dev` |
| `GITHUB_TOKEN` | no | Falls back to `gh auth token` |
| `NEATLOGS_API_KEY` + `NEATLOGS_PROJECT_ID` | no | L4 reads recent traces. Use a service-account token. |
| `NEATLOGS_REGION=eu` | no | EU Neatlogs host |
| `BENANA_DATA_DIR` | no | Local data, default `~/.benana` |

Without the Cloudflare token, everything still works locally (stores are plain git repos). Only the Artifacts sync and forks are skipped.

## 3. Install and run

```sh
npm install
# package.json already allows the electron/esbuild install scripts. If npm still reports
# them as blocked (Electron then fails to start), run:
#   npm install-scripts approve electron esbuild && npm rebuild electron esbuild

npm run dev      # Vite on :5199 + Electron, with hot reload
# or
npm start        # production build, then Electron
```

## 4. First session (about 5 minutes)

1. Clone a repo you want to work on, for example:
   `git clone https://github.com/expressjs/cors ~/code/cors`
2. In benana, enter **GitHub repo** `expressjs/cors` and **Local checkout** `~/code/cors`, then click **Open project**.
   - The first open ingests up to 200 issues and 200 PRs and builds the graph: merged PRs become **Decisions**, closed-unmerged PRs and reverts become **DeadEnds**, recurring themes become **Directions**. Bot PRs (Dependabot, Renovate) are skipped.
   - The graph is committed locally (`~/.benana/intent/<repo>`) and pushed to Artifacts as `benana-dev/intent-<owner>-<repo>`.
   - Tick **Deep extraction** to have `claude` write the *why* for the top 20 decisions and dead ends.
3. **Graph panel:** click any node to see its *why*, confidence and sources (GitHub links). `task` shows an overview; `all` shows everything. Drag the **scrubber** to replay earlier graph snapshots: every commit is one state of the intent graph.
4. **Start an agent:** either click **start ▸** on an inbox issue, or type a task in the `brief ›` box (pick `claude` or `codex`) and press Enter.
   - The run gets a worktree at `~/.benana/worktrees/<id>` on branch `benana/<id>`. Your own checkout is never touched.
   - Its intent fork is a local clone plus an Artifacts fork `intent-…-<id>`.
   - Watch the **live transcript**. **Verify** shows grader results; an `intent.check` conflict links to the dead end it repeats.
   - When the run finishes, the agent's Decisions and DeadEnds are merged into the main graph, an `AgentRun` node is added, and everything is pushed to Artifacts.
5. **Steer:** select a run in the agent bar and type into `brief ›`. If it's still running, your message is sent when the current turn ends; otherwise the session is resumed.
6. **Improve:** click **run analyst**. It proposes one harness change with evidence. **approve** creates a new harness version (committed to `harness-<repo>` and pushed to Artifacts); the next runs use it. Changes to graders are flagged.
7. **Your own Claude Code / Codex sessions:**
   - *Observe* is automatic: sessions running inside the repo path appear in the agent bar as **attached** (from `~/.claude/projects` and `~/.codex/sessions`), with their live transcript.
   - *Assist:* click **⇄ connect local sessions**, review the exact config changes, then click **Connect**. This registers the `benana-intent` MCP server in your user-level Claude Code config and in `~/.codex/config.toml` (backed up first). Every session you start in a terminal can then call `intent_context`, `intent_check` and `intent_record`. **Remove** undoes it.
   - *Control:* select an attached session and type a brief. benana resumes that session inside its loops, in the session's own directory.

## 5. Neatlogs and Entire

- **Neatlogs ingestion** comes from Neatlogs' own integrations: install their Claude Code plugin or Codex hooks (docs.neatlogs.com → Integrations). Then set `NEATLOGS_API_KEY` and `NEATLOGS_PROJECT_ID` so the L4 analyst reads recent traces as evidence. The status bar dot turns green when the API responds.
- **Entire:** run `entire enable` in your checkout. benana detects the CLI (status bar dot) and agent sessions get checkpoints linked to commits. Reading Entire checkpoints into the graph is next on the list (see below).

## 6. Use the intent tools without the app

```sh
# Claude Code (any terminal session)
claude mcp add --scope user benana-intent -e BENANA_INTENT_DIR=$HOME/.benana/intent/expressjs-cors -- node "$PWD/electron/mcp-server.cjs"
```

## 7. Where things live

```
~/.benana/
  config.json                 last opened project
  intent/<repo>/              intent graph git repo → Artifacts intent-<repo>
    nodes/<type>/<id>.md      one file per node (JSON front matter + body)
    edges/<id>.json           typed edges (confidence, recorded|inferred)
    events/YYYY/MM/*.json     append-only facts (ingests, agent runs)
  harness/<repo>/             harness.json + proposals/ → Artifacts harness-<repo>
  worktrees/<run-id>/         agent workspaces (branch benana/<run-id>)
  attempts/<run-id>/intent/   the attempt's intent fork
  runs/<run-id>.json          run records used by the L4 analyst
```

Clean up a run's worktree: `git -C <your checkout> worktree remove ~/.benana/worktrees/<id>`.

## 8. Code map

```
electron/main.cjs            IPC, project lifecycle, L3 polling
electron/mcp-server.cjs      benana-intent MCP server (stdio)
electron/lib/extract.cjs     GitHub history → nodes and edges (+ optional claude enrichment)
electron/lib/graph.cjs       file format, load at any commit, context / check / record
electron/lib/agents.cjs      L1 runs (claude / codex), L2 graders + retry, checkpoint and merge
electron/lib/improve.cjs     L4 analyst, harness proposals, approve / reject
electron/lib/sessions.cjs    detect / attach / connect local Claude Code and Codex sessions
electron/lib/artifacts.cjs   Cloudflare Artifacts adapter (namespace, repo, fork, token, push, pull)
electron/lib/neatlogs.cjs    Neatlogs public API (traces, search)
electron/lib/entire.cjs      Entire CLI detection
src/                         React UI (status bar, agent bar, loop console, graph)
```

## 9. Known limits of this MVP

- Graph queries use keyword and file overlap, not embeddings. Hub files (touched by more than 15% of changes, e.g. README) are ignored as evidence.
- `intent.check` can still produce false alarms. An agent can clear one by citing the node id and recording a Decision.
- Codex runs and resumes depend on `codex exec --json`; `codex exec resume` with these flags is less tested than Claude.
- The L3 inbox polls instead of using webhooks (desktop apps can't receive webhooks; a Worker relay would fix that).
- Entire checkpoints are not yet imported into the graph, and Neatlogs trace IDs are not yet written back onto graph nodes.
- Resuming an attached session runs in that session's own directory, so graders see that checkout's uncommitted changes.

## Debug helpers

```sh
BENANA_SCREENSHOT=/tmp/benana.png BENANA_SCREENSHOT_DELAY=8000 npm start   # save a window screenshot
BENANA_AUTOOPEN=1 npm start                                                # reopen the last project on launch
```

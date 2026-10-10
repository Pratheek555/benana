# Run benana yourself

benana is a desktop harness for coding agents built around an **intent graph**. It reads a repo's history to learn why changes were made, which approaches failed, and where the project is heading. Agents check that graph before they write code. The harness also improves itself through four loops:

| Loop | What it does in this MVP |
|---|---|
| **L1 agent** | Runs `claude` or `codex` in its own git worktree, with the `benana-intent` MCP tools and the relevant intent loaded into the prompt |
| **L2 verify** | Checks changed files, diff scope, the configured test command, and `intent.check`. Failures wait for a recovery preview and explicit Apply and retry. A missing test command fails verification. |
| **L3 events** | Polls GitHub issues every 2 minutes. An issue labelled `benana:auto` starts a run automatically |
| **L4 improve** | An analyst reads past runs and proposes a harness instruction or grader change. You preview the change and approve or reject it. |

---

## 1. Prerequisites

| Need | Why | Check |
|---|---|---|
| Node 20+ (tested on 22) | Electron and Vite | `node -v` |
| git | Intent and harness stores, worktrees | `git --version` |
| `claude` CLI, logged in | Agent runs, deep extraction, the L4 analyst (uses your own login, no API key needed) | `claude --version` |
| `codex` CLI (optional) | Run Codex as the agent | `codex --version` |
| `gh` CLI logged in **or** `GITHUB_TOKEN` | GitHub API (unauthenticated is limited to 60 requests per hour) | `gh auth status` |
| `entire` CLI and optional graph plugin | Entire context, checkpoint history, and repository relationships | `entire version` and `entire graph version` |

## 2. Environment

benana reads `.env` at the repo root (copy `.env.example` to start).

| Variable | Required | Used for |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes, for Artifacts | Intent and harness repos, per-agent forks, scoped tokens. Set it in `.env`. |
| `CLOUDFLARE_ACCOUNT_ID` | no | Otherwise it is read from the token |
| `ARTIFACTS_NAMESPACE` | no | Default `benana-dev` |
| `GITHUB_TOKEN` | no | Falls back to `gh auth token` |
| `NEATLOGS_API_KEY` | no | SDK project key. Exports a trace for every agent run, extraction and analyst pass |
| `NEATLOGS_TOKEN` + `NEATLOGS_PROJECT_ID` | no | Service-account token so the L4 analyst can read traces back (the SDK key can't) |
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

## 4. Fix a repository bug

1. Open the repository and select its local checkout. Opening does not require intent extraction to finish.
2. Set the repository's test command in **Settings**. Use a command that reproduces or checks the reported bug.
3. Describe the bug in **New task** and choose Claude Code or Codex. You can also start work from the GitHub inbox.
4. Inspect the context supplied to the agent. Entire context and Benana intent records retain their source identities.
5. Watch the conversation and expand execution steps when you need their evidence.
6. If the attempt fails, read the failure kind, evidence, and proposed recovery changes. Click **Apply and retry** to authorize the shown recovery. The previous attempt remains available.
7. Review the changed files and diff after verification passes. The code remains in the agent worktree; this version does not apply the patch to your original checkout.

New tasks use a dedicated worktree under `~/.benana/worktrees/<id>` and branch `benana/<id>`. Attached-session resume retains the original session checkout; inspect that path before continuing an attached session.

Use **Improvements** to analyze past attempts. Review the proposed instruction or grader patch before approving it. Approval creates a new harness version; subsequent attempts use that version. **Insights** reports outcomes. A before-and-after difference is evidence to investigate, not proof that the instruction caused the improvement.

Detected local Claude Code and Codex sessions remain available. **Connections** shows the exact configuration changes before registering the `benana-intent` MCP server. Claude uses user scope. Codex writes a managed block to `~/.codex/config.toml`, with a backup. **Remove** removes the managed integration.

The **Benana intent graph** view retains GitHub history extraction, node details, source links, and graph snapshot scrubbing. It is separate from Entire's repository graph and checkpoint history.

## 5. Neatlogs and Entire

- **Neatlogs tracing** is built in (`electron/lib/tracing.cjs`, Neatlogs TypeScript SDK). With `NEATLOGS_API_KEY` set, each entry point exports one trace:
  - `agent-run`: WORKFLOW → one AGENT span per attempt (model and token counts from the agent CLI) → TOOL spans for each tool call → GUARDRAIL spans for each grader
  - `session-resume` and `agent-brief`: the same, for resumed or steered sessions
  - `intent-extraction`: GitHub ingest, with an LLM span for deep extraction
  - `harness-analyst`: the L4 pass, with an LLM span for the proposal

  Check the pipeline with `npm exec --offline --no -- neatlogs doctor --local --json` and `... doctor --probe --json` (with `.env` exported). Add `NEATLOGS_TOKEN` (service account) to let the L4 analyst read traces back.
- **Entire:** run `entire enable` in your checkout. Benana copies the untracked `.entire/.claude/.codex` hook config into each run's worktree and commits passing runs on `benana/<id>`, so Entire attaches a checkpoint; the id is stored on the run and its AgentRun node. Entire context is also sent to the agent with the task. Install Entire's graph plugin for repository relationships; checkpoint history and session metadata still work without it on the list (see below).
- The sample-data browser demo at `http://127.0.0.1:5199/?demo=1` is isolated from live agents and partner services. Its evidence is labeled as demo data and does not satisfy the hackathon's partner usage requirement.

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
electron/lib/agents.cjs      attempt lifecycle, explicit retry, verification and checkpoint orchestration
electron/lib/improve.cjs     L4 analyst, harness proposals, approve / reject
electron/lib/sessions.cjs    detect / attach / connect local Claude Code and Codex sessions
electron/lib/artifacts.cjs   Cloudflare Artifacts adapter (namespace, repo, fork, token, push, pull)
electron/lib/neatlogs.cjs    Neatlogs public API (traces, search)
electron/lib/entire.cjs      Entire context, checkpoint/session history, repository graph adapter
src/hooks/                   workspace loading and event subscriptions
src/components/workspace/   sidebar, conversation, inspector, graph and secondary views
```

## 9. Known limits of this MVP

- Graph queries use keyword and file overlap, not embeddings. Hub files (touched by more than 15% of changes, e.g. README) are ignored as evidence.
- `intent.check` can still produce false alarms. An agent can clear one by citing the node id and recording a Decision.
- Codex runs and resumes depend on `codex exec --json`; `codex exec resume` with these flags is less tested than Claude.
- The L3 inbox polls instead of using webhooks (desktop apps can't receive webhooks; a Worker relay would fix that).
- Entire checkpoint history remains distinct from graph relationships. Neatlogs trace ingestion depends on external coding-agent instrumentation.
- Resuming an attached session runs in that session's own directory, so graders see that checkout's uncommitted changes.

## Debug helpers

```sh
BENANA_SCREENSHOT=/tmp/benana.png BENANA_SCREENSHOT_DELAY=8000 npm start   # save a window screenshot
BENANA_AUTOOPEN=1 npm start                                                # reopen the last project on launch
```

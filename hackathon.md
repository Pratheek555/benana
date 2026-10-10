# neatHack build log

## Project

- **Name:** benana
- **Purpose:** A desktop coding-agent harness that shows agents and people *why* a codebase is the way it is (past decisions, abandoned approaches, project direction) before they change it, and improves itself from its own runs.
- **Problem:** Coding agents repeat approaches that were already tried and rejected, and their reasoning disappears when a session ends. Commit messages keep the *what*; the *why* is scattered across PR threads, closed PRs and reverts. Benana turns that history into an intent graph that agents query before acting and write to while they work.

## Team

- **Team name:** benana
- **Members:** Kathrina, Pratheek, Umang

## Stack

- **App:** Electron 33 + Vite 5 + React 18; Cytoscape.js for the graph; Node main process (CommonJS).
- **Agents:** local `claude` CLI (Claude Code, stream-json) and `codex` CLI (`codex exec --json`), each in its own git worktree.
- **benana-intent MCP server** (stdio): `intent_context`, `intent_check`, `intent_record`.
- **Cloudflare Artifacts:** git-backed intent and harness repos (`benana-dev/intent-<repo>`, `harness-<repo>`), a fork per agent attempt, short-lived scoped tokens.
- **GitHub REST API:** history ingest and the issue inbox (auth via `gh` CLI token).
- **neatlogs:** TypeScript SDK (`neatlogs` on npm), manual WORKFLOW / AGENT / TOOL / GUARDRAIL / LLM spans.
- **Entire:** _planned, not yet installed._
- **cfo.ai:** _planned, not yet started._

### How the three partner tools are used

| Tool | Role in benana | Status |
|---|---|---|
| **neatlogs** | Every entry point exports one trace. `agent-run` is the WORKFLOW root, with an AGENT span per attempt (model and tokens from the CLI), TOOL spans per tool call, and GUARDRAIL spans per grader (`changes`, `diff scope`, `tests`, `intent.check`). Also `intent-extraction`, `harness-analyst`, `session-resume`, `agent-brief`. The L4 analyst is designed to read traces back as evidence for harness changes. | Tracing wired; SDK doctor `--local` and `--probe` pass. No application trace confirmed yet. Read-back needs a service-account token. |
| **Entire** | Planned: checkpoints link each agent commit to its session; `entire why` / checkpoints become a provenance input to the intent graph, giving agents repository context. | Pending: CLI not installed. |
| **cfo.ai** | Planned: pricing, costs (LLM tokens, Artifacts storage), revenue and runway plan for benana. | Pending. |

## Build log

### 2026-10-10

**Completed**
- Ideation: intent graph as a typed property graph (Decision, DeadEnd, Direction, Intent, AgentRun + Issue, PR, File, Person), stored as one file per node and edge in a git repo, so every commit is a graph snapshot. Four loops modelled on "loop engineering": agent → verify → events → hill-climb.
- Built the Electron MVP: status bar, agent bar, loop console (L3 inbox, L1 runs, L2 verify, L4 improve), graph panel with a snapshot scrubber; black and bumblebee-yellow theme.
- GitHub ingest on `expressjs/cors`: 81 issues and 179 PRs → 60 Decisions, 61 DeadEnds, 6 Directions. Bot PRs filtered out.
- Cloudflare Artifacts: namespace creation, repo push, read-back of a file over REST, fork and pull verified against a live account.
- MCP server verified over stdio: 3 tools listed; `intent_check` and `intent_record` return results.
- Session bridge: detects running Claude Code / Codex sessions from local transcripts; can register the MCP server (reviewable, removable); resumes sessions inside benana.
- Repo restructured: the app became the root project on branch `starter`; PRs opened on both remotes.
- neatlogs tracing added with the TypeScript SDK; `neatlogs doctor --local` and `--probe` both pass (synthetic Doctor trace exported and read back).

**Experiments, failures and fixes**
- **Failure → recovery (real `claude` run, issue #422 on `expressjs/cors`):** attempt 1 edited README; the `intent.check` grader failed it with keyword false positives (unrelated dead ends such as the Vary-header PR). Benana sent the failure back, and in attempt 2 the agent cited the node ids, recorded a Decision explaining why they didn't apply, and stopped. The run was still marked failed because its own new Decision was flagged.
- **Fix:** `intent.check` now (a) ignores nodes written by the same attempt, (b) accepts conflicts the agent explicitly acknowledges by id, (c) ignores hub files touched by more than 15% of changes, (d) requires overlap in the node *title*, not the PR body, and (e) applies light stemming.
- **Before / after on the same task:**

  | | Before fix | After fix |
  |---|---|---|
  | Run outcome | failed after 2 attempts | passed on attempt 1 |
  | Conflicts flagged for the README task | 5 | 0 |
  | Plan that really repeats dead end `dead_428` ("set Vary: Origin on all responses") | not flagged | flagged |
  | Approximate cost | ~$0.21 | ~$0.20 |

  The second agent also reused the Decision the first agent had recorded for the same issue (cross-attempt memory).
- **L4:** the analyst proposed "Call `intent_check` before the first Edit/Write" from the failed run's grader data; approving it produced harness v2.
- **Other fixes:** Artifacts namespace API expects `namespace`, not `name`; pushes now merge unrelated histories when another device or agent pushed first; null issue bodies crashed extraction; the dev server is pinned to 127.0.0.1 (IPv4/IPv6 `localhost` mismatch); the graph column overflowed its layout.
- These runs happened **before** neatlogs tracing was added, so the evidence for them is run records and transcripts, not neatlogs traces.

**Tests that actually ran**
- `node --check` on all main-process files; `npx vite build`.
- Headless ingest, Artifacts push / read / fork / pull, MCP stdio calls, L4 propose + approve.
- Two real `claude` agent runs (described above).
- `neatlogs doctor --local --json` and `--probe --json`: all checks pass.

**Not yet run**
- Codex agent runs end to end.
- An instrumented benana run showing up in neatlogs (needs a run after this change).
- Trace read-back via the public API (needs a service-account token: _waiting on a human_).

## Demo

- _Pending: demo video and URL._
- Reproduce locally: see `execute_yourself.md` (`npm install && npm run dev`, open a repo, start an inbox issue).

## Known limitations and next steps

- Matching uses keyword and file overlap, not embeddings; `intent.check` can still raise false alarms.
- The L3 inbox polls GitHub instead of using webhooks.
- Entire checkpoints are not yet read into the graph; neatlogs trace IDs are not yet written onto AgentRun nodes.
- Next: install Entire and run `entire enable` on a demo repo; record before/after runs **with** neatlogs traces; build the cfo.ai plan.

## Submission

**Confirmed requirements** (from neatlogs.com/hackathon, checked 2026-10-10)
- Submission window: Oct 12, 7:00 PM to 11:55 PM IST (final cutoff announced on Discord). Submit by quoting the official neatlogs post with team name, project name, public repo and demo video.
- Must use neatlogs (trace runs, find failures, verify fixes), Entire (checkpoints or entire-graph for repository context) and cfo.ai (business plan in the submission).
- Evidence: before/after agent runs with numbers; neatlogs traces or screenshots; Entire checkpoints or entire-graph output; cfo.ai business plan; a run with a visible failure and recovery; public #neatHack posts; a public repo with commits dated during the hackathon.

**Outstanding**
- [ ] Repository is **private** on both remotes (`0xzcr/benana`, `Pratheek555/benana`). It needs to be public to submit.
- [ ] neatlogs: capture real benana traces of the failure → recovery and the before/after runs.
- [ ] Entire: install, enable, and capture checkpoints or entire-graph output.
- [ ] cfo.ai: business plan (pricing, costs, revenue, runway).
- [ ] Demo video.
- [ ] #neatHack building-in-public posts.
- [x] Team name (benana) and members (Kathrina, Pratheek, Umang).

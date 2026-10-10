# Benana

A desktop workspace for launching and supervising Claude Code and Codex on repository bugs. The application owns the interface, verification, attempt history, and recovery. The coding agents own their model and tool execution loops.

The light workspace keeps the conversation central. An inspector shows agent context, changed files, verification, and execution evidence. Repository graphs and checkpoint history have separate views.

- Entire supplies code relationships and past-work context when its CLI and graph plugin are available. The interface identifies the context supplied to the agent and why it was included.
- Neatlogs supplies traces linked to the agent session. Local execution evidence remains separately labeled. Trace ingestion requires the coding-agent hooks or plugin.
- Failed attempts wait for a reviewed recovery and an explicit **Apply and retry** action. Retrying creates a linked attempt and preserves the failed attempt.
- Verification checks changes, scope, tests, and repository intent. A missing test command cannot produce a verified result.
- The GitHub inbox, detected local sessions, Benana intent graph, approved harness improvements, and optional Cloudflare Artifacts storage remain available.

## Run locally

```sh
npm ci
npm run dev
```

Copy `.env.example` to `.env` for partner credentials. Open a repository and configure its test command before expecting a verified bug fix.

The renderer also has an explicitly labeled sample-data demo at `http://127.0.0.1:5199/?demo=1`. The demo exercises recovery and retained attempts. It does not launch agents or establish live partner usage.

```sh
npm run build
npm test
npm run smoke:desktop
```

See [the setup guide](execute_yourself.md), [the workspace design](docs/workspace-design.md), and [the partner integration notes](docs/integrations.md). Older design documents are in [docs/legacy](docs/legacy/).

The desktop smoke check uses an isolated data directory, verifies the real Electron bridge, drives the labeled sample workflow, and saves screenshots under `.audit/screenshots`. It does not launch coding agents or call partner services.

New tasks and retries keep changes in an isolated agent worktree for review. Resuming an attached session continues in that session's existing checkout and can edit it directly; the interface shows this before resuming. Applying an isolated task's code patch to the original checkout is outside this version's scope. The hackathon submission still needs live partner evidence, a before-and-after improvement comparison, and the cfo.ai business plan.

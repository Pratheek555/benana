# Benana MVP plan

Status: architecture and implementation plan. No application code exists yet.

The user-selected execution model is local Codex with session upload. Cloudflare hosts the web application, API, Git repositories, metadata, and evidence. The user's machine runs the agent.

## Product boundary

The MVP proves that another contributor can continue an engineering attempt with its saved code, decisions, failed approaches, and human corrections intact.

GitHub owns issues, source branches, pull requests, and merges. Benana owns attempt history, captured events, checkpoint context, and independent workspaces. One attempt can include both humans and agents.

Start with conventional Git projects without Git LFS or submodules. Participants must have write access to a repository selected in the GitHub App installation. Support the local companion on Windows and macOS. Linux follows after validating the same workflow there.

The complete workflow is:

1. Sign in, install the GitHub App, and choose a repository.
2. Select an existing issue or create an issue in GitHub through Benana.
3. Create an attempt and prepare its workspace with the local companion.
4. Run Codex locally or make manual changes, then publish a checkpoint.
5. Review the diff, context, evidence, and contributors in the web application.
6. Fork a published checkpoint and restore it on another machine.
7. Continue with local Codex using the inherited context.
8. Explicitly export a selected checkpoint as a GitHub branch and draft pull request.

## Chosen technology stack

These are MVP decisions, not installed dependencies. Pin compatible stable versions and the tested Codex version during foundation work.

| Area | Choice | Reason |
| --- | --- | --- |
| Workspace | TypeScript and pnpm workspaces | Share contracts across the browser, Worker, and CLI. |
| Web | React, Vite, React Router, TanStack Query | Client rendering, routes, and cached API data. |
| UI | Tailwind CSS and shadcn/ui | Consistent accessible controls and dialogs. |
| API | Hono on Cloudflare Workers | One API deployment using web-standard requests. |
| Validation | Zod in `packages/contracts` | Validate API inputs and versioned handoffs. |
| Metadata | Cloudflare D1, prepared SQL, SQL migrations | Relational queries and publication records. No ORM initially. |
| Git storage | Cloudflare Artifacts | Writable attempts and frozen checkpoints with normal Git transport. |
| Evidence | Private Cloudflare R2 bucket | Event chunks, context manifests, diffs, and check output outside Git. |
| Local companion | Node.js CLI, Commander, native Git subprocesses | Local workspaces, Codex invocation, journaling, and uploads. |
| Agent | `codex exec --json` | Capture bounded runs through a documented event stream. |
| GitHub | GitHub App and REST API through Octokit | Selected repositories, user authorization, issues, and draft PRs. |
| Delivery | Wrangler, Workers static assets, GitHub Actions | Package web assets and API into one deployment. |
| Verification | Vitest and Playwright | Contract and lifecycle tests plus the browser workflow. |

Deploy one Worker serving the web bundle and `/api/*`. Build `apps/web` first and package its output with `apps/worker`. During development, proxy Vite API calls to local Wrangler. Separate staging and production D1 databases, R2 buckets, Artifacts namespaces, and GitHub Apps.

Cloudflare documents a [React SPA with a Worker API](https://developers.cloudflare.com/workers/vite-plugin/tutorial/) and [Hono on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/). The source directories do not imply separate public deployments.

Containers, Sandboxes, Durable Objects, Queues, Workflows, KV, vector search, and hosted model APIs are deferred. Local execution and idempotent API uploads cover the initial workflow.

## Component ownership

| Component | Owns |
| --- | --- |
| `apps/web` | Issue board, attempt lineage, timeline, context review, fork, and export actions. |
| `apps/worker` | Authorization, GitHub synchronization, Artifacts lifecycle, uploads, and publication. |
| `apps/cli` | Dedicated checkout, native Git, Codex invocation, journal, redaction, and retries. |
| `packages/contracts` | API payloads, normalized events, handoff schema, and lifecycle definitions. |
| D1 | Access records, relational metadata, operation state, and immutable object references. |
| R2 | Captured evidence and versioned context addressed by immutable keys and hashes. |
| Artifacts | Git objects, trees, refs, and isolated repositories. |

The browser and CLI call the Worker API. The CLI transfers Git objects directly to Artifacts with a short-lived repository token. The Worker validates and publishes the result.

The Worker never launches processes on a user's device. OpenAI authentication and inference remain between local Codex and OpenAI. Cloudflare account credentials stay server-side.

## How Cloudflare Artifacts is used

### Repository layout

Use one namespace per deployment environment, such as `benana-staging`. Namespaces separate environments, not users. D1 ownership checks enforce access.

- Each attempt has one writable repository named `attempt-<id>`.
- Each code snapshot has a read-only repository named `checkpoint-<id>`.
- Save the returned repository name and remote URL. Do not reconstruct the URL from user input.
- Preserve a working branch and dedicated checkpoint refs.
- Store logs and context in R2 rather than Git.

The extra checkpoint repository freezes code independently of the writable attempt. Later pushes or ref deletion in the attempt cannot change a saved snapshot. Never issue a write token for a published snapshot.

The [Workers binding](https://developers.cloudflare.com/artifacts/api/workers-binding/) supports creation, inspection, tokens, and forks with read-only options. The [Git protocol](https://developers.cloudflare.com/artifacts/api/git-protocol/) supports standard local commands with repository-scoped read or write tokens.

### Start a root attempt

1. Record the authorized GitHub repository, issue, base branch, and exact base commit.
2. Create an empty writable Artifacts repository with a deterministic attempt name.
3. Clone the selected GitHub history locally using the user's existing Git credentials.
4. Verify the base commit and prepare a dedicated Benana checkout.
5. Add the Artifacts remote and push the working branch and its history.
6. Verify the base commit exists before marking the workspace ready.

Use this local seed path for public and private repositories. Native Artifacts imports are documented for public HTTPS repositories. Do not assume native private import support. A public import optimization is deferred. See [repository imports](https://developers.cloudflare.com/artifacts/guides/import-repositories/).

### Save a checkpoint

Git, R2, and D1 do not share a transaction. Publication is a recoverable operation with a stable checkpoint ID.

1. Stop the Codex run, acquire the workspace lock, and preview the selected files and upload contents.
2. Capture tracked changes and explicitly selected untracked files in an internal commit.
3. Before any remote upload, create the pending operation with its checkpoint ID, request hash, expected SHA, event watermark, writer generation, and deterministic resource names.
4. Push that commit and a checkpoint ref to the writable attempt. Record the completed step in the operation.
5. Upload events, reviewed context, diff, and evidence. Record object hashes and completed steps. Standalone event uploads also reserve batch metadata before writing R2 objects.
6. Verify the checkpoint ref resolves to the expected SHA. Fork with `readOnly: true` and `defaultBranchOnly: false` into the snapshot repository.
7. Wait for readiness. Verify that ref and SHA again in the snapshot, plus all R2 references and the contiguous event range.
8. Publish the checkpoint record and immutable references in one D1 batch, conditional on the current writer generation.

Only published checkpoints appear as fork targets. A crash leaves an operation pending or failed. Retry with the same ID and reuse verified resources. A handoff edit after publication creates a new checkpoint revision referencing the same frozen code repository.

### Fork a checkpoint

1. Authorize the user and resolve a published checkpoint.
2. Create a child attempt linked by `parentCheckpointId`.
3. Fork the frozen checkpoint repository with `readOnly: false` and `defaultBranchOnly: false` into a new writable attempt repository.
4. Verify the saved commit exists before marking the fork ready.
5. Issue fresh credentials. The CLI clones the child and checks out that SHA on a new working branch.
6. Verify the handoff hash and save context outside the Git worktree.
7. Let the user review the inherited brief before starting a fresh Codex run.

The fork API selects a repository, not a commit. Checking out the checkpoint SHA is an explicit CLI step. Do not assume the copied default branch points at the selected checkpoint.

The snapshot includes source history present when it was frozen. Forking does not promise selective disclosure of only one commit. Access requires permission to read the whole source attempt.

### Credentials, limits, and retention

Issue five-minute repository tokens after Worker authorization. Keep them in the CLI supervisor, outside Codex's environment and checkout. Use transient Git authorization, not credentials embedded in remote URLs or logs.

Tokens are repository-scoped, not branch-scoped. Separate attempt repositories and read-only snapshots provide the required isolation. Revocation blocks new credentials; previously minted tokens expire within their short lifetime.

As checked on October 6, 2026, Artifacts requires Workers Paid. Documented limits include 1 GB per repository and 32 MB per blob. Preflight transfer sizes, reject unsupported LFS and submodules, and surface provider errors before publication. See [pricing](https://developers.cloudflare.com/artifacts/platform/pricing/) and [limits](https://developers.cloudflare.com/artifacts/platform/limits/).

Retain published checkpoints and evidence until explicit project deletion. Daily scheduled cleanup removes only abandoned unpublished resources older than 24 hours, identified by operation records. Cleanup never deletes published snapshots.

## Local Codex capture

### Supported session boundary

Launch a bounded run with `codex exec --json` in the attempt checkout. Record the submitted prompt, emitted events, stderr, exit status, Codex version, model when available, and local verification output. Mirror progress in the terminal.

Before launch, verify the inherited handoff hash and render a versioned prompt containing the issue, goal, constraints, decisions, failed approaches, human corrections, and next task. Show that prompt in the run preview and send it through Codex's documented stdin prompt interface. Record its hash and template version with the run. Never silently truncate context; ask the user to select evidence when the prompt exceeds the chosen budget.

Spawn Codex with an environment allowlist for runtime paths, required OS variables, and explicitly approved project variables. Resolve Codex authentication locally without copying it. Exclude Benana device tokens, transient Artifacts tokens, and Git transport credentials from the subprocess environment. This prevents accidental credential propagation; a local process running as the same OS user is not an isolation boundary.

Each invocation is a run within an attempt. Further work starts another run with saved code and reviewed context. Native thread IDs are provenance only. A fork starts a fresh Codex session without the old machine's session files.

Capture runs launched through Benana. Arbitrary TUI, IDE, and T3 session imports are deferred. Hidden reasoning and unavailable provider state are not captured. Record reasons through explicit agent decision notes and human annotations.

[Official OpenAI guidance](https://developers.openai.com/blog/codex-as-a-platform) distinguishes bounded `codex exec` tasks from app-server integrations for persistent interactive conversations. Use the bounded path first. App-server is a later adapter.

### Planned CLI commands

These names describe the planned interface, not available commands.

| Command | Result |
| --- | --- |
| `benana login` | Pair the device with a signed-in browser account. |
| `benana checkout <attempt>` | Prepare the dedicated checkout. |
| `benana run <attempt>` | Submit a prompt to local Codex and journal the run. |
| `benana annotate <attempt>` | Record a decision or reason for a manual change. |
| `benana check <attempt>` | Execute a user-approved check and record the code state tested. |
| `benana checkpoint <attempt>` | Preview, review, and publish code with its handoff. |
| `benana sync <attempt>` | Replay unacknowledged uploads. |
| `benana fork <checkpoint>` | Create and check out an independent child. |
| `benana export <checkpoint>` | Push a reviewed change and request a draft PR. |

The browser can request a fork and display a copyable checkout command. It cannot remotely start local commands. Dependency installation, Codex execution, checks, and export are explicit local actions.

Use a dedicated checkout rather than changing the user's existing branch or index. Store journals and context in the user's Benana application-data directory. Hold a local workspace lock and a server writer lease. Another machine must fork or explicitly claim an idle attempt before writing.

## Portable handoff version 1

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Initially `1`. Reject unsupported versions. |
| `issueSnapshot` | Title, body, acceptance criteria, and source revision at capture time. |
| `code` | GitHub repository ID, base SHA, checkpoint SHA, snapshot repository, and ref. |
| `provenance` | Attempt, checkpoint, contributors, Codex version, and event watermark. |
| `goal` and `constraints` | Desired behavior and agreed limits. |
| `decisions` | Choice, reason, alternatives, source IDs, and recorded or inferred rationale. |
| `failedApproaches` | What was tried, outcome, and supporting evidence. |
| `humanChanges` | Commit or diff references and contributor explanations. |
| `verification` | Command, exit status, output reference, and exact SHA or tree hash tested. |
| `openQuestions` and `nextAction` | Remaining uncertainty and a concrete continuation task. |
| `environment` | OS, tool versions, setup recipe, and required secret names without values. |

Local Codex can draft the handoff. A user reviews it before publication. No cloud summarizer or additional model key is required. Preserve source-linked facts separately from generated inference. Missing rationale remains missing.

Checks against another tree are stale. A successful agent exit does not mean tests passed or the issue is solved. Unrun checks appear as not run.

A fork restores the selected Git state and reviewed context. It does not restore dependency caches, databases, live processes, secrets, or exact model behavior. The new machine follows the setup recipe explicitly.

## Metadata and lifecycle

D1 is authoritative for product records. Published R2 references and hashes are immutable. Git commit IDs identify code.

| Record | Relationships and constraints |
| --- | --- |
| User and device | GitHub user ID, hashed session or device token, expiry, and revocation. |
| Repository | GitHub repository ID, installation, authorized project, and sync revision. |
| Issue | Repository and GitHub issue number, unique together. |
| Attempt | Issue, creator, parent checkpoint, Artifacts repo, and writer generation. |
| Run | Attempt, local run ID, contributor, outcome, and last heartbeat. |
| Event batch | Run, sequence range, R2 key, hash, and unique client batch ID. |
| Checkpoint | Attempt, snapshot repo, SHA, handoff hash, watermark, and publication state. |
| Operation | Actor, idempotency key, request hash, step progress, and resource IDs. |
| Export | Checkpoint, GitHub branch, exported SHA, and draft PR URL. |

Allocate UUIDs before side effects. Use SQL uniqueness constraints and conditional updates. D1 batches group publication writes after verifying external resources. See the [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Run outcomes are `running`, `completed`, `failed`, `cancelled`, or `interrupted`. Connection freshness is separate. A missed heartbeat displays disconnected and the last upload time; it does not assert the local process stopped.

Checkpoint states are `pending`, `published`, or `failed`. Operation states are `pending`, `ready`, or `failed`, with a named step and retryable error. Derive attempt status from runs, checkpoints, and exports rather than agent claims.

Journal events locally before upload. Give each run monotonically increasing sequence numbers. Retry batches with the same ID and hash. Acknowledge only durably stored data and reject conflicting duplicates. Checkpoint publication requires contiguous events through its watermark.

Writer leases have generation numbers and a bound device. A stale client cannot finalize after another client claims the attempt. Track every issued write token's expiry. A takeover blocks new tokens for the old generation and waits for all old write tokens to expire before granting the new writer. Changing D1 state alone does not fence Git pushes. Forking is the immediate alternative to waiting.

Lease claims and finalization use conditional SQL updates, not a separate unchecked read followed by a write. Preserve stale clients' local work so they can start child attempts. Never automatically rerun Codex after a crash.

## Authentication and GitHub flow

Use GitHub App user authorization with OAuth state and PKCE. Issue a random server session using a Secure, HttpOnly, SameSite cookie. Validate request origin for browser mutations. Encrypt user and refresh tokens in D1 using a Worker secret.

CLI login uses browser pairing. The CLI obtains a 256-bit device secret and a separate human-readable code. Store hashes in D1 with a ten-minute expiry and five-second minimum polling interval. Rate-limit code entry and polling. Browser confirmation binds the request to the signed-in user and displays the device name.

Only possession of the device secret permits polling and token redemption. Atomically exchange the approved request once for a device-bound, revocable 30-day Benana token. Rotate through another one-time pairing when it expires. Store the token in the OS credential store and its hash in D1. The CLI never receives a Cloudflare account token or GitHub App private key.

Authorize only when the current user and App can access the selected repository and the user has write permission. Apply the check to metadata, evidence, Git credentials, forks, and exports. An attempt ID alone never grants access. See [GitHub App user access](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

Request metadata read, issues write, contents write, pull requests write, checks read, and commit statuses read. Defer Actions and workflow write permissions. Reject exports modifying `.github/workflows`.

Fetch issues on connection and explicit refresh. Paginate results and show the last successful sync. Create new issues in GitHub before caching them. Signed installation, repository-removal, and user-revocation webhooks invalidate access. Recheck permissions before minting credentials or exporting.

For export, use local GitHub credentials to push a fresh review commit containing the checkpoint change relative to its original base. The deterministic branch is `benana/<attempt-id>/<checkpoint-id>`. The Worker verifies its tree and creates a draft PR using the user's GitHub App authorization.

Never overwrite a conflicting branch, force-push, or auto-merge. Recover failed PR creation by locating the deterministic branch and existing PR. If the target branch moved, show that fact and require a new checkpoint when reconciliation is needed.

Link the issue, attempt, checkpoint, decisions, and verification in the PR description. Private evidence requires Benana authorization. GitHub remains authoritative for review, CI, and merge state.

## API and interface

Use JSON REST under `/api/v1`. Errors include a stable code, message, retryability, and operation ID when applicable.

The API covers authentication, device pairing, repository connection, issue synchronization, attempts, writer claims, runs, heartbeats, bounded uploads, checkpoint publication, forks, Artifacts credentials, and PR export.

Serve evidence through authorized Worker routes with private cache headers. There are no public R2 URLs. Render terminal output, Markdown, diffs, and uploaded text as untrusted content.

Poll active attempts and operations every five seconds while visible. Stop on terminal results and pause when the tab is hidden. WebSockets and remote terminal control are deferred.

Required screens are:

- Repository connection and a board with derived Open, Active, Review, and Done columns.
- Issue detail with acceptance criteria, attempt lineage, contributors, and checkpoints.
- Attempt detail with timeline, diff, handoff, checks, failures, and upload freshness.
- Fork dialog naming the exact checkpoint and collecting a new task without rewriting parent context.
- Export dialog and resulting draft PR link.

Include loading, empty, offline, revoked-access, failed-operation, and stale-check states. Board dragging, chat, and a browser editor are deferred.

## Privacy and operating limits

Require an upload preview and explicit consent. Exclude credentials, environment files, ignored files, and generated dependencies. Keep the original journal locally; upload a redacted copy with markers. Never upload global Codex configuration, authentication files, or unrelated sessions.

Git transfers include reachable source history. Disclose that scope; excluding new files does not remove secrets in old commits. Block detected secrets and allow aborting before transfer. Do not claim perfect detection.

Start with Benana limits of 100 attempts per repository, 20 checkpoints per attempt, 1 MiB per event batch, and 10 MiB per evidence attachment. These are product defaults, not Cloudflare limits. Show storage usage and implement explicit project deletion before the pilot.

Local Codex uses the user's existing authentication, model choice, and permissions. Benana does not enable unrestricted execution. Inherited context is evidence, not permission to expand access.

## Build order and completion gates

Each phase ends with a working vertical slice. Complete dependencies before starting the next phase.

| Phase | Deliverable | Pass condition |
| --- | --- | --- |
| 0. Integration proof | Artifacts, Git, and Codex capture spike | Seed, freeze, fork, and restore an exact commit and checkpoint ref on real Artifacts with the specified fork options. A frozen repo rejects writes. Capture Codex JSON and stdin context on Windows and macOS. Record tested versions. |
| 1. Foundation | Workspace, contracts, API, web shell, CLI skeleton, migrations, and CI | Typecheck, lint, and meaningful tests pass. Staging uses isolated resources. |
| 2. Identity and issues | Login, pairing, GitHub connection, board, and issue creation | Two test users access only permitted repositories. Revocation blocks new operations. |
| 3. Local capture | Checkout, Codex runs, notes, checks, journals, and upload | Network loss preserves work. Replay does not duplicate events. Timeline attribution is accurate. |
| 4. Checkpoints and forks | Frozen code, reviewed context, publication, and child checkout | A second machine restores the exact tree and context. Failed publication is invisible and retryable. |
| 5. Review and export | Diff, evidence, context inspection, and draft PR | Exported tree matches the checkpoint. Retry creates no duplicate PR. Default branch is untouched. |
| 6. Pilot | Recovery tests, project deletion, usage, and onboarding | Acceptance scenarios pass on real services and two contributors complete the handoff exercise. |

Phase 0 settles read-only forks, token expiry, repository limits, and supported event shapes before UI investment. If an assumption fails, revise this document before dependent work.

## Definition of done

The MVP is complete when all these scenarios pass:

1. A maintainer runs local Codex, records a failed approach, makes a manual correction, and publishes a checkpoint.
2. Another authorized contributor on another machine forks it. Tree, context hash, lineage, and event watermark match.
3. The next run receives goals, constraints, failed approaches, human corrections, and the next action without old session files.
4. A new checkpoint exports to one draft PR without changing the default branch or parent attempt.
5. Disconnecting during upload, push, snapshot fork, or PR creation leaves recoverable state. Retry does not duplicate resources.
6. Missing rationale, stale checks, revoked access, unsupported projects, and unavailable local execution are represented honestly.
7. Changes or force-pushes to the writable parent cannot alter a published checkpoint or a child's inherited context.
8. Two contributors report whether handoff reduced explanation and repeated failed work. A technical demo alone does not prove demand.

Test cross-project authorization, deduplication, stale writer fencing, unpublished checkpoint visibility, and exact restoration. Use Playwright for the browser flow and real staging Artifacts for Git integration. Mocked Git alone is insufficient.

## Deferred scope

- Hosted agents, cloud sandboxes, and remote control of local execution.
- Other agent providers, arbitrary session imports, and interactive app-server sessions.
- Parallel agent competitions, automatic rankings, and automatic merges.
- Learned repository memory, embeddings, and cross-project search.
- Git LFS, submodules, large repositories, and workflow-file exports.
- Custom organization roles, public session sharing, billing, and marketplaces.

The stack and responsibilities are decided here. Provisioning, App registrations, secret values, exact package versions, and pilot repositories are implementation inputs rather than unresolved architecture choices.

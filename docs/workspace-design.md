# Developer workspace

The workspace keeps the bug brief and agent conversation in the center. A repository sidebar provides task navigation. A contextual inspector shows what the agent received, the changes it produced, and the checks that ran.

## Visual direction

The supplied Gumloop references inform the light background, quiet sidebar, fine borders, readable lists, and expandable detail panels. A repository graph is available in its own exploration view. The primary task view reserves space for the conversation and failure recovery.

Two layouts were compared before implementation. A conversation-centered workspace supports describing and supervising a bug fix. A run-centered workspace makes execution evidence prominent but relegates conversation to a drawer. The conversation-centered design was selected. It incorporates the second design's attempt timeline and focused failure evidence.

The design comparison used the reachable configured `gpt-5.6-sol` model. An independent judge recommended the conversation-centered design. Model diversity was reduced because the other configured design models were not available through the native delegation tool, and T3 reported its Codex delegated provider unavailable during discovery.

## Data ownership

The Electron main process owns agent processes, attempt records, verification, partner adapters, and recovery authorization. Renderer components request actions through IPC and consume snapshots. A status label in the renderer cannot authorize a retry or establish that verification passed.

Each terminal attempt is retained with its transcript, verification results, context, and worktree. A retry creates a new record linked to the failed attempt. Recovery must have a concrete preview and an explicit **Apply and retry** action. A general follow-up message must not bypass this gate.

An execution failure means the application could not complete the agent or tool operation. A verification failure means checks did not accept the proposed repository change. The explanation and proposed recovery must address the corresponding failure. A successful process exit alone is insufficient for success. Missing test configuration is an unmet check.

## Partner boundaries

Three capabilities have separate identities.

- Entire's repository graph describes code relationships. Graph search supplies ranked code context. The graph view reads Entire's graph export when the plugin is available.
- Entire's checkpoints and sessions preserve the context behind changes. History does not become a repository relationship graph.
- Benana's existing intent graph contains repository decisions, directions, and failed approaches. Its label and history remain distinct from Entire.

The context inspector identifies the source of each supplied item and explains why the application included it. Unavailable capabilities have an explicit state. The application does not substitute an unrelated graph or invented checkpoint data.

Neatlogs evidence belongs to the selected attempt only when it can be correlated to that attempt's known session. Local process output and grader results remain labeled as local evidence. Reading Neatlogs does not establish trace ingestion; the coding-agent instrumentation must also be configured.

Recovery previews describe exactly what the application will apply. Additional agent instructions are labeled as instructions. They are not presented as repository patches or as a Neatlogs-authored diagnosis.

## Implementation checkpoint

The IPC contract is defined before parallel implementation. Renderer work and main-process work use separate worktrees. The main process is the only writer of execution state. Integration proceeds sequentially after both owners finish.

The verification checklist includes the real renderer, recovery transitions, retained attempt selection, graph and checkpoint separation, and desktop window rendering. Runtime checks cover failed launches, failed process exits, missing tests, explicit retries, and retained worktree changes. Demo data is activated explicitly and labeled throughout; it does not count as live partner usage. Executed checks are recorded in the local audit trail.

## Scope

This change keeps the existing Electron framework. Agent SDK or app-server migration remains a separate implementation decision. New tasks and retries use isolated worktrees. Reviewing one does not apply its diff to the user's original checkout. Attached-session resume continues in its existing checkout and can change files there. The conversation explains this before the resume instruction is sent, and the inspector identifies the original checkout.

cfo.ai remains the business-plan partner for pricing, costs, revenue, and runway. A mock cost display cannot replace verifiable cfo.ai usage for the hackathon submission.

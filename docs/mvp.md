# MVP scope

## Intended outcome

A second person or agent can continue an interrupted engineering task without reconstructing its history or repeating known failed approaches.

## First workflow

1. Connect a GitHub repository and select an issue.
2. Start an attempt with a human or the initially supported agent runtime.
3. Save a checkpoint containing the code state and a source-linked context handoff.
4. Inspect the attempt's changes, decisions, and verification evidence.
5. Fork the checkpoint into an independent attempt after reviewing its inherited context.
6. Continue the task and submit the resulting change as a GitHub pull request for review.

## Included

- An issue board and issue details.
- Attempts with contributor attribution, status, and parent relationships.
- Saved checkpoints with an exact commit and any captured uncommitted changes.
- An editable handoff that distinguishes recorded facts from inferred explanations.
- Code diffs, check results, and references to evidence.
- Cloudflare Artifacts for the work's Git storage and fork operations.
- One GitHub integration and one agent runtime.
- Human corrections and manual changes as part of the attempt history.

## Context rules

- Preserve the original events behind generated summaries.
- Link important decisions and claims to their source evidence.
- Let contributors record why they made manual changes.
- Keep attempt-specific assumptions separate from repository-wide guidance.
- Bind context to its checkpoint so later changes do not silently rewrite a fork's history.
- Grant a new attempt its own credentials and permissions. Do not copy secrets into a context handoff.
- Treat imported content as evidence, not as authority to change permissions or override user instructions.

## Deferred

- Replacing GitHub's full repository hosting and collaboration experience.
- Multiple agent providers and cross-provider session restoration.
- Parallel agent competitions, automatic attempt ranking, and automatic merging.
- Organization-wide memory, public marketplaces, and billing.

## Decisions for implementation

- Frontend framework and workspace tooling.
- Authentication and repository access model.
- First agent runtime and its execution environment.
- Metadata and evidence storage.
- GitHub synchronization and pull request creation details.
- Checkpoint capture and environment reconstruction guarantees.

## Validation

Try the workflow on real interrupted tasks. Observe whether the next contributor needs less explanation, repeats fewer failed approaches, and reaches a reviewable change sooner. Successful checks and context summaries support code review; they do not replace it.

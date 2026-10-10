# Renderer UI design

The renderer uses a conversation-centered desktop layout. The left sidebar owns repository navigation and run selection. The center owns the selected conversation or a dedicated exploration route. The right inspector owns the exact context bundle, worktree diff, repository checks, and linked evidence.

Run attempts are immutable records. A failed attempt keeps its messages, failed step, evidence, and recovery preview. `Apply and retry` creates a new selected attempt through `run:retry`; the original stays selectable in the recent-run list. The UI reports success only when the attempt reaches `passed` after configured checks.

Repository relationships from Entire, Entire checkpoint history, and Benana intent are separate views. The graph route exposes an explicit source choice. Neatlogs evidence appears only when `neatlogs:evidence` reports an exact match. Missing configuration and an unmatched run use distinct empty states.

The browser demo activates only with `?demo=1` and always shows `Demo · sample data`. Its local bridge has deterministic sample APIs and an asynchronous failed-attempt retry. A browser without the Electron bridge shows a desktop-runtime explanation and an explicit demo link. Production never imports demo data as a fallback state.

Existing Electron capabilities remain reachable through the navigation and inspector: repository opening by GitHub name and local path, Claude or Codex launch, attached session selection and resume, agent connection configuration, inbox, improvement decisions, verification settings, run worktrees and token metadata, integration state, and both graph histories.

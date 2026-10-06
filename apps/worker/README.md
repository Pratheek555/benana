# Cloudflare backend

This directory will contain the Worker API and backend coordination.

Its intended responsibilities are:

- Authenticate users and authorize access to repositories and attempts.
- Connect GitHub repositories, issues, branches, and pull requests.
- Manage attempt lineage and saved checkpoints.
- Coordinate Cloudflare Artifacts repositories and forks.
- Capture events and build context handoffs with links to their sources.
- Accept local Codex event uploads and track capture freshness.

Codex runs on the user's machine through the local companion. The Worker coordinates metadata and storage. A fork starts a new attempt with saved code and context, rather than restoring a provider's internal session state.

The chosen stack is Hono, D1, R2, and Cloudflare Artifacts. One Worker also serves the web assets. Each attempt has a writable Artifacts repository; published code snapshots use separate read-only repositories. See [the MVP plan](../../docs/mvp.md) for the complete lifecycle. This directory contains no runtime code yet.

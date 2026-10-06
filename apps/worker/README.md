# Cloudflare backend

This directory will contain the Worker API and backend coordination.

Its intended responsibilities are:

- Authenticate users and authorize access to repositories and attempts.
- Connect GitHub repositories, issues, branches, and pull requests.
- Manage attempt lineage and saved checkpoints.
- Coordinate Cloudflare Artifacts repositories and forks.
- Capture events and build context handoffs with links to their sources.
- Start and track work through one agent runtime initially.

Keep the agent runtime integration replaceable. A fork starts a new attempt; it does not promise to restore another provider's internal session state.

Storage, execution services, bindings, and deployment configuration are undecided. This directory contains no runtime code yet.

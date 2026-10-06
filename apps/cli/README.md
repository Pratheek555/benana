# Local companion

This directory will contain the Node.js CLI for local Codex execution and session upload.

Its responsibilities are:

- Pair a device with the user's Benana account.
- Prepare dedicated Git checkouts for attempts and checkpoint forks.
- Launch bounded Codex runs with `codex exec --json` and capture their events.
- Record human annotations and user-approved check output.
- Journal locally, preview uploads, redact sensitive content, and retry synchronization.
- Publish checkpoints and explicitly export reviewed changes to GitHub.

Use TypeScript, Commander, and native Git subprocesses. Codex authentication stays local. Cloudflare account tokens and GitHub App credentials stay in the backend.

See [the MVP plan](../../docs/mvp.md) for the planned commands, context format, storage lifecycle, and completion gates. No CLI implementation exists yet.

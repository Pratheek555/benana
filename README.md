# Benana

A collaboration platform where people and agents can pick up engineering work with its code, decisions, and evidence intact.

The MVP centers on issues, attempts by humans or agents, and checkpoints that can be forked into new attempts. Cloudflare Artifacts is the intended Git storage foundation. Existing GitHub repositories remain the starting point for the MVP.

## Repository layout

```text
apps/
  web/                 Issue board, attempt history, and review interface.
  worker/              Cloudflare API, integrations, and storage coordination.
  cli/                 Local Codex capture, Git workspaces, and session upload.
packages/
  contracts/           Shared API and portable context definitions.
docs/
  mvp.md               Architecture, stack, workflow, and completion gates.
```

Each application and package currently contains only a README describing its responsibilities. There is no application code, dependency manifest, or runnable environment yet.

Read [the MVP plan](docs/mvp.md) before implementation. It specifies local Codex execution, the chosen stack, Cloudflare Artifacts usage, architecture boundaries, and completion gates. Exact dependency versions and account configuration are selected during implementation.

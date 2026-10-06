# Benana

A collaboration platform where people and agents can pick up engineering work with its code, decisions, and evidence intact.

The MVP centers on issues, attempts by humans or agents, and checkpoints that can be forked into new attempts. Cloudflare Artifacts is the intended Git storage foundation. Existing GitHub repositories remain the starting point for the MVP.

## Repository layout

```text
apps/
  web/                 Issue board, attempt history, and review interface.
  worker/              Cloudflare API, integrations, and task coordination.
packages/
  contracts/           Shared API and portable context definitions.
docs/
  mvp.md               Product scope and first end-to-end workflow.
```

Each application and package currently contains only a README describing its responsibilities. There is no application code, dependency manifest, or runnable environment yet.

Read [the MVP scope](docs/mvp.md) before implementation. Frameworks, package tooling, agent runtime, authentication, and deployment configuration will be selected when implementation starts.

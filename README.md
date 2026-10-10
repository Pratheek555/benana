# benana

A desktop, self-improving coding-agent harness built around an **intent graph**: what you want the code to do is captured as a graph of intents, and agents work against it.

- **Four loops**
  - **L1 agent** — runs `claude` or `codex` in a git worktree with the `benana-intent` MCP server attached.
  - **L2 graders** — check that the run made changes, kept the diff in scope, passed tests, and passed `intent.check`; failures trigger a retry.
  - **L3 inbox** — polls GitHub issues every 2 minutes; issues labelled `benana:auto` start a run automatically.
  - **L4 analyst** — reviews traces and proposes harness changes, which need your approval.
- **Artifacts** (Cloudflare) — git-backed storage for the intent and harness repos plus per-agent forks.
- **Neatlogs** — trace collection the L4 analyst reads from.
- **Entire** — code-to-session provenance.

## Quick start

```sh
cp .env.example .env   # fill in what you need
npm install && npm run dev
```

Full setup, prerequisites, and usage: [execute_yourself.md](execute_yourself.md). Older design docs live in [docs/legacy/](docs/legacy/).

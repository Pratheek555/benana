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

The web application signs users in through the GitHub App, saves a repository selection, and reads live GitHub issues. Shared Zod contracts validate the browser and Worker boundary. The fixture issue board, attempt evidence, checkpoint review, and fork workflow remain available under `/demo`.

Read [the MVP plan](docs/mvp.md) before implementation. It specifies local Codex execution, the chosen stack, Cloudflare Artifacts usage, architecture boundaries, and completion gates.

## Run the local application

Install Node.js 20.19+ or 22.12+ and pnpm 10. Then run:

```sh
pnpm install
pnpm dev
```

Open the web URL printed by Vite. The root development command starts the web application and the Worker API together. The web server proxies `/api` requests to the Worker on port 8787. Run `pnpm check` to typecheck, lint, test, and build both applications.

Apply the local D1 migrations and configure the GitHub App before using the live root route. See [GitHub App setup](docs/github-app-setup.md). The `/demo` routes keep new issues and forked attempts in memory and reset them on reload. The browser does not run Codex or checkout commands.

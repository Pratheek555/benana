# Worker API

This directory contains the Hono API that runs on Cloudflare Workers. It owns GitHub App OAuth, D1 sessions and repository selections, encrypted GitHub credentials, and normalized issue reads. The unsafe Artifacts repository creation experiment was removed.

From the repository root, install dependencies and start the web application and Worker together:

```sh
pnpm install
pnpm dev
```

The Worker listens on `http://127.0.0.1:8787`. Keep local Cloudflare credentials in `apps/worker/.dev.vars`; Git ignores that file. Regenerate Worker binding types after changing `wrangler.jsonc`:

```sh
pnpm --filter @benana/worker cf-typegen
```

See [GitHub App setup](../../docs/github-app-setup.md) for the exact callback URL, required permissions, environment variables, and local D1 migration command.

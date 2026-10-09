# Web application

This directory contains the React user interface.

The live root workflow includes GitHub login, App installation or configuration, multi-repository selection, and paginated issue browsing. The fixture workflow under `/demo` includes:

- An issue board for a connected repository.
- An issue page showing attempts and their parent relationships.
- An attempt page showing code changes, decisions, checks, and evidence.
- A checkpoint fork flow where a user reviews the inherited context and chooses the next task.

Keep GitHub and Cloudflare credentials in the backend. Codex execution belongs to the local companion. Shared Zod contracts validate live API requests and responses.

The current application uses React, Vite, React Router, Tailwind CSS, and Radix dialog primitives. TanStack Query remains deferred until a real API exists. See [the MVP plan](../../docs/mvp.md) for the planned backend and architecture boundaries.

## Run it

From the repository root, run:

```sh
pnpm install
pnpm dev
```

Run the full local check with:

```sh
pnpm check
```

The `/demo` interface uses fixture records to demonstrate the four derived issue states, attempt evidence, published checkpoints, and child attempts. New demo issues and forks last for the current browser session only. The checkout command shown after a fork is illustrative text. The browser never executes it.

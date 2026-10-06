# Web application

This directory will contain the user interface.

The first workflow includes:

- An issue board for a connected repository.
- An issue page showing attempts and their parent relationships.
- An attempt page showing code changes, decisions, checks, and evidence.
- A checkpoint fork flow where a user reviews the inherited context and chooses the next task.

Keep Cloudflare credentials in the backend. Codex execution belongs to the local companion. Use shared contracts for API requests and responses once those contracts exist.

The chosen stack is React, Vite, React Router, TanStack Query, Tailwind CSS, and shadcn/ui. The built assets are served by the API Worker. See [the MVP plan](../../docs/mvp.md) for architecture and build order. No application code exists yet.

# Set up the GitHub App locally

Create or edit a GitHub App with this callback URL:

```text
http://localhost:5173/api/v1/auth/github/callback
```

Set the App's setup URL to:

```text
http://localhost:5173/api/v1/github/setup
```

Enable **Redirect on update** so GitHub returns to Benana after a user changes which repositories the App can access. Benana then reloads the repositories from GitHub and asks the user which ones to use.

Give the App read access to repository metadata and issues. Benana lists a repository only when the App installation includes it and the signed-in user has `push`, `maintain`, or `admin` permission.

Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars`. Set the GitHub App client ID, client secret, slug, public origin, and a base64-encoded 32-byte `TOKEN_ENCRYPTION_KEY`. Do not commit `.dev.vars`.

Apply the local D1 migration before starting the apps:

```powershell
pnpm --filter @benana/worker exec wrangler d1 migrations apply benana-local --local
pnpm dev
```

Open `http://localhost:5173`. The Vite server proxies `/api` to the local Worker.

The zero UUID in `wrangler.jsonc` is a local-only placeholder. Create D1 databases for staging and production, replace the production database ID in deployment configuration, and set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY` as Worker secrets. Set `GITHUB_APP_SLUG` and `PUBLIC_ORIGIN` as environment variables. Production `PUBLIC_ORIGIN` must use HTTPS. Register its exact `/api/v1/auth/github/callback` URL in the GitHub App.

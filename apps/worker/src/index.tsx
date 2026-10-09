import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  authSessionSchema,
  githubUserSchema,
  repositorySelectionSchema,
} from "@benana/contracts";
import {
  decrypt,
  encrypt,
  pkceChallenge,
  randomToken,
  sha256,
} from "./security";
import {
  GithubApiError,
  listAccessibleRepositories,
  listIssues,
  getIssue,
} from "./github";

export interface Bindings {
  DB: D1Database;
  ARTIFACTS?: Artifacts;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_APP_SLUG: string;
  PUBLIC_ORIGIN: string;
  TOKEN_ENCRYPTION_KEY: string;
}
type Ctx = Context<{ Bindings: Bindings }>;
const app = new Hono<{ Bindings: Bindings }>();
const SESSION = "benana_session",
  OAUTH = "benana_oauth",
  MONTH = 2_592_000,
  TEN_MINUTES = 600;
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

function fail(
  c: Ctx,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502,
  code: string,
  message: string,
  retryable = false,
) {
  return c.json({ error: { code, message, retryable } }, status);
}
function cookieOptions(c: Ctx, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: new URL(c.env.PUBLIC_ORIGIN).protocol === "https:",
    path: "/",
    maxAge,
  };
}
function validateOrigin(c: Ctx) {
  const url = new URL(c.env.PUBLIC_ORIGIN);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("PUBLIC_ORIGIN must use HTTPS outside loopback");
}
async function sessionUser(c: Ctx) {
  const token = getCookie(c, SESSION);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    "SELECT user_id FROM sessions WHERE id_hash=? AND expires_at>?",
  )
    .bind(await sha256(token), Date.now())
    .first<{ user_id: number }>();
  return row?.user_id ?? null;
}
async function requireUser(c: Ctx): Promise<number | Response> {
  return (
    (await sessionUser(c)) ??
    fail(c, 401, "AUTH_REQUIRED", "Sign in to continue.")
  );
}
async function requireMutation(c: Ctx) {
  if (c.req.header("Origin") !== new URL(c.env.PUBLIC_ORIGIN).origin)
    return fail(c, 403, "INVALID_ORIGIN", "The request origin is not allowed.");
  return requireUser(c);
}
async function revokeVersion(
  c: Ctx,
  userId: number,
  version: number,
  owner?: string,
) {
  const ownerClause = owner === undefined ? "" : " AND refresh_owner=?";
  const values =
    owner === undefined ? [userId, version] : [userId, version, owner];
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM github_credentials WHERE user_id=? AND version=?${ownerClause})`,
    ).bind(userId, ...values),
    c.env.DB.prepare(
      `DELETE FROM github_credentials WHERE user_id=? AND version=?${ownerClause}`,
    ).bind(...values),
  ]);
  return results[1]?.meta.changes === 1;
}

async function revokeRejectedToken(
  c: Ctx,
  userId: number,
  tokenFingerprint: string,
) {
  const credential = await c.env.DB.prepare(
    "SELECT access_token,version FROM github_credentials WHERE user_id=?",
  )
    .bind(userId)
    .first<{ access_token: string; version: number }>();
  if (
    !credential ||
    (await sha256(
      await decrypt(credential.access_token, c.env.TOKEN_ENCRYPTION_KEY),
    )) !== tokenFingerprint
  )
    return false;
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM github_credentials WHERE user_id=? AND version=? AND access_token=?)",
    ).bind(userId, userId, credential.version, credential.access_token),
    c.env.DB.prepare(
      "DELETE FROM github_credentials WHERE user_id=? AND version=? AND access_token=?",
    ).bind(userId, credential.version, credential.access_token),
  ]);
  return results[1]?.meta.changes === 1;
}

async function accessToken(c: Ctx, userId: number): Promise<string | Response> {
  const row = await c.env.DB.prepare(
    "SELECT access_token,refresh_token,expires_at,refresh_expires_at,version FROM github_credentials WHERE user_id=?",
  )
    .bind(userId)
    .first<{
      access_token: string;
      refresh_token: string | null;
      expires_at: number | null;
      refresh_expires_at: number | null;
      version: number;
    }>();
  if (!row)
    return fail(
      c,
      401,
      "SESSION_EXPIRED",
      "Your GitHub authorization has expired.",
    );
  if (row.expires_at === null || row.expires_at > Date.now() + 60_000)
    return decrypt(row.access_token, c.env.TOKEN_ENCRYPTION_KEY);
  if (
    !row.refresh_token ||
    (row.refresh_expires_at !== null && row.refresh_expires_at < Date.now())
  ) {
    await revokeVersion(c, userId, row.version);
    return fail(
      c,
      401,
      "SESSION_EXPIRED",
      "Your GitHub authorization has expired.",
    );
  }
  const refreshOwner = randomToken(16);
  const locked = await c.env.DB.prepare(
    "UPDATE github_credentials SET refresh_lock_until=?,refresh_owner=? WHERE user_id=? AND version=? AND (refresh_lock_until IS NULL OR refresh_lock_until<?)",
  )
    .bind(Date.now() + 12_000, refreshOwner, userId, row.version, Date.now())
    .run();
  if (locked.meta.changes !== 1)
    return fail(
      c,
      409,
      "TOKEN_REFRESHING",
      "GitHub authorization is refreshing. Try again.",
      true,
    );
  const oldRefresh = await decrypt(
    row.refresh_token,
    c.env.TOKEN_ENCRYPTION_KEY,
  );
  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "benana",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: oldRefresh,
      }),
    });
  } catch {
    await releaseRefreshLock(c, userId, row.version, refreshOwner);
    return fail(
      c,
      502,
      "GITHUB_UNAVAILABLE",
      "GitHub could not be reached. Try again.",
      true,
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  const parsed = tokenSchema.safeParse(payload);
  const oauthError = oauthErrorSchema.safeParse(payload);
  if (response.status === 429 || response.status === 403) {
    await releaseRefreshLock(c, userId, row.version, refreshOwner);
    return fail(
      c,
      429,
      "GITHUB_RATE_LIMITED",
      "GitHub could not refresh authorization yet. Try again later.",
      true,
    );
  }
  if (response.status >= 500 || (response.ok && !parsed.success)) {
    await releaseRefreshLock(c, userId, row.version, refreshOwner);
    return fail(
      c,
      502,
      "GITHUB_UNAVAILABLE",
      "GitHub could not refresh authorization. Try again.",
      true,
    );
  }
  if (!response.ok || !parsed.success) {
    if (oauthError.success && oauthError.data.error === "bad_refresh_token") {
      const revoked = await revokeVersion(c, userId, row.version, refreshOwner);
      if (!revoked) {
        const current = await c.env.DB.prepare(
          "SELECT access_token FROM github_credentials WHERE user_id=?",
        )
          .bind(userId)
          .first<{ access_token: string }>();
        if (current)
          return decrypt(current.access_token, c.env.TOKEN_ENCRYPTION_KEY);
      }
      return fail(
        c,
        401,
        "SESSION_EXPIRED",
        "Your GitHub authorization has expired.",
      );
    }
    await releaseRefreshLock(c, userId, row.version, refreshOwner);
    return fail(
      c,
      502,
      "GITHUB_REFRESH_FAILED",
      "GitHub could not refresh authorization. Try again.",
      true,
    );
  }
  const data = parsed.data,
    now = Date.now();
  const updated = await c.env.DB.prepare(
    "UPDATE github_credentials SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,version=version+1,refresh_lock_until=NULL,refresh_owner=NULL WHERE user_id=? AND version=? AND refresh_owner=?",
  )
    .bind(
      await encrypt(data.access_token, c.env.TOKEN_ENCRYPTION_KEY),
      await encrypt(
        data.refresh_token ?? oldRefresh,
        c.env.TOKEN_ENCRYPTION_KEY,
      ),
      data.expires_in ? now + data.expires_in * 1000 : null,
      data.refresh_token_expires_in
        ? now + data.refresh_token_expires_in * 1000
        : row.refresh_expires_at,
      userId,
      row.version,
      refreshOwner,
    )
    .run();
  if (updated.meta.changes !== 1) {
    const current = await c.env.DB.prepare(
      "SELECT access_token FROM github_credentials WHERE user_id=?",
    )
      .bind(userId)
      .first<{ access_token: string }>();
    if (!current)
      return fail(
        c,
        401,
        "SESSION_EXPIRED",
        "Your GitHub authorization has expired.",
      );
    return decrypt(current.access_token, c.env.TOKEN_ENCRYPTION_KEY);
  }
  return data.access_token;
}
async function releaseRefreshLock(
  c: Ctx,
  userId: number,
  version: number,
  owner: string,
) {
  await c.env.DB.prepare(
    "UPDATE github_credentials SET refresh_lock_until=NULL,refresh_owner=NULL WHERE user_id=? AND version=? AND refresh_owner=?",
  )
    .bind(userId, version, owner)
    .run();
}
const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token_expires_in: z.number().optional(),
});
const oauthErrorSchema = z.object({ error: z.string() });
async function githubResult(
  c: Ctx,
  userId: number,
  run: () => Promise<Response>,
) {
  try {
    return await run();
  } catch (caught) {
    if (!(caught instanceof GithubApiError))
      return fail(
        c,
        502,
        "GITHUB_ERROR",
        "GitHub returned an unexpected response.",
        true,
      );
    if (caught.code === "TOKEN_REVOKED") {
      if (caught.tokenFingerprint)
        await revokeRejectedToken(c, userId, caught.tokenFingerprint);
      return fail(
        c,
        401,
        "SESSION_EXPIRED",
        "GitHub authorization was revoked.",
      );
    }
    if (caught.code === "RATE_LIMITED")
      return fail(
        c,
        429,
        "GITHUB_RATE_LIMITED",
        "GitHub's rate limit was reached. Try again later.",
        true,
      );
    if (caught.code === "FORBIDDEN")
      return fail(
        c,
        403,
        "GITHUB_FORBIDDEN",
        "GitHub denied access to this resource.",
      );
    return fail(
      c,
      502,
      "GITHUB_ERROR",
      "GitHub returned an unexpected response.",
      true,
    );
  }
}
async function eligible(c: Ctx, userId: number) {
  const token = await accessToken(c, userId);
  return token instanceof Response ? token : listAccessibleRepositories(token);
}

function githubSetupReturn(c: Ctx) {
  validateOrigin(c);
  const destination = new URL("/repositories", c.env.PUBLIC_ORIGIN);
  destination.searchParams.set("github_setup", "complete");
  return c.redirect(destination.toString());
}

app.get("/", (c) => {
  const setup = z
    .object({
      installation_id: z.string().regex(/^\d+$/),
      setup_action: z.enum(["install", "update"]),
    })
    .safeParse(c.req.query());
  return setup.success ? githubSetupReturn(c) : c.notFound();
});
app.get("/api/v1/github/setup", githubSetupReturn);
app.get("/api/v1/health", (c) =>
  c.json({ status: "ok", service: "benana-api" }),
);
app.get("/api/v1/auth/session", async (c) => {
  const id = await sessionUser(c);
  if (!id) return c.json(authSessionSchema.parse({ kind: "anonymous" }));
  const u = await c.env.DB.prepare(
    "SELECT id,login,name,avatar_url,html_url FROM users WHERE id=?",
  )
    .bind(id)
    .first<{
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
      html_url: string;
    }>();
  return c.json(
    u
      ? authSessionSchema.parse({
          kind: "authenticated",
          user: {
            id: u.id,
            login: u.login,
            name: u.name,
            avatarUrl: u.avatar_url,
            htmlUrl: u.html_url,
          },
        })
      : { kind: "anonymous" },
  );
});
app.get("/api/v1/auth/github/start", async (c) => {
  validateOrigin(c);
  const state = randomToken(),
    browser = randomToken(),
    verifier = randomToken(64),
    now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO oauth_transactions(state_hash,browser_hash,verifier_ciphertext,expires_at,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      await sha256(state),
      await sha256(browser),
      await encrypt(verifier, c.env.TOKEN_ENCRYPTION_KEY),
      now + TEN_MINUTES * 1000,
      now,
    )
    .run();
  setCookie(c, OAUTH, browser, cookieOptions(c, TEN_MINUTES));
  const callback = `${new URL(c.env.PUBLIC_ORIGIN).origin}/api/v1/auth/github/callback`,
    url = new URL("https://github.com/login/oauth/authorize");
  for (const [key, value] of Object.entries({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: callback,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
  }))
    url.searchParams.set(key, value);
  return c.redirect(url.toString());
});
app.get("/api/v1/auth/github/callback", async (c) => {
  validateOrigin(c);
  const query = z
      .object({ code: z.string().min(1), state: z.string().min(1) })
      .safeParse(c.req.query()),
    browser = getCookie(c, OAUTH);
  deleteCookie(c, OAUTH, { path: "/" });
  if (!query.success || !browser)
    return fail(
      c,
      400,
      "OAUTH_REJECTED",
      "GitHub sign-in could not be verified.",
    );
  const tx = await c.env.DB.prepare(
    "DELETE FROM oauth_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING verifier_ciphertext",
  )
    .bind(await sha256(query.data.state), await sha256(browser), Date.now())
    .first<{ verifier_ciphertext: string }>();
  if (!tx)
    return fail(
      c,
      400,
      "OAUTH_REJECTED",
      "GitHub sign-in expired or was already used.",
    );
  const callback = `${new URL(c.env.PUBLIC_ORIGIN).origin}/api/v1/auth/github/callback`;
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "benana",
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code: query.data.code,
      redirect_uri: callback,
      code_verifier: await decrypt(
        tx.verifier_ciphertext,
        c.env.TOKEN_ENCRYPTION_KEY,
      ),
    }),
  }).catch(() => null);
  if (!response)
    return fail(
      c,
      502,
      "OAUTH_EXCHANGE_FAILED",
      "GitHub sign-in failed. Try again.",
      true,
    );
  const payload: unknown = await response.json().catch(() => null),
    tokens = tokenSchema.safeParse(payload),
    oauthError = oauthErrorSchema.safeParse(payload);
  if (!tokens.success && oauthError.success) {
    if (oauthError.data.error === "incorrect_client_credentials")
      return fail(
        c,
        502,
        "GITHUB_APP_CONFIGURATION_ERROR",
        "GitHub rejected the app credentials. The app administrator must update the client ID/client secret.",
      );
    if (oauthError.data.error === "bad_verification_code")
      return fail(
        c,
        502,
        "OAUTH_CODE_INVALID",
        "The GitHub sign-in code is invalid or expired. Start a new sign-in.",
      );
    if (oauthError.data.error === "redirect_uri_mismatch")
      return fail(
        c,
        502,
        "GITHUB_CALLBACK_MISMATCH",
        "GitHub rejected the callback URL. The app administrator must update the registered callback URL.",
      );
  }
  if (!response.ok || !tokens.success)
    return fail(
      c,
      502,
      "OAUTH_EXCHANGE_FAILED",
      "GitHub sign-in failed. Try again.",
      true,
    );
  const profileResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokens.data.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "benana",
    },
  }).catch(() => null);
  if (!profileResponse || !profileResponse.ok)
    return fail(
      c,
      502,
      "OAUTH_PROFILE_FAILED",
      "GitHub profile could not be loaded. Start a new sign-in.",
      !profileResponse ||
        profileResponse.status >= 500 ||
        profileResponse.status === 429 ||
        profileResponse.headers.has("retry-after") ||
        profileResponse.headers.get("x-ratelimit-remaining") === "0",
    );
  const profileResult = z
    .object({
      id: z.number(),
      login: z.string(),
      name: z.string().nullable(),
      avatar_url: z.string(),
      html_url: z.string(),
    })
    .transform((raw) => ({
      id: raw.id,
      login: raw.login,
      name: raw.name,
      avatarUrl: raw.avatar_url,
      htmlUrl: raw.html_url,
    }))
    .pipe(githubUserSchema)
    .safeParse(await profileResponse.json().catch(() => null));
  if (!profileResult.success)
    return fail(
      c,
      502,
      "OAUTH_PROFILE_FAILED",
      "GitHub profile could not be loaded. Start a new sign-in.",
      true,
    );
  const profile = profileResult.data,
    session = randomToken(),
    now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users(id,login,name,avatar_url,html_url,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,name=excluded.name,avatar_url=excluded.avatar_url,html_url=excluded.html_url,updated_at=excluded.updated_at",
    ).bind(
      profile.id,
      profile.login,
      profile.name,
      profile.avatarUrl,
      profile.htmlUrl,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO github_credentials(user_id,access_token,refresh_token,expires_at,refresh_expires_at,version) VALUES(?,?,?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,version=github_credentials.version+1,refresh_lock_until=NULL",
    ).bind(
      profile.id,
      await encrypt(tokens.data.access_token, c.env.TOKEN_ENCRYPTION_KEY),
      tokens.data.refresh_token
        ? await encrypt(tokens.data.refresh_token, c.env.TOKEN_ENCRYPTION_KEY)
        : null,
      tokens.data.expires_in ? now + tokens.data.expires_in * 1000 : null,
      tokens.data.refresh_token_expires_in
        ? now + tokens.data.refresh_token_expires_in * 1000
        : null,
    ),
    c.env.DB.prepare(
      "INSERT INTO sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    ).bind(await sha256(session), profile.id, now + MONTH * 1000, now),
  ]);
  setCookie(c, SESSION, session, cookieOptions(c, MONTH));
  return c.redirect(`${new URL(c.env.PUBLIC_ORIGIN).origin}/repositories`);
});
app.post("/api/v1/auth/logout", async (c) => {
  const id = await requireMutation(c);
  if (id instanceof Response) return id;
  const session = getCookie(c, SESSION);
  if (session)
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash=? AND user_id=?")
      .bind(await sha256(session), id)
      .run();
  deleteCookie(c, SESSION, { path: "/" });
  return c.body(null, 204);
});

app.get("/api/v1/github/repositories", async (c) => {
  const id = await requireUser(c);
  if (id instanceof Response) return id;
  return githubResult(c, id, async () => {
    const repos = await eligible(c, id);
    return repos instanceof Response
      ? repos
      : c.json({
          repositories: repos,
          installUrl: `https://github.com/apps/${encodeURIComponent(c.env.GITHUB_APP_SLUG)}/installations/new`,
        });
  });
});
app.get("/api/v1/repositories/selected", async (c) => {
  const id = await requireUser(c);
  if (id instanceof Response) return id;
  return githubResult(c, id, async () => {
    const repos = await eligible(c, id);
    if (repos instanceof Response) return repos;
    const rows = await c.env.DB.prepare(
      "SELECT repository_id FROM repository_selections WHERE user_id=?",
    )
      .bind(id)
      .all<{ repository_id: number }>();
    const ids = new Set(rows.results.map((r) => r.repository_id));
    return c.json({ repositories: repos.filter((r) => ids.has(r.id)) });
  });
});
app.put("/api/v1/repositories/selection", async (c) => {
  const id = await requireMutation(c);
  if (id instanceof Response) return id;
  const body = repositorySelectionSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (
    !body.success ||
    new Set(body.data.repositoryIds).size !== body.data.repositoryIds.length
  )
    return fail(
      c,
      400,
      "INVALID_SELECTION",
      "Choose each repository at most once.",
    );
  return githubResult(c, id, async () => {
    const repos = await eligible(c, id);
    if (repos instanceof Response) return repos;
    const allowed = new Set(repos.map((r) => r.id));
    if (body.data.repositoryIds.some((r) => !allowed.has(r)))
      return fail(
        c,
        403,
        "REPOSITORY_FORBIDDEN",
        "One or more repositories are no longer available.",
      );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM repository_selections WHERE user_id=?",
      ).bind(id),
      ...body.data.repositoryIds.map((repo) =>
        c.env.DB.prepare(
          "INSERT INTO repository_selections(user_id,repository_id,selected_at) VALUES(?,?,?)",
        ).bind(id, repo, Date.now()),
      ),
    ]);
    return c.json({
      repositories: repos.filter((r) => body.data.repositoryIds.includes(r.id)),
    });
  });
});
app.get("/api/v1/repositories/:repositoryId/issues", async (c) => {
  const id = await requireUser(c);
  if (id instanceof Response) return id;
  const p = z.coerce
      .number()
      .int()
      .positive()
      .safeParse(c.req.param("repositoryId")),
    q = z
      .object({
        state: z.enum(["open", "closed", "all"]).default("open"),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      })
      .safeParse(c.req.query());
  if (!p.success || !q.success)
    return fail(
      c,
      400,
      "INVALID_REQUEST",
      "Repository, state, or page is invalid.",
    );
  return githubResult(c, id, async () => {
    const selected = await c.env.DB.prepare(
      "SELECT 1 ok FROM repository_selections WHERE user_id=? AND repository_id=?",
    )
      .bind(id, p.data)
      .first();
    if (!selected)
      return fail(
        c,
        404,
        "REPOSITORY_NOT_SELECTED",
        "Select this repository before viewing issues.",
      );
    const repos = await eligible(c, id);
    if (repos instanceof Response) return repos;
    const repo = repos.find((r) => r.id === p.data);
    if (!repo)
      return fail(
        c,
        403,
        "REPOSITORY_FORBIDDEN",
        "GitHub access to this repository is no longer available.",
      );
    const token = await accessToken(c, id);
    return token instanceof Response
      ? token
      : c.json(await listIssues(token, repo, q.data.state, q.data.page));
  });
});
app.get("/api/v1/repositories/:repositoryId/issues/:issueNumber", async (c) => {
  const id = await requireUser(c);
  if (id instanceof Response) return id;
  const repositoryId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(c.req.param("repositoryId"));
  const issueNumber = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(c.req.param("issueNumber"));
  if (!repositoryId.success || !issueNumber.success)
    return fail(
      c,
      400,
      "INVALID_REQUEST",
      "Repository or issue number is invalid.",
    );
  return githubResult(c, id, async () => {
    const selected = await c.env.DB.prepare(
      "SELECT 1 ok FROM repository_selections WHERE user_id=? AND repository_id=?",
    )
      .bind(id, repositoryId.data)
      .first();
    if (!selected)
      return fail(
        c,
        404,
        "REPOSITORY_NOT_SELECTED",
        "Select this repository before viewing issues.",
      );
    const repos = await eligible(c, id);
    if (repos instanceof Response) return repos;
    const repo = repos.find((candidate) => candidate.id === repositoryId.data);
    if (!repo)
      return fail(
        c,
        403,
        "REPOSITORY_FORBIDDEN",
        "GitHub access to this repository is no longer available.",
      );
    const token = await accessToken(c, id);
    if (token instanceof Response) return token;
    try {
      const issue = await getIssue(token, repo, issueNumber.data);
      return issue
        ? c.json(issue)
        : fail(c, 404, "ISSUE_NOT_FOUND", "This issue was not found.");
    } catch (error) {
      if (error instanceof GithubApiError && error.status === 404)
        return fail(c, 404, "ISSUE_NOT_FOUND", "This issue was not found.");
      throw error;
    }
  });
});
export default app;

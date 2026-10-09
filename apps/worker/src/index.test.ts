import { afterEach, describe, expect, it, vi } from "vitest";
import app, { type Bindings } from "./index";
import { createTestD1 } from "./test-d1";
import { decrypt } from "./security";
const base = {
  PUBLIC_ORIGIN: "http://localhost:5173",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
  GITHUB_APP_SLUG: "app",
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};
function cookie(response: Response, name: string) {
  const match = response.headers
    .get("set-cookie")
    ?.match(new RegExp(`${name}=([^;]+)`));
  if (!match?.[1]) throw new Error(`Missing ${name}`);
  return `${name}=${match[1]}`;
}
function env(): Bindings {
  return { ...base, DB: createTestD1() };
}
async function login(
  environment: Bindings,
  userId = 10,
  accessToken = `access-${userId}`,
) {
  const start = await app.request(
      "http://localhost/api/v1/auth/github/start",
      {},
      environment,
    ),
    authUrl = new URL(start.headers.get("location") ?? ""),
    oauthCookie = cookie(start, "benana_oauth");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("login/oauth/access_token"))
        return Response.json({
          access_token: accessToken,
          refresh_token: `refresh-${userId}`,
          expires_in: 28800,
          refresh_token_expires_in: 100000,
        });
      if (url.endsWith("/user"))
        return Response.json({
          id: userId,
          login: `user-${userId}`,
          name: null,
          avatar_url: `https://avatars.example/${userId}`,
          html_url: `https://github.com/user-${userId}`,
        });
      throw new Error(`Unexpected fetch ${url}`);
    }),
  );
  const state = authUrl.searchParams.get("state") ?? "",
    callback = await app.request(
      `http://localhost/api/v1/auth/github/callback?code=code&state=${state}`,
      { headers: { Cookie: oauthCookie } },
      environment,
    );
  expect(callback.status).toBe(302);
  return {
    sessionCookie: cookie(callback, "benana_session"),
    oauthCookie,
    state,
  };
}
async function rejectedCallback(
  environment: Bindings,
  tokenResponse: Response | Error,
) {
  const start = await app.request(
      "http://localhost/api/v1/auth/github/start",
      {},
      environment,
    ),
    authUrl = new URL(start.headers.get("location") ?? ""),
    oauthCookie = cookie(start, "benana_oauth");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (tokenResponse instanceof Error) throw tokenResponse;
      return tokenResponse;
    }),
  );
  return app.request(
    `http://localhost/api/v1/auth/github/callback?code=code&state=${authUrl.searchParams.get("state") ?? ""}`,
    { headers: { Cookie: oauthCookie } },
    environment,
  );
}
async function expectNoAuthentication(environment: Bindings) {
  const credentials = await environment.DB.prepare(
      "SELECT COUNT(*) count FROM github_credentials",
    ).first<{ count: number }>(),
    sessions = await environment.DB.prepare(
      "SELECT COUNT(*) count FROM sessions",
    ).first<{ count: number }>();
  expect(credentials).toEqual({ count: 0 });
  expect(sessions).toEqual({ count: 0 });
}
afterEach(() => vi.unstubAllGlobals());
describe("GitHub App setup return", () => {
  it.each([
    "http://localhost/?installation_id=169350373&setup_action=install",
    "http://localhost/?installation_id=999999999&setup_action=update",
    "http://localhost/api/v1/github/setup?installation_id=169350373&setup_action=install",
  ])(
    "returns repository configuration to the fixed public destination",
    async (url) => {
      const environment = env(),
        response = await app.request(url, {}, environment);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://localhost:5173/repositories?github_setup=complete",
      );
      await expectNoAuthentication(environment);
      expect(
        await environment.DB.prepare(
          "SELECT COUNT(*) count FROM repository_selections",
        ).first(),
      ).toEqual({ count: 0 });
    },
  );
  it.each([
    "http://localhost/",
    "http://localhost/?installation_id=169350373",
    "http://localhost/?installation_id=169350373&setup_action=delete",
  ])("keeps unrelated Worker root requests unavailable", async (url) => {
    expect((await app.request(url, {}, env())).status).toBe(404);
  });
});
describe("OAuth and session integration", () => {
  it("binds PKCE state to the browser before token exchange", async () => {
    const environment = env(),
      start = await app.request(
        "http://localhost/api/v1/auth/github/start",
        {},
        environment,
      ),
      location = new URL(start.headers.get("location") ?? ""),
      state = location.searchParams.get("state") ?? "";
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.headers.get("set-cookie")).toContain("HttpOnly");
    const wrong = await app.request(
      `http://localhost/api/v1/auth/github/callback?code=x&state=${state}`,
      { headers: { Cookie: "benana_oauth=wrong" } },
      environment,
    );
    expect(wrong.status).toBe(400);
    expect(
      (
        await environment.DB.prepare(
          "SELECT COUNT(*) count FROM github_credentials",
        ).first<{ count: number }>()
      )?.count,
    ).toBe(0);
  });
  it("creates an opaque session, encrypts the token, and rejects replay", async () => {
    const environment = env(),
      loggedIn = await login(environment),
      response = await app.request(
        "http://localhost/api/v1/auth/session",
        { headers: { Cookie: loggedIn.sessionCookie } },
        environment,
      );
    expect(await response.json()).toMatchObject({
      kind: "authenticated",
      user: { id: 10 },
    });
    const stored = await environment.DB.prepare(
      "SELECT access_token FROM github_credentials WHERE user_id=10",
    ).first<{ access_token: string }>();
    expect(stored?.access_token).not.toContain("access-10");
    const replay = await app.request(
      `http://localhost/api/v1/auth/github/callback?code=code&state=${loggedIn.state}`,
      { headers: { Cookie: loggedIn.oauthCookie } },
      environment,
    );
    expect(replay.status).toBe(400);
  });
  it.each([
    {
      providerError: "incorrect_client_credentials",
      code: "GITHUB_APP_CONFIGURATION_ERROR",
      message:
        "GitHub rejected the app credentials. The app administrator must update the client ID/client secret.",
    },
    {
      providerError: "bad_verification_code",
      code: "OAUTH_CODE_INVALID",
      message:
        "The GitHub sign-in code is invalid or expired. Start a new sign-in.",
    },
    {
      providerError: "redirect_uri_mismatch",
      code: "GITHUB_CALLBACK_MISMATCH",
      message:
        "GitHub rejected the callback URL. The app administrator must update the registered callback URL.",
    },
  ])(
    "maps GitHub $providerError without creating authentication",
    async (expected) => {
      const environment = env(),
        response = await rejectedCallback(
          environment,
          Response.json({
            error: expected.providerError,
            error_description: "provider-secret-description",
          }),
        ),
        body = await response.json();
      expect(response.status).toBe(502);
      expect(body).toEqual({
        error: {
          code: expected.code,
          message: expected.message,
          retryable: false,
        },
      });
      expect(JSON.stringify(body)).not.toContain("provider-secret-description");
      await expectNoAuthentication(environment);
    },
  );
  it("handles a non-JSON token response without leaking it", async () => {
    const environment = env(),
      response = await rejectedCallback(
        environment,
        new Response("provider-secret-body", { status: 502 }),
      ),
      body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        code: "OAUTH_EXCHANGE_FAILED",
        message: "GitHub sign-in failed. Try again.",
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("provider-secret-body");
    await expectNoAuthentication(environment);
  });
  it.each([
    {
      name: "revoked token",
      status: 401,
      body: { message: "provider-secret" },
      retryable: false,
    },
    {
      name: "forbidden profile",
      status: 403,
      body: { message: "provider-secret" },
      retryable: false,
    },
    {
      name: "provider outage",
      status: 503,
      body: { message: "provider-secret" },
      retryable: true,
    },
    {
      name: "non-JSON profile",
      status: 200,
      body: "provider-secret",
      retryable: true,
    },
    {
      name: "invalid profile",
      status: 200,
      body: { login: "provider-secret" },
      retryable: true,
    },
    { name: "network failure", status: 0, body: null, retryable: true },
  ])("handles $name without creating authentication", async (scenario) => {
    const environment = env();
    const start = await app.request(
      "http://localhost/api/v1/auth/github/start",
      {},
      environment,
    );
    const authUrl = new URL(start.headers.get("location") ?? "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("login/oauth/access_token"))
          return Response.json({ access_token: "new-access-token" });
        if (!scenario.status) throw new Error("provider-secret");
        return typeof scenario.body === "string"
          ? new Response(scenario.body, { status: scenario.status })
          : Response.json(scenario.body, { status: scenario.status });
      }),
    );
    const response = await app.request(
      `http://localhost/api/v1/auth/github/callback?code=code&state=${authUrl.searchParams.get("state") ?? ""}`,
      { headers: { Cookie: cookie(start, "benana_oauth") } },
      environment,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "OAUTH_PROFILE_FAILED",
        message: "GitHub profile could not be loaded. Start a new sign-in.",
        retryable: scenario.retryable,
      },
    });
    await expectNoAuthentication(environment);
  });
  it("handles token exchange network failure without creating authentication", async () => {
    const environment = env();
    const response = await rejectedCallback(
      environment,
      new Error("provider-secret"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "OAUTH_EXCHANGE_FAILED",
        message: "GitHub sign-in failed. Try again.",
        retryable: true,
      },
    });
    await expectNoAuthentication(environment);
  });
});
describe("repository authorization integration", () => {
  it("validates detail IDs and requires a saved repository before GitHub access", async () => {
    const environment = env();
    const { sessionCookie } = await login(environment);
    const invalid = await app.request(
      "http://localhost/api/v1/repositories/0/issues/nope",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(invalid.status).toBe(400);
    const unselected = await app.request(
      "http://localhost/api/v1/repositories/100/issues/4",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(unselected.status).toBe(404);
    expect(await unselected.json()).toMatchObject({
      error: { code: "REPOSITORY_NOT_SELECTED" },
    });
  });
  it("rechecks current GitHub access for a saved repository detail", async () => {
    const environment = env();
    const { sessionCookie } = await login(environment);
    await environment.DB.prepare(
      "INSERT INTO repository_selections(user_id,repository_id,selected_at) VALUES(?,?,?)",
    )
      .bind(10, 100, Date.now())
      .run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/user/installations?"))
          return Response.json({ installations: [] });
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );
    const response = await app.request(
      "http://localhost/api/v1/repositories/100/issues/4",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "REPOSITORY_FORBIDDEN" },
    });
  });
  it.each(["missing", "pull request"] as const)(
    "returns issue-not-found for a GitHub %s detail",
    async (kind) => {
      const environment = env();
      const { sessionCookie } = await login(environment);
      await environment.DB.prepare(
        "INSERT INTO repository_selections(user_id,repository_id,selected_at) VALUES(?,?,?)",
      )
        .bind(10, 100, Date.now())
        .run();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/user/installations?"))
            return Response.json({ installations: [{ id: 50 }] });
          if (url.includes("/user/installations/50/repositories"))
            return Response.json({
              repositories: [
                {
                  id: 100,
                  name: "repo",
                  full_name: "org/repo",
                  private: true,
                  html_url: "https://github.com/org/repo",
                  owner: { login: "org" },
                  permissions: {
                    pull: true,
                    push: true,
                    admin: false,
                    maintain: false,
                    triage: false,
                  },
                },
              ],
            });
          if (url.endsWith("/repos/org/repo/issues/4")) {
            if (kind === "missing") return new Response("{}", { status: 404 });
            return Response.json({
              id: 4,
              number: 4,
              title: "PR",
              body: null,
              state: "open",
              html_url: "https://github.com/org/repo/pull/4",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
              labels: [],
              assignees: [],
              pull_request: {},
            });
          }
          throw new Error(`Unexpected fetch ${url}`);
        }),
      );
      const response = await app.request(
        "http://localhost/api/v1/repositories/100/issues/4",
        { headers: { Cookie: sessionCookie } },
        environment,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "ISSUE_NOT_FOUND" },
      });
    },
  );
  it("rejects mutation origins before database access", async () => {
    const response = await app.request(
      "http://localhost/api/v1/repositories/selection",
      {
        method: "PUT",
        headers: {
          Origin: "https://attacker.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repositoryIds: [1] }),
      },
      { ...base, DB: {} as D1Database },
    );
    expect(response.status).toBe(403);
  });
  it("saves eligible IDs and preserves selection after a forged request", async () => {
    const environment = env(),
      { sessionCookie } = await login(environment);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/user/installations?"))
          return Response.json({ installations: [{ id: 50 }] });
        if (url.includes("/user/installations/50/repositories"))
          return Response.json({
            repositories: [
              {
                id: 100,
                name: "repo",
                full_name: "org/repo",
                private: true,
                html_url: "https://github.com/org/repo",
                owner: { login: "org" },
                permissions: {
                  pull: true,
                  push: true,
                  admin: false,
                  maintain: false,
                  triage: false,
                },
              },
            ],
          });
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );
    const headers = {
        Cookie: sessionCookie,
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      saved = await app.request(
        "http://localhost/api/v1/repositories/selection",
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ repositoryIds: [100] }),
        },
        environment,
      );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ repositories: [{ id: 100 }] });
    const forged = await app.request(
      "http://localhost/api/v1/repositories/selection",
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ repositoryIds: [999] }),
      },
      environment,
    );
    expect(forged.status).toBe(403);
    const rows = await environment.DB.prepare(
      "SELECT repository_id FROM repository_selections WHERE user_id=10",
    ).all<{ repository_id: number }>();
    expect(rows.results).toEqual([{ repository_id: 100 }]);
  });
  it("keeps credentials and releases the refresh lock after a transient GitHub failure", async () => {
    const environment = env();
    const { sessionCookie } = await login(environment);
    await environment.DB.prepare(
      "UPDATE github_credentials SET expires_at=0 WHERE user_id=10",
    ).run();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "server_error" }, { status: 503 }),
        ),
    );
    const response = await app.request(
      "http://localhost/api/v1/github/repositories",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(response.status).toBe(502);
    const credential = await environment.DB.prepare(
      "SELECT refresh_lock_until FROM github_credentials WHERE user_id=10",
    ).first<{ refresh_lock_until: number | null }>();
    expect(credential).toEqual({ refresh_lock_until: null });
  });
  it("preserves credentials when GitHub rate limits token refresh", async () => {
    const environment = env();
    const { sessionCookie } = await login(environment);
    await environment.DB.prepare(
      "UPDATE github_credentials SET expires_at=0 WHERE user_id=10",
    ).run();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "slow_down" }, { status: 429 }),
        ),
    );
    const response = await app.request(
      "http://localhost/api/v1/github/repositories",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(response.status).toBe(429);
    expect(
      await environment.DB.prepare(
        "SELECT refresh_lock_until FROM github_credentials WHERE user_id=10",
      ).first(),
    ).toEqual({ refresh_lock_until: null });
  });
  it("cannot revoke credentials replaced by a newer login", async () => {
    const environment = env();
    const { sessionCookie } = await login(environment);
    await environment.DB.prepare(
      "UPDATE github_credentials SET expires_at=0 WHERE user_id=10",
    ).run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await environment.DB.prepare(
          "UPDATE github_credentials SET version=version+1,refresh_lock_until=NULL,refresh_owner=NULL WHERE user_id=10",
        ).run();
        return Response.json({ error: "bad_refresh_token" }, { status: 400 });
      }),
    );
    const response = await app.request(
      "http://localhost/api/v1/github/repositories",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(response.status).toBe(502);
    const credential = await environment.DB.prepare(
      "SELECT version FROM github_credentials WHERE user_id=10",
    ).first<{ version: number }>();
    expect(credential?.version).toBeGreaterThan(1);
    expect(
      await environment.DB.prepare(
        "SELECT COUNT(*) count FROM sessions WHERE user_id=10",
      ).first(),
    ).toEqual({ count: 1 });
  });
  it("preserves a newer login when an older token receives a delayed 401", async () => {
    const environment = env();
    const { sessionCookie } = await login(environment);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer access-10",
        );
        await login(environment, 10, "replacement-token");
        return new Response("{}", { status: 401 });
      }),
    );
    const response = await app.request(
      "http://localhost/api/v1/github/repositories",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(response.status).toBe(401);
    const credential = await environment.DB.prepare(
      "SELECT access_token,version FROM github_credentials WHERE user_id=10",
    ).first<{ access_token: string; version: number }>();
    expect(credential?.version).toBe(2);
    expect(
      credential &&
        (await decrypt(credential.access_token, base.TOKEN_ENCRYPTION_KEY)),
    ).toBe("replacement-token");
    expect(
      await environment.DB.prepare(
        "SELECT COUNT(*) count FROM sessions WHERE user_id=10",
      ).first(),
    ).toEqual({ count: 2 });
  });
  it("deletes sessions and credentials for the token GitHub revoked", async () => {
    const environment = env();
    const { sessionCookie } = await login(environment);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    const response = await app.request(
      "http://localhost/api/v1/github/repositories",
      { headers: { Cookie: sessionCookie } },
      environment,
    );
    expect(response.status).toBe(401);
    expect(
      await environment.DB.prepare(
        "SELECT COUNT(*) count FROM github_credentials WHERE user_id=10",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await environment.DB.prepare(
        "SELECT COUNT(*) count FROM sessions WHERE user_id=10",
      ).first(),
    ).toEqual({ count: 0 });
  });
  it("does not expose the removed token endpoint", async () => {
    expect(
      (
        await app.request(
          "http://localhost/create-repo",
          { method: "POST" },
          env(),
        )
      ).status,
    ).toBe(404);
  });
});

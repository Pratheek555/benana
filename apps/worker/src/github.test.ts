import { afterEach, describe, expect, it, vi } from "vitest";
import { getIssue, GithubApiError, listIssues } from "./github";

const repository = {
  id: 7,
  installationId: 3,
  owner: "octo",
  name: "repo",
  fullName: "octo/repo",
  private: true,
  htmlUrl: "https://github.com/octo/repo",
  permissions: {
    pull: true,
    push: true,
    admin: false,
    maintain: false,
    triage: false,
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("GitHub issue boundary", () => {
  it("filters pull requests without dropping continuation", async () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      number: index + 1,
      title: `Item ${index}`,
      body: null,
      state: "open",
      html_url: `https://github.com/octo/repo/issues/${index + 1}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      labels: [],
      assignees: [],
      ...(index === 0 ? { pull_request: {} } : {}),
    }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(entries), { status: 200 }),
        ),
    );
    const page = await listIssues("token", repository, "open", 1);
    expect(page.issues).toHaveLength(49);
    expect(page.nextPage).toBe(2);
    expect(page.issues.some((issue) => issue.id === 1)).toBe(false);
  });
  it("distinguishes rate limits from permission failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", { status: 403, headers: { "Retry-After": "60" } }),
        ),
    );
    await expect(
      listIssues("token", repository, "open", 1),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
    } satisfies Partial<GithubApiError>);
  });
  it("normalizes a detail issue with labels and assignees", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      id: 71,
      number: 12,
      title: "Real detail",
      body: "line one\nline two",
      state: "closed",
      html_url: "https://github.com/octo/repo/issues/12",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      labels: [{ id: 4, name: "bug", color: null, description: "Defect" }],
      assignees: [{ id: 8, login: "octo", avatar_url: "https://avatars.example/octo", html_url: "https://github.com/octo" }],
    })));
    await expect(getIssue("token", repository, 12)).resolves.toEqual({
      id: 71,
      number: 12,
      title: "Real detail",
      body: "line one\nline two",
      state: "closed",
      htmlUrl: "https://github.com/octo/repo/issues/12",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      labels: [{ id: 4, name: "bug", color: "808080", description: "Defect" }],
      assignees: [{ id: 8, login: "octo", avatarUrl: "https://avatars.example/octo", htmlUrl: "https://github.com/octo" }],
    });
  });
  it("treats a pull request detail as missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      id: 1, number: 2, title: "PR", body: null, state: "open",
      html_url: "https://github.com/octo/repo/pull/2",
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
      labels: [], assignees: [], pull_request: {},
    })));
    await expect(getIssue("token", repository, 2)).resolves.toBeNull();
  });
  it("preserves a GitHub 404 for the endpoint to translate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    await expect(getIssue("token", repository, 404)).rejects.toMatchObject({ status: 404, code: "GITHUB_ERROR" } satisfies Partial<GithubApiError>);
  });
});

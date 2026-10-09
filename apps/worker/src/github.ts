import { z } from "zod";
import {
  repositorySchema,
  type AccessibleRepository,
  issueSchema,
  type GithubIssue,
  issuePageSchema,
  type IssuePage,
} from "@benana/contracts";
import { sha256 } from "./security";

const installationPageSchema = z.object({
  installations: z.array(z.object({ id: z.number().int().positive() })),
});
const githubRepositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  html_url: z.string().url(),
  owner: z.object({ login: z.string() }),
  permissions: z.object({
    pull: z.boolean().default(false),
    push: z.boolean().default(false),
    admin: z.boolean().default(false),
    maintain: z.boolean().default(false),
    triage: z.boolean().default(false),
  }),
});
const repositoryPageSchema = z.object({
  repositories: z.array(githubRepositorySchema),
});
const githubIssueSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  html_url: z.string().url(),
  created_at: z.string(),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
  labels: z.array(
    z.union([
      z.string(),
      z.object({
        id: z.number().int().positive().nullable(),
        name: z.string().nullable(),
        color: z.string().nullable(),
        description: z.string().nullable(),
      }),
    ]),
  ),
  assignees: z
    .array(
      z.object({
        id: z.number().int().positive(),
        login: z.string(),
        avatar_url: z.string().url(),
        html_url: z.string().url(),
      }),
    )
    .nullable(),
});

export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      "TOKEN_REVOKED" | "FORBIDDEN" | "RATE_LIMITED" | "GITHUB_ERROR",
    readonly tokenFingerprint: string | null,
  ) {
    super(code);
  }
}

function normalizeIssue(raw: z.infer<typeof githubIssueSchema>): GithubIssue {
  return issueSchema.parse({
    id: raw.id,
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state,
    labels: raw.labels.flatMap((label) =>
      typeof label === "string" || label.id === null || label.name === null
        ? []
        : [{
            id: label.id,
            name: label.name,
            color: label.color ?? "808080",
            description: label.description,
          }],
    ),
    assignees: (raw.assignees ?? []).map((person) => ({
      id: person.id,
      login: person.login,
      avatarUrl: person.avatar_url,
      htmlUrl: person.html_url,
    })),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    htmlUrl: raw.html_url,
  });
}

async function githubFetch(token: string, path: string): Promise<Response> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "benana",
    },
  });
  if (response.ok) return response;
  if (response.status === 401)
    throw new GithubApiError(401, "TOKEN_REVOKED", await sha256(token));
  if (response.status === 403 || response.status === 429)
    throw new GithubApiError(
      response.status,
      response.status === 429 ||
        response.headers.has("retry-after") ||
        response.headers.get("x-ratelimit-remaining") === "0"
        ? "RATE_LIMITED"
        : "FORBIDDEN",
      null,
    );
  throw new GithubApiError(response.status, "GITHUB_ERROR", null);
}

export async function listAccessibleRepositories(
  token: string,
): Promise<AccessibleRepository[]> {
  const installations: number[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = installationPageSchema.parse(
      await (
        await githubFetch(
          token,
          `/user/installations?per_page=100&page=${page}`,
        )
      ).json(),
    );
    installations.push(
      ...result.installations.map((installation) => installation.id),
    );
    if (result.installations.length < 100) break;
  }
  const repositories = new Map<number, AccessibleRepository>();
  for (const installationId of installations) {
    for (let page = 1; page <= 100; page += 1) {
      const result = repositoryPageSchema.parse(
        await (
          await githubFetch(
            token,
            `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
          )
        ).json(),
      );
      for (const repository of result.repositories) {
        if (
          !repository.permissions.push &&
          !repository.permissions.admin &&
          !repository.permissions.maintain
        )
          continue;
        repositories.set(
          repository.id,
          repositorySchema.parse({
            id: repository.id,
            installationId,
            owner: repository.owner.login,
            name: repository.name,
            fullName: repository.full_name,
            private: repository.private,
            htmlUrl: repository.html_url,
            permissions: repository.permissions,
          }),
        );
      }
      if (result.repositories.length < 100) break;
    }
  }
  return [...repositories.values()].sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
}

export async function listIssues(
  token: string,
  repository: AccessibleRepository,
  state: "open" | "closed" | "all",
  page: number,
): Promise<IssuePage> {
  const raw = z
    .array(githubIssueSchema)
    .parse(
      await (
        await githubFetch(
          token,
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues?state=${state}&per_page=50&page=${page}`,
        )
      ).json(),
    );
  const issues = raw
    .filter((issue) => issue.pull_request === undefined)
    .map(normalizeIssue);
  return issuePageSchema.parse({
    issues,
    nextPage: raw.length === 50 ? page + 1 : null,
  });
}

export async function getIssue(
  token: string,
  repository: AccessibleRepository,
  issueNumber: number,
): Promise<GithubIssue | null> {
  const raw = githubIssueSchema.parse(
    await (
      await githubFetch(
        token,
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${issueNumber}`,
      )
    ).json(),
  );
  return raw.pull_request === undefined ? normalizeIssue(raw) : null;
}

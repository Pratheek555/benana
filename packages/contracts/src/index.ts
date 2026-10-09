import { z } from "zod";

export const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatarUrl: z.string().url(),
  htmlUrl: z.string().url(),
});
export type GithubUser = z.infer<typeof githubUserSchema>;

export const authSessionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous") }),
  z.object({ kind: z.literal("authenticated"), user: githubUserSchema }),
]);
export type AuthSession = z.infer<typeof authSessionSchema>;

export const repositorySchema = z.object({
  id: z.number().int().positive(),
  installationId: z.number().int().positive(),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  private: z.boolean(),
  htmlUrl: z.string().url(),
  permissions: z.object({
    pull: z.boolean(),
    push: z.boolean(),
    admin: z.boolean(),
    maintain: z.boolean(),
    triage: z.boolean(),
  }),
});
export type AccessibleRepository = z.infer<typeof repositorySchema>;

export const repositoryListSchema = z.object({
  repositories: z.array(repositorySchema),
  installUrl: z.string().url(),
});
export const repositorySelectionSchema = z.object({
  repositoryIds: z.array(z.number().int().positive()).max(100),
});
export type RepositorySelection = z.infer<typeof repositorySelectionSchema>;
export const selectedRepositoryListSchema = z.object({
  repositories: z.array(repositorySchema),
});

const issuePersonSchema = z.object({
  id: z.number().int().positive(),
  login: z.string(),
  avatarUrl: z.string().url(),
  htmlUrl: z.string().url(),
});
const issueLabelSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
});
export const issueSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  labels: z.array(issueLabelSchema),
  assignees: z.array(issuePersonSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  htmlUrl: z.string().url(),
});
export type GithubIssue = z.infer<typeof issueSchema>;
export const issuePageSchema = z.object({
  issues: z.array(issueSchema),
  nextPage: z.number().int().positive().nullable(),
});
export type IssuePage = z.infer<typeof issuePageSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

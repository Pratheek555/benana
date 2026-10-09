import type { GithubIssue } from "@benana/contracts";

export type IssueRequest = { page: number; mode: "replace" | "append" };
export type IssueCollectionState =
  | { kind: "loading"; records: GithubIssue[]; request: IssueRequest }
  | { kind: "ready"; records: GithubIssue[]; nextPage: number | null }
  | {
      kind: "error";
      records: GithubIssue[];
      nextPage: number | null;
      failed: IssueRequest;
      message: string;
    };

export function mergeIssues(
  current: GithubIssue[],
  incoming: GithubIssue[],
): GithubIssue[] {
  const records = new Map(current.map((issue) => [issue.id, issue]));
  for (const issue of incoming) records.set(issue.id, issue);
  return [...records.values()];
}

export function completeIssueRequest(
  state: IssueCollectionState,
  request: IssueRequest,
  issues: GithubIssue[],
  nextPage: number | null,
): IssueCollectionState {
  return {
    kind: "ready",
    records:
      request.mode === "append" ? mergeIssues(state.records, issues) : issues,
    nextPage,
  };
}

export type IssueDetailState =
  | { kind: "closed" }
  | { kind: "loading"; key: string }
  | { kind: "ready"; key: string; issue: GithubIssue }
  | { kind: "missing"; key: string }
  | { kind: "error"; key: string; message: string };

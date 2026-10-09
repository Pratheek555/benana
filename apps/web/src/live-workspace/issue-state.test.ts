import { describe, expect, it } from "vitest";
import type { GithubIssue } from "@benana/contracts";
import { completeIssueRequest, mergeIssues } from "./issue-state";

function issue(id: number, title = `Issue ${id}`): GithubIssue {
  return {
    id,
    number: id,
    title,
    body: null,
    state: "open",
    labels: [],
    assignees: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    htmlUrl: `https://github.com/o/r/issues/${id}`,
  };
}

describe("live issue collection", () => {
  it("deduplicates append pages and accepts the newest record", () => {
    expect(
      mergeIssues([issue(1), issue(2)], [issue(2, "Updated"), issue(3)]),
    ).toEqual([issue(1), issue(2, "Updated"), issue(3)]);
  });
  it("keeps earlier records when an append retry completes", () => {
    const state = completeIssueRequest(
      {
        kind: "error",
        records: [issue(1)],
        nextPage: 2,
        failed: { page: 2, mode: "append" },
        message: "failed",
      },
      { page: 2, mode: "append" },
      [issue(2)],
      null,
    );
    expect(state).toEqual({
      kind: "ready",
      records: [issue(1), issue(2)],
      nextPage: null,
    });
  });
});

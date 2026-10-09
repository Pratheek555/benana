import { describe, expect, it } from "vitest";
import { initialData } from "../demo/fixtures";
import type { Attempt, DemoData } from "./types";
import { createFork, deriveIssueStatus, summarizeIssues } from "./workspace";

const child: Omit<Attempt, "parentCheckpointId" | "nextTask"> = {
  id: "att-test-child",
  issueId: "issue-142",
  title: "Continue atomic publication",
  contributorId: "prath",
  createdAt: "2026-10-07T09:00:00Z",
};

describe("checkpoint forks", () => {
  it("refuses pending and failed checkpoints", () => {
    expect(
      createFork(initialData, "cp-53", "Continue the work", child),
    ).toEqual({
      kind: "rejected",
      reason: "checkpoint-not-published",
    });
    expect(
      createFork(initialData, "cp-69", "Continue the work", child),
    ).toEqual({
      kind: "rejected",
      reason: "checkpoint-not-published",
    });
  });

  it("keeps the parent identity unchanged and gives the child the exact parent checkpoint", () => {
    const parentBefore = initialData.checkpoints.find(
      (checkpoint) => checkpoint.id === "cp-72",
    );
    const parentSnapshot = structuredClone(parentBefore);
    const result = createFork(
      initialData,
      "cp-72",
      "  Resume the retry path  ",
      child,
    );
    const parentAfter = initialData.checkpoints.find(
      (checkpoint) => checkpoint.id === "cp-72",
    );

    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.attempt.parentCheckpointId).toBe("cp-72");
    expect(result.attempt.nextTask).toBe("Resume the retry path");
    expect(result.inherited).toBe(parentBefore);
    expect(parentAfter).toEqual(parentSnapshot);
  });

  it("refuses a blank next task", () => {
    expect(createFork(initialData, "cp-72", "   ", child)).toEqual({
      kind: "rejected",
      reason: "task-required",
    });
  });
});

describe("derived issue state", () => {
  it("updates attempt counts after a child fork without an editable count field", () => {
    const result = createFork(
      initialData,
      "cp-72",
      "Resume the retry path",
      child,
    );
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    const nextData: DemoData = {
      ...initialData,
      attempts: [...initialData.attempts, result.attempt],
    };
    const summary = summarizeIssues(nextData, "benana").find(
      (item) => item.issue.id === "issue-142",
    );

    expect(summary?.attemptCount).toBe(2);
    expect(summary?.status).toBe("review");
  });

  it("derives open, active, review, and done from records", () => {
    expect(deriveIssueStatus("issue-131", initialData)).toBe("open");
    expect(deriveIssueStatus("issue-134", initialData)).toBe("active");
    expect(deriveIssueStatus("issue-142", initialData)).toBe("review");
    expect(deriveIssueStatus("issue-124", initialData)).toBe("done");
  });
});

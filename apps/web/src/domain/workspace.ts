import type {
  Attempt,
  Checkpoint,
  DemoData,
  ForkResult,
  IssueStatus,
  IssueSummary,
  LineageEntry,
  PublishedCheckpoint,
} from "./types";

export const statusOrder: readonly IssueStatus[] = [
  "open",
  "active",
  "review",
  "done",
];

export function deriveIssueStatus(
  issueId: string,
  data: DemoData,
): IssueStatus {
  const attempts = data.attempts.filter(
    (attempt) => attempt.issueId === issueId,
  );
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  const checkpoints = data.checkpoints.filter((checkpoint) =>
    attemptIds.has(checkpoint.attemptId),
  );
  const publishedIds = new Set(
    checkpoints
      .filter(isPublishedCheckpoint)
      .map((checkpoint) => checkpoint.id),
  );

  if (data.exports.some((record) => publishedIds.has(record.checkpointId)))
    return "done";
  if (publishedIds.size > 0) return "review";
  if (attempts.length > 0) return "active";
  return "open";
}

export function isPublishedCheckpoint(
  checkpoint: Checkpoint,
): checkpoint is PublishedCheckpoint {
  return checkpoint.kind === "published";
}

export function summarizeIssues(
  data: DemoData,
  repositoryId: string,
): readonly IssueSummary[] {
  return data.issues
    .filter((issue) => issue.repositoryId === repositoryId)
    .map((issue) => {
      const attempts = data.attempts.filter(
        (attempt) => attempt.issueId === issue.id,
      );
      const contributor = data.contributors.find(
        (person) => person.id === issue.assigneeId,
      );
      return {
        issue,
        status: deriveIssueStatus(issue.id, data),
        attemptCount: attempts.length,
        contributor,
      };
    });
}

export function filterIssues(
  summaries: readonly IssueSummary[],
  query: string,
  status: IssueStatus | "all",
): readonly IssueSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return summaries.filter((summary) => {
    const matchesStatus = status === "all" || summary.status === status;
    const searchable =
      `${summary.issue.number} ${summary.issue.title} ${summary.issue.labels.join(" ")}`.toLocaleLowerCase();
    return (
      matchesStatus && (needle.length === 0 || searchable.includes(needle))
    );
  });
}

export function attemptsForIssue(
  issueId: string,
  data: DemoData,
): readonly Attempt[] {
  return data.attempts.filter((attempt) => attempt.issueId === issueId);
}

export function lineageForAttempt(
  attempt: Attempt,
  data: DemoData,
): readonly LineageEntry[] {
  const entries: LineageEntry[] = [];
  let current: Attempt | undefined = attempt;
  const visited = new Set<string>();

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const parentCheckpointId: string | undefined = current.parentCheckpointId;
    const parent: Checkpoint | undefined = parentCheckpointId
      ? data.checkpoints.find(
          (checkpoint) => checkpoint.id === parentCheckpointId,
        )
      : undefined;
    entries.unshift({
      attempt: current,
      inheritedCheckpoint:
        parent && isPublishedCheckpoint(parent) ? parent : undefined,
    });
    current = parent
      ? data.attempts.find((candidate) => candidate.id === parent.attemptId)
      : undefined;
  }

  return entries;
}

export function createFork(
  data: DemoData,
  checkpointId: string,
  nextTask: string,
  child: Omit<Attempt, "parentCheckpointId" | "nextTask">,
): ForkResult {
  const task = nextTask.trim();
  if (task.length === 0) return { kind: "rejected", reason: "task-required" };

  const checkpoint = data.checkpoints.find(
    (candidate) => candidate.id === checkpointId,
  );
  if (!checkpoint || !isPublishedCheckpoint(checkpoint)) {
    return { kind: "rejected", reason: "checkpoint-not-published" };
  }

  return {
    kind: "created",
    attempt: {
      ...child,
      parentCheckpointId: checkpoint.id,
      nextTask: task,
    },
    inherited: checkpoint,
  };
}

export type IssueStatus = "open" | "active" | "review" | "done";
export type Priority = "urgent" | "high" | "medium" | "low";
export type CheckState = "passed" | "failed" | "stale" | "not-run";

export interface Repository {
  id: string;
  name: string;
  owner: string;
  accent: string;
}

export interface Contributor {
  id: string;
  name: string;
  initials: string;
}

export interface Issue {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description: string;
  acceptanceCriteria: readonly string[];
  labels: readonly string[];
  priority: Priority;
  assigneeId: string;
  createdAt: string;
}

export interface Attempt {
  id: string;
  issueId: string;
  title: string;
  contributorId: string;
  createdAt: string;
  parentCheckpointId?: string;
  nextTask?: string;
}

export interface Run {
  id: string;
  attemptId: string;
  outcome: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  lastUploadAt: string;
  connected: boolean;
}

export interface CheckResult {
  id: string;
  name: string;
  state: CheckState;
  detail: string;
}

export interface Handoff {
  goal: string;
  constraints: readonly string[];
  decisions: readonly string[];
  failedApproaches: readonly string[];
  checks: readonly CheckResult[];
  nextAction: string;
  changedFiles: readonly string[];
}

interface CheckpointBase {
  id: string;
  attemptId: string;
  ordinal: number;
}

export interface PendingCheckpoint extends CheckpointBase {
  kind: "pending";
  startedAt: string;
}

export interface FailedCheckpoint extends CheckpointBase {
  kind: "failed";
  failedAt: string;
  reason: string;
}

export interface PublishedCheckpoint extends CheckpointBase {
  kind: "published";
  publishedAt: string;
  commitSha: string;
  contextHash: string;
  eventWatermark: number;
  handoff: Handoff;
}

export type Checkpoint =
  PendingCheckpoint | FailedCheckpoint | PublishedCheckpoint;

export interface ExportRecord {
  id: string;
  checkpointId: string;
  draftPullRequestUrl: string;
}

export interface DemoData {
  repositories: readonly Repository[];
  contributors: readonly Contributor[];
  issues: readonly Issue[];
  attempts: readonly Attempt[];
  runs: readonly Run[];
  checkpoints: readonly Checkpoint[];
  exports: readonly ExportRecord[];
}

export interface IssueSummary {
  issue: Issue;
  status: IssueStatus;
  attemptCount: number;
  contributor: Contributor | undefined;
}

export interface LineageEntry {
  attempt: Attempt;
  inheritedCheckpoint: PublishedCheckpoint | undefined;
}

export type ForkResult =
  | { kind: "created"; attempt: Attempt; inherited: PublishedCheckpoint }
  | { kind: "rejected"; reason: "checkpoint-not-published" | "task-required" };

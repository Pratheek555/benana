import { LockKeyhole } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import {
  IssueExplorer,
  type WorkspaceView,
} from "../components/issue-explorer";
import { IssuePanel } from "../components/issue-panel";
import {
  WorkspaceDialogs,
  type WorkspaceDialog,
} from "../components/workspace-dialogs";
import {
  WorkspaceShell,
  type SidebarScope,
} from "../components/workspace-shell";
import { initialData } from "../demo/fixtures";
import type {
  Attempt,
  DemoData,
  Issue,
  IssueStatus,
  PublishedCheckpoint,
} from "../domain/types";
import {
  attemptsForIssue,
  createFork,
  filterIssues,
  isPublishedCheckpoint,
  lineageForAttempt,
  summarizeIssues,
} from "../domain/workspace";

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function RepositoryWorkspace() {
  const params = useParams();
  const navigate = useNavigate();
  const repositoryId = params.repositoryId ?? "benana";
  const [data, setData] = useState<DemoData>(initialData);
  const [view, setView] = useState<WorkspaceView>("board");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<IssueStatus | "all">("all");
  const [scope, setScope] = useState<SidebarScope>("all");
  const [dialog, setDialog] = useState<WorkspaceDialog>({ kind: "closed" });
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const issueReturnFocusRef = useRef<HTMLElement | null>(null);

  const repository = data.repositories.find((item) => item.id === repositoryId);
  const allSummaries = useMemo(
    () => summarizeIssues(data, repositoryId),
    [data, repositoryId],
  );
  const scopedSummaries = useMemo(() => {
    if (scope === "mine") {
      const myIssueIds = new Set(
        data.attempts
          .filter((attempt) => attempt.contributorId === "prath")
          .map((attempt) => attempt.issueId),
      );
      return allSummaries.filter((summary) => myIssueIds.has(summary.issue.id));
    }
    if (scope === "checkpoints") {
      const checkpointAttemptIds = new Set(
        data.checkpoints
          .filter(isPublishedCheckpoint)
          .map((checkpoint) => checkpoint.attemptId),
      );
      const issueIds = new Set(
        data.attempts
          .filter((attempt) => checkpointAttemptIds.has(attempt.id))
          .map((attempt) => attempt.issueId),
      );
      return allSummaries.filter((summary) => issueIds.has(summary.issue.id));
    }
    return allSummaries;
  }, [allSummaries, data.attempts, data.checkpoints, scope]);
  const summaries = useMemo(
    () => filterIssues(scopedSummaries, query, status),
    [query, scopedSummaries, status],
  );
  const hasActiveFilter = query.trim().length > 0 || status !== "all";
  const scopeIssueNoun = scopedSummaries.length === 1 ? "issue" : "issues";
  const scopeDescription =
    scope === "all"
      ? "in this repository"
      : scope === "mine"
        ? "with my attempts"
        : "with checkpoints";

  const selectedIssue = data.issues.find(
    (issue) =>
      issue.id === params.issueId && issue.repositoryId === repositoryId,
  );
  const issueAttempts = selectedIssue
    ? attemptsForIssue(selectedIssue.id, data)
    : [];
  const selectedAttempt =
    issueAttempts.find((attempt) => attempt.id === params.attemptId) ??
    issueAttempts[0];
  const selectedContributor = selectedAttempt
    ? data.contributors.find(
        (person) => person.id === selectedAttempt.contributorId,
      )
    : undefined;
  const selectedRun = selectedAttempt
    ? data.runs.find((run) => run.attemptId === selectedAttempt.id)
    : undefined;
  const selectedCheckpoint = selectedAttempt
    ? data.checkpoints
        .filter(isPublishedCheckpoint)
        .filter((checkpoint) => checkpoint.attemptId === selectedAttempt.id)
        .at(-1)
    : undefined;
  const inheritedCheckpoint = selectedAttempt?.parentCheckpointId
    ? data.checkpoints.find(
        (checkpoint) =>
          checkpoint.id === selectedAttempt.parentCheckpointId &&
          isPublishedCheckpoint(checkpoint),
      )
    : undefined;
  const lineage = selectedAttempt
    ? lineageForAttempt(selectedAttempt, data)
    : [];

  useLayoutEffect(() => {
    if (params.issueId) return;
    const previous = issueReturnFocusRef.current;
    if (previous?.isConnected) previous.focus();
  }, [params.issueId]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        dialog.kind !== "closed" ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key.toLocaleLowerCase() === "c") {
        event.preventDefault();
        const active = document.activeElement;
        dialogReturnFocusRef.current =
          active instanceof HTMLElement && active !== document.body
            ? active
            : null;
        setDialog({ kind: "create-issue" });
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [dialog.kind]);

  if (!repository) return <Navigate replace to="/demo/repositories/benana" />;

  function repositoryPath(nextRepositoryId = repositoryId) {
    return `/demo/repositories/${nextRepositoryId}`;
  }

  function openDialog(
    nextDialog: Exclude<WorkspaceDialog, { kind: "closed" }>,
    trigger: HTMLElement,
  ) {
    dialogReturnFocusRef.current = trigger;
    setDialog(nextDialog);
  }

  function closeDialog() {
    setDialog({ kind: "closed" });
  }

  function restoreDialogFocus() {
    const previous = dialogReturnFocusRef.current;
    if (previous?.isConnected) {
      previous.focus();
      return;
    }
    const selected = document.querySelector(
      '.attempt-tabs button[data-active="true"]',
    );
    if (selected instanceof HTMLElement) selected.focus();
    else searchRef.current?.focus();
  }

  function openIssue(issueId: string, trigger: HTMLButtonElement) {
    issueReturnFocusRef.current = trigger;
    const firstAttempt = data.attempts.find(
      (attempt) => attempt.issueId === issueId,
    );
    navigate(
      firstAttempt
        ? `${repositoryPath()}/issues/${issueId}/attempts/${firstAttempt.id}`
        : `${repositoryPath()}/issues/${issueId}`,
    );
  }

  function openAttempt(attemptId: string) {
    if (!selectedIssue) return;
    navigate(
      `${repositoryPath()}/issues/${selectedIssue.id}/attempts/${attemptId}`,
    );
  }

  function closeIssue() {
    if (!issueReturnFocusRef.current?.isConnected)
      issueReturnFocusRef.current = searchRef.current;
    navigate(repositoryPath());
  }

  function createIssue(title: string, description: string) {
    const cleanTitle = title.trim();
    if (!cleanTitle) return false;
    const nextNumber =
      data.issues.reduce(
        (highest, issue) => Math.max(highest, issue.number),
        0,
      ) + 1;
    const issue: Issue = {
      id: `issue-local-${nextNumber}`,
      repositoryId,
      number: nextNumber,
      title: cleanTitle,
      description: description.trim() || "No description added.",
      acceptanceCriteria: ["Define acceptance criteria before implementation."],
      labels: ["local"],
      priority: "medium",
      assigneeId: "prath",
      createdAt: new Date().toISOString(),
    };
    setData((current) => ({ ...current, issues: [...current.issues, issue] }));
    navigate(`${repositoryPath()}/issues/${issue.id}`);
    return true;
  }

  function createChildAttempt(
    checkpoint: PublishedCheckpoint,
    nextTask: string,
  ) {
    const parent = data.attempts.find(
      (attempt) => attempt.id === checkpoint.attemptId,
    );
    if (!parent) return;
    const sequence = data.attempts.length + 205;
    const child: Omit<Attempt, "parentCheckpointId" | "nextTask"> = {
      id: `att-local-${sequence}`,
      issueId: parent.issueId,
      title: nextTask.trim(),
      contributorId: "prath",
      createdAt: new Date().toISOString(),
    };
    const result = createFork(data, checkpoint.id, nextTask, child);
    if (result.kind === "rejected") return;
    setData((current) => ({
      ...current,
      attempts: [...current.attempts, result.attempt],
    }));
    navigate(
      `${repositoryPath()}/issues/${parent.issueId}/attempts/${result.attempt.id}`,
    );
    setDialog({
      kind: "fork-result",
      attemptId: result.attempt.id,
      checkpoint,
      command: `benana checkout ${result.attempt.id}`,
    });
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("benana-theme", nextTheme);
    setTheme(nextTheme);
  }

  return (
    <WorkspaceShell
      repositories={data.repositories}
      repositoryId={repositoryId}
      scope={scope}
      theme={theme}
      onRepositoryChange={(nextId) => navigate(repositoryPath(nextId))}
      onScopeChange={setScope}
      onThemeChange={toggleTheme}
    >
      <div
        className="workspace-content"
        data-panel-open={Boolean(selectedIssue)}
      >
        <div className="workspace-main">
          <header className="workspace-header">
            <div className="repository-title">
              <div
                className="repo-logo"
                style={{ background: repository.accent }}
              >
                {repository.name.slice(0, 1).toLocaleUpperCase()}
              </div>
              <div>
                <span>{repository.owner}</span>
                <h1>{repository.name}</h1>
              </div>
            </div>
            <div className="header-actions">
              <span>
                <LockKeyhole size={13} /> Private
              </span>
            </div>
          </header>
          <div className="view-title">
            <div>
              <h2>
                {scope === "all"
                  ? "All issues"
                  : scope === "mine"
                    ? "My attempts"
                    : "Checkpoints"}
              </h2>
              <p role="status">
                {hasActiveFilter
                  ? `Showing ${summaries.length} of ${scopedSummaries.length} ${scopeIssueNoun}`
                  : `${scopedSummaries.length} ${scopeIssueNoun} ${scopeDescription}`}
              </p>
            </div>
          </div>
          <IssueExplorer
            summaries={summaries}
            selectedIssueId={selectedIssue?.id}
            query={query}
            status={status}
            view={view}
            searchRef={searchRef}
            onQueryChange={setQuery}
            onStatusChange={setStatus}
            onViewChange={setView}
            onOpenIssue={openIssue}
            onNewIssue={(trigger) =>
              openDialog({ kind: "create-issue" }, trigger)
            }
          />
        </div>
        {selectedIssue && (
          <IssuePanel
            issue={selectedIssue}
            attempts={issueAttempts}
            selectedAttempt={selectedAttempt}
            contributor={selectedContributor}
            run={selectedRun}
            checkpoint={selectedCheckpoint}
            inheritedCheckpoint={
              inheritedCheckpoint && isPublishedCheckpoint(inheritedCheckpoint)
                ? inheritedCheckpoint
                : undefined
            }
            lineage={lineage}
            onClose={closeIssue}
            onSelectAttempt={openAttempt}
            onFork={(checkpointId, trigger) => {
              const checkpoint = data.checkpoints.find(
                (candidate) => candidate.id === checkpointId,
              );
              if (checkpoint && isPublishedCheckpoint(checkpoint))
                openDialog({ kind: "fork", checkpoint }, trigger);
            }}
          />
        )}
      </div>
      <WorkspaceDialogs
        state={dialog}
        onClose={closeDialog}
        onRestoreFocus={restoreDialogFocus}
        onCreateIssue={createIssue}
        onCreateFork={createChildAttempt}
      />
    </WorkspaceShell>
  );
}

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsUp,
  Circle,
  Columns3,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import type { IssueStatus, IssueSummary, Priority } from "../domain/types";
import { statusOrder } from "../domain/workspace";

export type WorkspaceView = "board" | "list";

interface IssueExplorerProps {
  summaries: readonly IssueSummary[];
  selectedIssueId: string | undefined;
  query: string;
  status: IssueStatus | "all";
  view: WorkspaceView;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: IssueStatus | "all") => void;
  onViewChange: (view: WorkspaceView) => void;
  onOpenIssue: (issueId: string, trigger: HTMLButtonElement) => void;
  onNewIssue: (trigger: HTMLButtonElement) => void;
}

const statusLabels: Record<IssueStatus, string> = {
  open: "Open",
  active: "Active",
  review: "Review",
  done: "Done",
};

function PriorityIcon({ priority }: { priority: Priority }) {
  const props = { size: 14, "aria-label": `${priority} priority` };
  if (priority === "urgent") return <ChevronsUp {...props} />;
  if (priority === "high") return <ArrowUp {...props} />;
  if (priority === "low") return <ArrowDown {...props} />;
  return <Circle {...props} />;
}

function IssueCard({
  summary,
  selected,
  onOpen,
}: {
  summary: IssueSummary;
  selected: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const labels = summary.issue.labels.filter((label) => label.trim());
  const attemptLabel = `${summary.attemptCount} ${summary.attemptCount === 1 ? "attempt" : "attempts"}`;

  return (
    <button
      className="issue-card"
      type="button"
      aria-current={selected ? true : undefined}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span className="issue-card-meta">
        <span className="issue-card-identity">
          <span>BEN-{summary.issue.number}</span>
          <PriorityIcon priority={summary.issue.priority} />
        </span>
        <span className="attempt-count" title={attemptLabel}>
          <UsersRound size={13} aria-hidden="true" />
          <span>{summary.attemptCount}</span>
          <span className="sr-only">
            {summary.attemptCount === 1 ? "attempt" : "attempts"}
          </span>
        </span>
      </span>
      <strong>{summary.issue.title}</strong>
      <span className="issue-card-footer">
        <span className="issue-labels">
          {labels.map((label) => (
            <span className="label" key={label}>
              {label}
            </span>
          ))}
        </span>
        <span className="avatar small" title={summary.contributor?.name}>
          <span aria-hidden="true">{summary.contributor?.initials ?? "?"}</span>
          <span className="sr-only">
            {summary.contributor?.name ?? "Unknown contributor"}
          </span>
        </span>
      </span>
    </button>
  );
}

export function IssueExplorer({
  summaries,
  selectedIssueId,
  query,
  status,
  view,
  searchRef,
  onQueryChange,
  onStatusChange,
  onViewChange,
  onOpenIssue,
  onNewIssue,
}: IssueExplorerProps) {
  const groups = statusOrder.map((groupStatus) => ({
    status: groupStatus,
    issues: summaries.filter((summary) => summary.status === groupStatus),
  }));

  return (
    <section className="explorer">
      <div className="toolbar">
        <div className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            aria-label="Search issues"
            placeholder="Search issues..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => onQueryChange("")}
            >
              <X size={14} />
            </button>
          )}
          <kbd>/</kbd>
        </div>
        <label className="filter-control">
          <SlidersHorizontal size={14} />
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "all") onStatusChange(value);
              if (
                value === "open" ||
                value === "active" ||
                value === "review" ||
                value === "done"
              ) {
                onStatusChange(value);
              }
            }}
          >
            <option value="all">All statuses</option>
            {statusOrder.map((item) => (
              <option key={item} value={item}>
                {statusLabels[item]}
              </option>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <div className="segmented-control" aria-label="Issue view">
          <button
            type="button"
            data-active={view === "board"}
            aria-pressed={view === "board"}
            onClick={() => onViewChange("board")}
            aria-label="Board view"
            title="Board view"
          >
            <Columns3 size={15} />
          </button>
          <button
            type="button"
            data-active={view === "list"}
            aria-pressed={view === "list"}
            onClick={() => onViewChange("list")}
            aria-label="List view"
            title="List view"
          >
            <List size={15} />
          </button>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={(event) => onNewIssue(event.currentTarget)}
        >
          <Plus size={15} /> New issue <kbd>C</kbd>
        </button>
      </div>

      {summaries.length === 0 ? (
        <div className="empty-state">
          <Search size={20} />
          <strong>No issues found</strong>
          <span>Try another search or status filter.</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onQueryChange("");
              onStatusChange("all");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : view === "board" ? (
        <div className="board-scroll">
          <div className="board">
            {groups.map((group) => (
              <section className="board-column" key={group.status}>
                <header>
                  <span className={`status-symbol ${group.status}`} />{" "}
                  <strong>{statusLabels[group.status]}</strong>
                  <span>{group.issues.length}</span>
                </header>
                <div className="card-stack">
                  {group.issues.map((summary) => (
                    <IssueCard
                      key={summary.issue.id}
                      summary={summary}
                      selected={summary.issue.id === selectedIssueId}
                      onOpen={(trigger) =>
                        onOpenIssue(summary.issue.id, trigger)
                      }
                    />
                  ))}
                  {group.issues.length === 0 && (
                    <div className="column-empty">No matching issues</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="issue-list">
          {groups
            .filter((group) => group.issues.length > 0)
            .map((group) => (
              <section className="issue-list-group" key={group.status}>
                <header>
                  <span className={`status-symbol ${group.status}`} />
                  <strong>{statusLabels[group.status]}</strong>
                  <span>{group.issues.length}</span>
                </header>
                {group.issues.map((summary) => {
                  const label = summary.issue.labels.find((item) =>
                    item.trim(),
                  );
                  const attemptLabel = `${summary.attemptCount} ${summary.attemptCount === 1 ? "attempt" : "attempts"}`;
                  return (
                    <button
                      type="button"
                      className="issue-list-row"
                      key={summary.issue.id}
                      aria-current={
                        summary.issue.id === selectedIssueId ? true : undefined
                      }
                      onClick={(event) =>
                        onOpenIssue(summary.issue.id, event.currentTarget)
                      }
                    >
                      <span className="issue-key">
                        BEN-{summary.issue.number}
                      </span>
                      <strong>{summary.issue.title}</strong>
                      {label && (
                        <span className="label list-label">{label}</span>
                      )}
                      <PriorityIcon priority={summary.issue.priority} />
                      <span
                        className="avatar small"
                        title={summary.contributor?.name}
                      >
                        <span aria-hidden="true">
                          {summary.contributor?.initials ?? "?"}
                        </span>
                        <span className="sr-only">
                          {summary.contributor?.name ?? "Unknown contributor"}
                        </span>
                      </span>
                      <span className="attempt-count" title={attemptLabel}>
                        <UsersRound size={13} aria-hidden="true" />
                        <span>{summary.attemptCount}</span>
                        <span className="sr-only">
                          {summary.attemptCount === 1 ? "attempt" : "attempts"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
        </div>
      )}
    </section>
  );
}

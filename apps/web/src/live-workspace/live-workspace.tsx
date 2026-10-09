import {
  issuePageSchema,
  issueSchema,
  type AccessibleRepository,
  type GithubIssue,
} from "@benana/contracts";
import {
  ExternalLink,
  Grid2X2,
  List,
  LockKeyhole,
  Globe2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { ApiFailure, api } from "./api";
import {
  completeIssueRequest,
  type IssueCollectionState,
  type IssueDetailState,
  type IssueRequest,
} from "./issue-state";

type GithubState = "open" | "closed" | "all";
type WorkspaceView = "board" | "list";

export function LiveWorkspace({
  repository,
  issueNumber,
  onExpired,
}: {
  repository: AccessibleRepository;
  issueNumber: string | undefined;
  onExpired: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [collection, setCollection] = useState<IssueCollectionState>({
    kind: "loading",
    records: [],
    request: { page: 1, mode: "replace" },
  });
  const [detail, setDetail] = useState<IssueDetailState>({ kind: "closed" });
  const [githubState, setGithubState] = useState<GithubState>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<WorkspaceView>("board");
  const [detailRevision, setDetailRevision] = useState(0);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const listAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasIssueOpen = useRef(false);

  const load = useCallback(
    async (request: IssueRequest) => {
      const currentGeneration = ++generation.current;
      listAbort.current?.abort();
      const controller = new AbortController();
      listAbort.current = controller;
      setCollection((current) => ({
        kind: "loading",
        records: request.mode === "append" ? current.records : [],
        request,
      }));
      try {
        const result = await api(
          `/api/v1/repositories/${repository.id}/issues?state=${githubState}&page=${request.page}`,
          issuePageSchema,
          { signal: controller.signal },
        );
        if (
          controller.signal.aborted ||
          currentGeneration !== generation.current
        )
          return;
        setCollection((current) =>
          completeIssueRequest(
            current,
            request,
            result.issues,
            result.nextPage,
          ),
        );
      } catch (error) {
        if (
          controller.signal.aborted ||
          currentGeneration !== generation.current
        )
          return;
        if (error instanceof ApiFailure && error.status === 401)
          void onExpired();
        setCollection((current) => ({
          kind: "error",
          records: current.records,
          nextPage: request.mode === "append" ? request.page : null,
          failed: request,
          message:
            error instanceof Error ? error.message : "Could not load issues.",
        }));
      }
    },
    [githubState, onExpired, repository.id],
  );

  useEffect(() => {
    void load({ page: 1, mode: "replace" });
    return () => listAbort.current?.abort();
  }, [load]);

  const selectedNumber = Number(issueNumber);
  const loadedIssue = collection.records.find(
    (issue) => issue.number === selectedNumber,
  );

  useEffect(() => {
    const requestGeneration = ++detailGeneration.current;
    detailAbort.current?.abort();
    const number = Number(issueNumber);
    if (!issueNumber) {
      setDetail({ kind: "closed" });
      return;
    }
    const key = `${repository.id}:${number}`;
    if (
      !/^\d+$/.test(issueNumber) ||
      !Number.isSafeInteger(number) ||
      number < 1
    ) {
      setDetail({ kind: "missing", key });
      return;
    }
    if (loadedIssue) {
      setDetail({ kind: "ready", key, issue: loadedIssue });
      return;
    }
    const controller = new AbortController();
    detailAbort.current = controller;
    setDetail({ kind: "loading", key });
    void api(
      `/api/v1/repositories/${repository.id}/issues/${number}`,
      issueSchema,
      { signal: controller.signal },
    )
      .then((issue) => {
        if (
          !controller.signal.aborted &&
          requestGeneration === detailGeneration.current
        )
          setDetail({ kind: "ready", key, issue });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          requestGeneration !== detailGeneration.current
        )
          return;
        if (error instanceof ApiFailure && error.status === 401)
          void onExpired();
        setDetail(
          error instanceof ApiFailure && error.code === "ISSUE_NOT_FOUND"
            ? { kind: "missing", key }
            : {
                kind: "error",
                key,
                message:
                  error instanceof Error
                    ? error.message
                    : "Could not load this issue.",
              },
        );
      });
    return () => controller.abort();
  }, [loadedIssue, issueNumber, detailRevision, onExpired, repository.id]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (event.key === "Escape" && issueNumber) closeIssue();
      if (
        event.key === "/" &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement
        )
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useLayoutEffect(() => {
    if (issueNumber) {
      wasIssueOpen.current = true;
      return;
    }
    if (!wasIssueOpen.current) return;
    wasIssueOpen.current = false;
    const previous = returnFocusRef.current;
    if (previous?.isConnected) previous.focus();
    else searchRef.current?.focus();
  }, [issueNumber]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return collection.records;
    return collection.records.filter(
      (issue) =>
        issue.title.toLowerCase().includes(needle) ||
        String(issue.number).includes(needle) ||
        issue.labels.some((label) => label.name.toLowerCase().includes(needle)),
    );
  }, [collection.records, query]);
  const open = shown.filter((issue) => issue.state === "open");
  const done = shown.filter((issue) => issue.state === "closed");
  const nextPage =
    collection.kind === "ready" || collection.kind === "error"
      ? collection.nextPage
      : null;
  const busy = collection.kind === "loading";

  function openIssue(issue: GithubIssue, trigger: HTMLButtonElement) {
    returnFocusRef.current = trigger;
    navigate(`/repositories/${repository.id}/issues/${issue.number}`);
  }
  function closeIssue() {
    navigate(`/repositories/${repository.id}`);
  }

  return (
    <div
      className="workspace-content live-workspace"
      data-panel-open={detail.kind !== "closed"}
    >
      <div className="workspace-main">
        <header className="workspace-header">
          <div className="repository-title">
            <div className="repo-logo">
              {repository.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <span>{repository.owner}</span>
              <h1>{repository.name}</h1>
            </div>
          </div>
          <div className="header-actions">
            <span>
              {repository.private ? (
                <LockKeyhole size={13} />
              ) : (
                <Globe2 size={13} />
              )}
              {repository.private ? "Private" : "Public"}
            </span>
            <a
              className="secondary-button"
              href={`${repository.htmlUrl}/issues/new`}
              target="_blank"
              rel="noreferrer"
            >
              <Plus size={14} /> New issue
            </a>
          </div>
        </header>
        <div className="view-title">
          <div>
            <h2>All issues</h2>
            <p role="status">
              {collection.records.length} loaded{" "}
              {collection.records.length === 1 ? "issue" : "issues"}
              {query ? `, ${shown.length} matching locally` : ""}
            </p>
          </div>
        </div>
        <section className="explorer">
          <div className="toolbar live-toolbar">
            <label className="search-field">
              <Search size={14} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search loaded title, number, or label"
                aria-label="Search loaded issues"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
              <kbd>/</kbd>
            </label>
            <select
              value={githubState}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "all" || value === "open" || value === "closed")
                  setGithubState(value);
              }}
              aria-label="GitHub issue state"
            >
              <option value="all">All states</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <div className="segmented-control" aria-label="Issue view">
              <button
                data-active={view === "board"}
                onClick={() => setView("board")}
                aria-label="Board view"
                aria-pressed={view === "board"}
              >
                <Grid2X2 size={14} />
              </button>
              <button
                data-active={view === "list"}
                onClick={() => setView("list")}
                aria-label="List view"
                aria-pressed={view === "list"}
              >
                <List size={14} />
              </button>
            </div>
          </div>
          {collection.kind === "error" && (
            <div className="live-error">
              {collection.message}{" "}
              <button onClick={() => void load(collection.failed)}>
                Retry
              </button>
            </div>
          )}
          {view === "board" ? (
            <div className="board-scroll">
              <div className="board live-board">
                <LiveColumn
                  title="Open"
                  issues={open}
                  selected={
                    detail.kind === "ready" ? detail.issue.number : undefined
                  }
                  onOpen={openIssue}
                />
                <LiveColumn
                  title="Done"
                  issues={done}
                  selected={
                    detail.kind === "ready" ? detail.issue.number : undefined
                  }
                  onOpen={openIssue}
                />
              </div>
            </div>
          ) : (
            <div className="issue-list">
              <LiveList
                title="Open"
                issues={open}
                selected={
                  detail.kind === "ready" ? detail.issue.number : undefined
                }
                onOpen={openIssue}
              />
              <LiveList
                title="Done"
                issues={done}
                selected={
                  detail.kind === "ready" ? detail.issue.number : undefined
                }
                onOpen={openIssue}
              />
            </div>
          )}
          {!busy && !shown.length && collection.kind !== "error" && (
            <div className="empty-state">
              <strong>No loaded issues match</strong>
              <span>
                {query
                  ? "Clear the local search or load another page."
                  : nextPage
                    ? "This GitHub page contained only pull requests."
                    : "Try another GitHub state."}
              </span>
              {query && (
                <button
                  className="secondary-button"
                  onClick={() => setQuery("")}
                >
                  Clear local search
                </button>
              )}
            </div>
          )}
          <div className="live-pagination">
            {busy && <span>Loading issues…</span>}
            {nextPage && !busy && (
              <button
                className="secondary-button"
                onClick={() => void load({ page: nextPage, mode: "append" })}
              >
                Load more
              </button>
            )}
          </div>
        </section>
      </div>
      {detail.kind !== "closed" && (
        <LiveDetail
          state={detail}
          repository={repository}
          onClose={closeIssue}
          onRetry={() => setDetailRevision((revision) => revision + 1)}
        />
      )}
    </div>
  );
}

function LiveColumn({
  title,
  issues,
  selected,
  onOpen,
}: {
  title: string;
  issues: GithubIssue[];
  selected: number | undefined;
  onOpen: (issue: GithubIssue, trigger: HTMLButtonElement) => void;
}) {
  return (
    <section className="board-column">
      <header>
        <span
          className={title === "Done" ? "status-symbol done" : "status-symbol"}
        />
        <strong>{title}</strong>
        <span>{issues.length}</span>
      </header>
      <div className="card-stack">
        {issues.map((issue) => (
          <button
            className="issue-card"
            aria-current={selected === issue.number}
            key={issue.id}
            onClick={(event) => onOpen(issue, event.currentTarget)}
          >
            <div className="issue-card-meta">
              <span>#{issue.number}</span>
              <span>{formatDate(issue.updatedAt)}</span>
            </div>
            <strong>{issue.title}</strong>
            <Labels issue={issue} />
            <Assignees issue={issue} />
          </button>
        ))}
        {!issues.length && (
          <div className="column-empty">
            No loaded {title.toLowerCase()} issues
          </div>
        )}
      </div>
    </section>
  );
}

function LiveList({
  title,
  issues,
  selected,
  onOpen,
}: {
  title: string;
  issues: GithubIssue[];
  selected: number | undefined;
  onOpen: (issue: GithubIssue, trigger: HTMLButtonElement) => void;
}) {
  return (
    <section className="issue-list-group">
      <header>
        <span
          className={title === "Done" ? "status-symbol done" : "status-symbol"}
        />
        <strong>{title}</strong>
        <span>{issues.length}</span>
      </header>
      {issues.map((issue) => (
        <button
          className="issue-list-row live-list-row"
          aria-current={selected === issue.number}
          key={issue.id}
          onClick={(event) => onOpen(issue, event.currentTarget)}
        >
          <span className="issue-key">#{issue.number}</span>
          <strong>{issue.title}</strong>
          <Labels issue={issue} compact />
          <span>{formatDate(issue.updatedAt)}</span>
        </button>
      ))}
    </section>
  );
}

function Labels({
  issue,
  compact = false,
}: {
  issue: GithubIssue;
  compact?: boolean;
}) {
  return (
    <div className="issue-labels">
      {(compact ? issue.labels.slice(0, 3) : issue.labels).map((label) => (
        <span
          className="label"
          style={{ borderColor: `#${label.color}` }}
          key={label.id}
        >
          {label.name}
        </span>
      ))}
    </div>
  );
}

function Assignees({ issue }: { issue: GithubIssue }) {
  if (!issue.assignees.length) return null;
  return (
    <div className="live-assignees">
      {issue.assignees.map((person) => (
        <img
          className="avatar"
          src={person.avatarUrl}
          alt={person.login}
          title={person.login}
          key={person.id}
        />
      ))}
    </div>
  );
}

function LiveDetail({
  state,
  repository,
  onClose,
  onRetry,
}: {
  state: Exclude<IssueDetailState, { kind: "closed" }>;
  repository: AccessibleRepository;
  onClose: () => void;
  onRetry: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [state.key]);
  return (
    <aside
      className="detail-panel live-detail"
      aria-label={
        state.kind === "ready"
          ? `Issue #${state.issue.number} details`
          : "Issue details"
      }
    >
      <div className="detail-topbar">
        <span>{repository.fullName}</span>
        <button
          ref={closeButtonRef}
          className="icon-button"
          onClick={onClose}
          aria-label="Close issue details"
        >
          <X size={16} />
        </button>
      </div>
      {state.kind === "loading" ? (
        <div className="panel-empty">
          <strong>Loading issue…</strong>
        </div>
      ) : state.kind === "missing" ? (
        <div className="panel-empty">
          <strong>Issue not found</strong>
          <span>It may have been removed or may be a pull request.</span>
        </div>
      ) : state.kind === "error" ? (
        <div className="panel-empty">
          <strong>Could not load issue</strong>
          <span>{state.message}</span>
          <button className="secondary-button" onClick={onRetry}>
            Retry issue
          </button>
        </div>
      ) : (
        <div className="detail-scroll">
          <div className="issue-heading">
            <div className="issue-heading-meta">
              <span>#{state.issue.number}</span>
              <span>{state.issue.state}</span>
              <span>Opened {formatDate(state.issue.createdAt)}</span>
              <span>Updated {formatDate(state.issue.updatedAt)}</span>
            </div>
            <h2>{state.issue.title}</h2>
            <Labels issue={state.issue} />
          </div>
          <section className="live-detail-section">
            <h3>Description</h3>
            <p className="issue-body">
              {state.issue.body || "No description provided."}
            </p>
          </section>
          <section className="live-detail-section">
            <h3>Assignees</h3>
            {state.issue.assignees.length ? (
              <ul>
                {state.issue.assignees.map((person) => (
                  <li key={person.id}>
                    <img className="avatar" src={person.avatarUrl} alt="" />
                    <a href={person.htmlUrl} target="_blank" rel="noreferrer">
                      @{person.login}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No assignees.</p>
            )}
          </section>
          <section className="live-detail-section">
            <h3>Benana attempts</h3>
            <p>No attempts have been recorded for this GitHub issue.</p>
          </section>
          <a
            className="live-github-link"
            href={state.issue.htmlUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open issue on GitHub <ExternalLink size={14} />
          </a>
        </div>
      )}
    </aside>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  Attempt,
  CheckResult,
  Contributor,
  Issue,
  LineageEntry,
  PublishedCheckpoint,
  Run,
} from "../domain/types";

type DetailTab = "overview" | "changes" | "checks" | "context";

interface IssuePanelProps {
  issue: Issue;
  attempts: readonly Attempt[];
  selectedAttempt: Attempt | undefined;
  contributor: Contributor | undefined;
  run: Run | undefined;
  checkpoint: PublishedCheckpoint | undefined;
  inheritedCheckpoint: PublishedCheckpoint | undefined;
  lineage: readonly LineageEntry[];
  onClose: () => void;
  onSelectAttempt: (attemptId: string) => void;
  onFork: (checkpointId: string, trigger: HTMLButtonElement) => void;
}

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "changes", label: "Changes" },
  { id: "checks", label: "Checks" },
  { id: "context", label: "Context" },
] satisfies ReadonlyArray<{ id: DetailTab; label: string }>;

function CheckIcon({ state }: Pick<CheckResult, "state">) {
  if (state === "passed") return <CheckCircle2 size={15} />;
  if (state === "failed") return <XCircle size={15} />;
  if (state === "stale") return <RotateCcw size={15} />;
  return <CircleDashed size={15} />;
}

function CompactDate({ value }: { value: string }) {
  const date = new Date(value);
  const fullDate = date.toLocaleString();
  return (
    <time dateTime={value} title={fullDate}>
      <span aria-hidden="true">
        {date.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          year:
            date.getFullYear() === new Date().getFullYear()
              ? undefined
              : "numeric",
        })}
      </span>
      <span className="sr-only">{fullDate}</span>
    </time>
  );
}

export function IssuePanel({
  issue,
  attempts,
  selectedAttempt,
  contributor,
  run,
  checkpoint,
  inheritedCheckpoint,
  lineage,
  onClose,
  onSelectAttempt,
  onFork,
}: IssuePanelProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const contextCheckpoint = checkpoint ?? inheritedCheckpoint;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (matchMedia("(max-width: 900px)").matches)
      closeButtonRef.current?.focus();
  }, [issue.id]);

  async function copyIdentity() {
    if (!checkpoint) return;
    try {
      await navigator.clipboard.writeText(
        `${checkpoint.commitSha} · ${checkpoint.contextHash}`,
      );
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <aside
      className="detail-panel"
      aria-label={`Issue BEN-${issue.number} details`}
    >
      <div className="detail-topbar">
        <span>BEN-{issue.number}</span>
        <button
          ref={closeButtonRef}
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close issue details"
          title="Close details"
        >
          <X size={16} />
        </button>
      </div>
      <div className="detail-scroll">
        <header className="issue-heading">
          <div className="issue-heading-meta">
            <span>BEN-{issue.number}</span>
            <span>{issue.priority} priority</span>
            {issue.labels
              .filter((label) => label.trim())
              .map((label) => (
                <span className="label" key={label}>
                  {label}
                </span>
              ))}
          </div>
          <h2>{issue.title}</h2>
          <p>{issue.description}</p>
        </header>

        <section className="always-criteria">
          <h3>Acceptance criteria</h3>
          <ul className="criteria-list">
            {issue.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>
                <CircleDashed size={14} />
                {criterion}
              </li>
            ))}
          </ul>
        </section>

        <section className="attempt-picker">
          <div className="section-heading">
            <span>Attempts</span>
            <span>{attempts.length}</span>
          </div>
          <div className="attempt-tabs">
            {attempts.map((attempt, index) => (
              <button
                type="button"
                key={attempt.id}
                data-active={attempt.id === selectedAttempt?.id}
                aria-pressed={attempt.id === selectedAttempt?.id}
                onClick={() => onSelectAttempt(attempt.id)}
              >
                <span>#{index + 1}</span>
                {attempt.title}
              </button>
            ))}
            {attempts.length === 0 && (
              <div className="muted-note">
                No attempts in this demo session.
              </div>
            )}
          </div>
        </section>

        {selectedAttempt ? (
          <>
            <div className="attempt-summary">
              <span className="avatar">{contributor?.initials ?? "?"}</span>
              <span>
                <strong>{contributor?.name ?? "Unknown contributor"}</strong>
                <small>{selectedAttempt.title}</small>
              </span>
              {run && (
                <span className={`run-state ${run.outcome}`}>
                  <span />
                  {run.outcome}
                </span>
              )}
            </div>
            <div className="freshness-row">
              <Clock3 size={14} />
              <span>
                {run
                  ? run.connected
                    ? "Connected · uploaded "
                    : "Last upload "
                  : "No run uploaded"}
                {run && <CompactDate value={run.lastUploadAt} />}
              </span>
            </div>
            <div
              className="detail-tabs"
              role="tablist"
              aria-label="Attempt details"
            >
              {tabs.map((item, index) => (
                <button
                  id={`attempt-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  aria-controls="attempt-detail-panel"
                  tabIndex={tab === item.id ? 0 : -1}
                  key={item.id}
                  data-active={tab === item.id}
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== "ArrowLeft" &&
                      event.key !== "ArrowRight" &&
                      event.key !== "Home" &&
                      event.key !== "End"
                    )
                      return;
                    event.preventDefault();
                    const offset = event.key === "ArrowRight" ? 1 : -1;
                    const nextIndex =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : (index + offset + tabs.length) % tabs.length;
                    const next = tabs[nextIndex];
                    if (!next) return;
                    setTab(next.id);
                    document.getElementById(`attempt-tab-${next.id}`)?.focus();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div
              id="attempt-detail-panel"
              role="tabpanel"
              aria-labelledby={`attempt-tab-${tab}`}
              tabIndex={0}
            >
              {tab === "overview" && (
                <div className="detail-section-stack">
                  <section>
                    <h3>Lineage</h3>
                    <div className="lineage">
                      {lineage.map((entry, index) => (
                        <div className="lineage-entry" key={entry.attempt.id}>
                          <GitBranch size={14} />
                          <span>
                            <strong>{entry.attempt.title}</strong>
                            <small>
                              {index === 0
                                ? "Root attempt"
                                : `Forked from ${entry.inheritedCheckpoint?.id ?? "checkpoint"}`}
                            </small>
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section>
                    <h3>Timeline</h3>
                    <div className="timeline-row">
                      <Clock3 size={14} />
                      <span>
                        <strong>Attempt created</strong>
                        <small>
                          <CompactDate value={selectedAttempt.createdAt} />
                        </small>
                      </span>
                    </div>
                    {run && (
                      <div className="timeline-row">
                        <CircleDashed size={14} />
                        <span>
                          <strong>Latest run {run.outcome}</strong>
                          <small>
                            Last upload <CompactDate value={run.lastUploadAt} />
                          </small>
                        </span>
                      </div>
                    )}
                    {checkpoint && (
                      <div className="timeline-row">
                        <CheckCircle2 size={14} />
                        <span>
                          <strong>
                            Checkpoint {checkpoint.ordinal} published
                          </strong>
                          <small>
                            <CompactDate value={checkpoint.publishedAt} />
                          </small>
                        </span>
                      </div>
                    )}
                  </section>
                  {checkpoint && (
                    <section className="checkpoint-card">
                      <div>
                        <span className="published-pill">Published</span>
                        <span>Checkpoint {checkpoint.ordinal}</span>
                      </div>
                      <strong>{checkpoint.handoff.goal}</strong>
                      <div className="identity-row">
                        <GitCommitHorizontal size={14} />
                        <code>{checkpoint.commitSha.slice(0, 8)}</code>
                        <code>{checkpoint.contextHash}</code>
                        <button
                          type="button"
                          onClick={copyIdentity}
                          aria-label="Copy checkpoint identity"
                          title="Copy identity"
                        >
                          {copyState === "copied" ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                      {copyState === "failed" && (
                        <div className="field-error">
                          Clipboard access failed. Copy the identity manually.
                        </div>
                      )}
                    </section>
                  )}
                  {!checkpoint && inheritedCheckpoint && (
                    <section className="checkpoint-card inherited-card">
                      <div>
                        <span className="published-pill">Inherited</span>
                        <span>
                          Parent checkpoint {inheritedCheckpoint.ordinal}
                        </span>
                      </div>
                      <strong>{inheritedCheckpoint.handoff.goal}</strong>
                      <div className="identity-row">
                        <GitCommitHorizontal size={14} />
                        <code>{inheritedCheckpoint.commitSha}</code>
                        <code>{inheritedCheckpoint.contextHash}</code>
                      </div>
                      <p className="muted-note">
                        The child starts from this exact code and context. Its
                        own run and checks have not started.
                      </p>
                    </section>
                  )}
                </div>
              )}

              {tab === "changes" && (
                <section className="tab-content">
                  <h3>Changed files</h3>
                  {checkpoint ? (
                    checkpoint.handoff.changedFiles.length ? (
                      checkpoint.handoff.changedFiles.map((file) => (
                        <div className="file-row" key={file}>
                          <span>M</span>
                          <code>{file}</code>
                        </div>
                      ))
                    ) : (
                      <p className="muted-note">
                        This checkpoint records no changed files.
                      </p>
                    )
                  ) : (
                    <p className="muted-note">
                      Publish a checkpoint to record changed files.
                    </p>
                  )}
                </section>
              )}

              {tab === "checks" && (
                <section className="tab-content">
                  <h3>Verification</h3>
                  {checkpoint ? (
                    checkpoint.handoff.checks.length ? (
                      checkpoint.handoff.checks.map((check) => (
                        <div
                          className={`check-row ${check.state}`}
                          key={check.id}
                        >
                          <CheckIcon state={check.state} />
                          <span>
                            <strong>{check.name}</strong>
                            <small>{check.detail}</small>
                          </span>
                          <em>{check.state.replace("-", " ")}</em>
                        </div>
                      ))
                    ) : (
                      <p className="muted-note">
                        No checks were recorded for this checkpoint.
                      </p>
                    )
                  ) : (
                    <p className="muted-note">
                      Publish a checkpoint to record verification results.
                    </p>
                  )}
                </section>
              )}

              {tab === "context" && (
                <div className="detail-section-stack">
                  <section>
                    <h3>
                      {checkpoint ? "Constraints" : "Inherited constraints"}
                    </h3>
                    {contextCheckpoint?.handoff.constraints.length ? (
                      contextCheckpoint.handoff.constraints.map(
                        (constraint) => (
                          <div className="context-row" key={constraint}>
                            <CircleDashed size={14} />
                            {constraint}
                          </div>
                        ),
                      )
                    ) : (
                      <p className="muted-note">No constraints recorded.</p>
                    )}
                  </section>
                  <section>
                    <h3>{checkpoint ? "Decisions" : "Inherited decisions"}</h3>
                    {contextCheckpoint?.handoff.decisions.length ? (
                      contextCheckpoint.handoff.decisions.map((decision) => (
                        <div className="context-row" key={decision}>
                          <CheckCircle2 size={14} />
                          {decision}
                        </div>
                      ))
                    ) : (
                      <p className="muted-note">No decisions recorded.</p>
                    )}
                  </section>
                  <section>
                    <h3>
                      {checkpoint
                        ? "Failed approaches"
                        : "Inherited failed approaches"}
                    </h3>
                    {contextCheckpoint?.handoff.failedApproaches.length ? (
                      contextCheckpoint.handoff.failedApproaches.map(
                        (failure) => (
                          <div className="context-row warning" key={failure}>
                            <AlertCircle size={14} />
                            {failure}
                          </div>
                        ),
                      )
                    ) : (
                      <p className="muted-note">
                        No failed approaches recorded.
                      </p>
                    )}
                  </section>
                  {contextCheckpoint && (
                    <section>
                      <h3>
                        {checkpoint ? "Next action" : "Inherited next action"}
                      </h3>
                      <p>{contextCheckpoint.handoff.nextAction}</p>
                    </section>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="panel-empty">
            <CircleDashed size={20} />
            <strong>No attempt selected</strong>
            <span>Choose an attempt to inspect its work.</span>
          </div>
        )}
      </div>
      <footer className="detail-footer">
        {checkpoint ? (
          <>
            <span className="footer-checkpoint">
              <GitCommitHorizontal size={15} aria-hidden="true" />
              <span>Checkpoint {checkpoint.ordinal}</span>
              <code title={checkpoint.commitSha}>
                {checkpoint.commitSha.slice(0, 8)}
              </code>
            </span>
            <button
              className="primary-button"
              type="button"
              onClick={(event) => onFork(checkpoint.id, event.currentTarget)}
            >
              <GitBranch size={15} /> Review and fork
            </button>
          </>
        ) : (
          <span>
            {selectedAttempt
              ? "Publish a checkpoint to review and fork."
              : "Select an attempt to inspect its work."}
          </span>
        )}
      </footer>
    </aside>
  );
}

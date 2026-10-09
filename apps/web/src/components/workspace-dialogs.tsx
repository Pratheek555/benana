import * as Dialog from "@radix-ui/react-dialog";
import { Check, Clipboard, GitBranch, Plus, X } from "lucide-react";
import { useState } from "react";
import type { PublishedCheckpoint } from "../domain/types";

export type WorkspaceDialog =
  | { kind: "closed" }
  | { kind: "create-issue" }
  | { kind: "fork"; checkpoint: PublishedCheckpoint }
  | {
      kind: "fork-result";
      attemptId: string;
      checkpoint: PublishedCheckpoint;
      command: string;
    };

interface WorkspaceDialogsProps {
  state: WorkspaceDialog;
  onClose: () => void;
  onRestoreFocus: () => void;
  onCreateIssue: (title: string, description: string) => boolean;
  onCreateFork: (checkpoint: PublishedCheckpoint, task: string) => void;
}

function DialogFrame({
  title,
  description,
  children,
  onClose,
  onRestoreFocus,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
        >
          <div className="dialog-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={16} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateIssueForm({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, description: string) => boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && title.trim().length === 0;

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (onCreate(title, description)) onClose();
        }}
      >
        <label className="field-label">
          Title
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? "title-error" : undefined}
            placeholder="What needs to change?"
          />
        </label>
        {invalid && (
          <span className="field-error" id="title-error">
            Enter an issue title.
          </span>
        )}
        <label className="field-label">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add useful context for the next contributor."
          />
        </label>
        <div className="dialog-note">
          This issue stays in the current demo session and resets on reload.
        </div>
        <div className="dialog-actions">
          <Dialog.Close className="secondary-button" type="button">
            Cancel
          </Dialog.Close>
          <button className="primary-button" type="submit">
            <Plus size={15} />
            Create issue
          </button>
        </div>
      </form>
    </>
  );
}

function ForkForm({
  checkpoint,
  onCreate,
}: {
  checkpoint: PublishedCheckpoint;
  onCreate: (checkpoint: PublishedCheckpoint, task: string) => void;
}) {
  const [task, setTask] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && task.trim().length === 0;

  return (
    <>
      <div className="fork-identity">
        <span>Published checkpoint</span>
        <code>{checkpoint.commitSha}</code>
        <code>{checkpoint.contextHash}</code>
      </div>
      <div className="inherited-context">
        <strong>{checkpoint.handoff.goal}</strong>
        <p>{checkpoint.handoff.nextAction}</p>
        <span>
          {checkpoint.handoff.constraints.length} constraints ·{" "}
          {checkpoint.handoff.decisions.length} decisions · watermark{" "}
          {checkpoint.eventWatermark}
        </span>
      </div>
      <details className="handoff-review">
        <summary>Review inherited context</summary>
        <div>
          <h3>Constraints</h3>
          {checkpoint.handoff.constraints.length ? (
            <ul>
              {checkpoint.handoff.constraints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>No constraints were recorded.</p>
          )}
          <h3>Decisions</h3>
          {checkpoint.handoff.decisions.length ? (
            <ul>
              {checkpoint.handoff.decisions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>No decisions were recorded.</p>
          )}
          <h3>Failed approaches</h3>
          {checkpoint.handoff.failedApproaches.length ? (
            <ul>
              {checkpoint.handoff.failedApproaches.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>No failed approaches were recorded.</p>
          )}
          <h3>Inherited checks</h3>
          {checkpoint.handoff.checks.length ? (
            <ul>
              {checkpoint.handoff.checks.map((check) => (
                <li key={check.id}>
                  {check.name} · {check.state.replace("-", " ")}
                </li>
              ))}
            </ul>
          ) : (
            <p>No inherited checks were recorded.</p>
          )}
        </div>
      </details>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (task.trim()) onCreate(checkpoint, task);
        }}
      >
        <label className="field-label">
          Next task
          <textarea
            autoFocus
            value={task}
            onChange={(event) => setTask(event.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? "task-error" : undefined}
            placeholder="Describe what the child attempt should do next."
          />
        </label>
        {invalid && (
          <span className="field-error" id="task-error">
            Enter a next task.
          </span>
        )}
        <div className="dialog-note">
          The inherited code and context stay unchanged.
        </div>
        <div className="dialog-actions">
          <Dialog.Close className="secondary-button" type="button">
            Cancel
          </Dialog.Close>
          <button className="primary-button" type="submit">
            <GitBranch size={15} />
            Create child attempt
          </button>
        </div>
      </form>
    </>
  );
}

function ForkResult({
  state,
  onClose,
}: {
  state: Extract<WorkspaceDialog, { kind: "fork-result" }>;
  onClose: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  return (
    <>
      <div className="success-mark">
        <Check size={20} />
      </div>
      <div className="result-grid">
        <span>Parent checkpoint</span>
        <code>{state.checkpoint.id}</code>
        <span>Inherited commit</span>
        <code>{state.checkpoint.commitSha}</code>
        <span>Inherited context</span>
        <code>{state.checkpoint.contextHash}</code>
      </div>
      <div className="command-box">
        <code>{state.command}</code>
        <button
          type="button"
          aria-label="Copy illustrative checkout command"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(state.command);
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
          }}
        >
          <Clipboard size={14} />
        </button>
      </div>
      <p className={`copy-feedback ${copyState}`}>
        {copyState === "copied"
          ? "Command copied."
          : copyState === "failed"
            ? "Could not access the clipboard. Copy the command manually."
            : "Illustrative command only. The browser does not run local commands."}
      </p>
      <div className="dialog-actions">
        <button
          className="primary-button"
          type="button"
          autoFocus
          onClick={onClose}
        >
          View attempt
        </button>
      </div>
    </>
  );
}

export function WorkspaceDialogs({
  state,
  onClose,
  onRestoreFocus,
  onCreateIssue,
  onCreateFork,
}: WorkspaceDialogsProps) {
  if (state.kind === "closed") return null;
  const title =
    state.kind === "create-issue"
      ? "Create issue"
      : state.kind === "fork"
        ? `Fork checkpoint ${state.checkpoint.ordinal}`
        : "Child attempt created";
  const description =
    state.kind === "create-issue"
      ? "Add an issue to this local demo session. Reloading resets it."
      : state.kind === "fork"
        ? "Review the inherited identity and set the next task."
        : "The attempt exists in this local session and inherits the reviewed checkpoint.";

  return (
    <DialogFrame
      title={title}
      description={description}
      onClose={onClose}
      onRestoreFocus={onRestoreFocus}
    >
      {state.kind === "create-issue" ? (
        <CreateIssueForm onClose={onClose} onCreate={onCreateIssue} />
      ) : state.kind === "fork" ? (
        <ForkForm checkpoint={state.checkpoint} onCreate={onCreateFork} />
      ) : (
        <ForkResult state={state} onClose={onClose} />
      )}
    </DialogFrame>
  );
}

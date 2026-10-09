import { useCallback, useEffect, useRef, useState } from "react";
import { Github, LogOut, Moon, Search, Settings, Sun } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import {
  authSessionSchema,
  repositoryListSchema,
  selectedRepositoryListSchema,
  type AccessibleRepository,
  type AuthSession,
} from "@benana/contracts";
import { WorkspaceFrame } from "../components/workspace-shell";
import { LiveWorkspace } from "../live-workspace/live-workspace";
import { ApiFailure, api } from "../live-workspace/api";

const SETUP_KEY = "benana_github_setup";

function githubSetupReturned() {
  const returned =
    new URLSearchParams(window.location.search).get("github_setup") ===
    "complete";
  if (returned) sessionStorage.setItem(SETUP_KEY, "complete");
  return returned || sessionStorage.getItem(SETUP_KEY) === "complete";
}

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function Status({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="live-status">
      <div className="brand-mark">B</div>
      <h1>{title}</h1>
      <p>{detail}</p>
      {action && (
        <button className="live-primary" onClick={action.run}>
          {action.label}
        </button>
      )}
      <a href="/demo">Explore the fixture demo</a>
    </div>
  );
}

export function LiveApp() {
  const params = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [available, setAvailable] = useState<AccessibleRepository[]>([]);
  const [selected, setSelected] = useState<AccessibleRepository[]>([]);
  const [installUrl, setInstallUrl] = useState("");
  const [view, setView] = useState<"issues" | "manage">("issues");
  const [setupComplete] = useState(githubSetupReturned);
  const setupReturnPending = useRef(setupComplete);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      const current = await api("/api/v1/auth/session", authSessionSchema);
      setSession(current);
      if (current.kind === "authenticated") {
        const [all, saved] = await Promise.all([
          api("/api/v1/github/repositories", repositoryListSchema),
          api("/api/v1/repositories/selected", selectedRepositoryListSchema),
        ]);
        setAvailable(all.repositories);
        setSelected(saved.repositories);
        setInstallUrl(all.installUrl);
        if (setupReturnPending.current || !saved.repositories.length)
          setView("manage");
        if (setupReturnPending.current) {
          setupReturnPending.current = false;
          sessionStorage.removeItem(SETUP_KEY);
          const returnUrl = new URL(window.location.href);
          returnUrl.searchParams.delete("github_setup");
          history.replaceState(
            history.state,
            "",
            `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`,
          );
        }
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        setSession({ kind: "anonymous" });
        setAvailable([]);
        setSelected([]);
      } else
        setProblem(
          error instanceof Error ? error.message : "Could not load Benana.",
        );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  if (loading)
    return (
      <Status
        title="Loading your workspace"
        detail="Checking your GitHub authorization and repositories."
      />
    );
  if (problem)
    return (
      <Status
        title="Could not load your workspace"
        detail={problem}
        action={{ label: "Try again", run: () => void load() }}
      />
    );
  if (!session || session.kind === "anonymous")
    return (
      <Status
        title="Continue your work with context intact"
        detail="Sign in with GitHub to choose the repositories where the Benana App is installed."
        action={{
          label: "Continue with GitHub",
          run: () => window.location.assign("/api/v1/auth/github/start"),
        }}
      />
    );

  const explicitRepositoryId = params.repositoryId;
  const active = explicitRepositoryId
    ? selected.find(
        (repository) => String(repository.id) === explicitRepositoryId,
      )
    : selected[0];
  const unavailable = Boolean(explicitRepositoryId && !active);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("benana-theme", next);
    setTheme(next);
  };

  return (
    <WorkspaceFrame
      navigation={(close) => (
        <LiveNavigation
          repositories={selected}
          activeId={active?.id}
          session={session}
          theme={theme}
          onRepository={(repository) => {
            navigate(`/repositories/${repository.id}`);
            setView("issues");
            close();
          }}
          onManage={() => {
            setView("manage");
            close();
          }}
          onTheme={toggleTheme}
        />
      )}
    >
      {view === "manage" || (!active && !unavailable) ? (
        <RepositoryPicker
          available={available}
          selected={selected}
          installUrl={installUrl}
          setupComplete={setupComplete}
          canCancel={selected.length > 0 && !unavailable}
          onCancel={() => setView("issues")}
          onRefresh={load}
          onSaved={(repositories) => {
            setSelected(repositories);
            const first = repositories[0];
            if (first) {
              setView("issues");
              navigate(`/repositories/${first.id}`);
            } else setView("manage");
          }}
        />
      ) : unavailable ? (
        <section className="manage-page">
          <span className="eyebrow">Repository unavailable</span>
          <h1>This repository is not selected</h1>
          <p>
            Select it again if you still have access, or open another saved
            repository.
          </p>
          <button className="live-primary" onClick={() => setView("manage")}>
            Manage repositories
          </button>
        </section>
      ) : active ? (
        <LiveWorkspace
          key={active.id}
          repository={active}
          issueNumber={params.issueNumber}
          onExpired={load}
        />
      ) : null}
    </WorkspaceFrame>
  );
}

function LiveNavigation({
  repositories,
  activeId,
  session,
  theme,
  onRepository,
  onManage,
  onTheme,
}: {
  repositories: AccessibleRepository[];
  activeId: number | undefined;
  session: Extract<AuthSession, { kind: "authenticated" }>;
  theme: "light" | "dark";
  onRepository: (repository: AccessibleRepository) => void;
  onManage: () => void;
  onTheme: () => void;
}) {
  return (
    <>
      <div className="sidebar-brand">
        <div className="brand-mark" aria-hidden="true">
          B
        </div>
        <span>Benana</span>
      </div>
      <nav aria-label="Repositories" className="sidebar-nav live-navigation">
        <div className="sidebar-section-label">Repositories</div>
        {repositories.map((repository) => (
          <button
            className="sidebar-row repository-row"
            data-active={repository.id === activeId}
            aria-current={repository.id === activeId ? true : undefined}
            key={repository.id}
            onClick={() => onRepository(repository)}
          >
            <span className="repo-dot" data-private={repository.private} />
            <span className="truncate">{repository.fullName}</span>
          </button>
        ))}
        <button className="sidebar-row" onClick={onManage}>
          <Settings size={15} />
          <span>Manage repositories</span>
        </button>
      </nav>
      <div className="sidebar-footer">
        <button
          className="sidebar-row"
          onClick={onTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <div className="sidebar-user">
          <img className="avatar" src={session.user.avatarUrl} alt="" />
          <span>
            <strong>{session.user.name ?? session.user.login}</strong>
            <small>@{session.user.login}</small>
          </span>
          <button
            className="icon-button"
            aria-label="Log out"
            onClick={async () => {
              await fetch("/api/v1/auth/logout", {
                method: "POST",
                headers: { Origin: location.origin },
              });
              location.assign("/");
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

function RepositoryPicker({
  available,
  selected,
  installUrl,
  setupComplete,
  canCancel,
  onCancel,
  onRefresh,
  onSaved,
}: {
  available: AccessibleRepository[];
  selected: AccessibleRepository[];
  installUrl: string;
  setupComplete: boolean;
  canCancel: boolean;
  onCancel: () => void;
  onRefresh: () => void | Promise<void>;
  onSaved: (repositories: AccessibleRepository[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(
    () => new Set(selected.map((repository) => repository.id)),
  );
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const filtered = available.filter((repository) =>
    repository.fullName.toLowerCase().includes(query.toLowerCase()),
  );
  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const result = await api(
        "/api/v1/repositories/selection",
        selectedRepositoryListSchema,
        {
          method: "PUT",
          headers: { Origin: location.origin },
          body: JSON.stringify({ repositoryIds: [...chosen] }),
        },
      );
      onSaved(result.repositories);
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Could not save repositories.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="manage-page">
      <div>
        <span className="eyebrow">GitHub App access</span>
        <h1>Choose repositories</h1>
        <p>
          Select the repositories Benana should show. Only repositories where
          the App is installed and you have write access appear here.
        </p>
      </div>
      {setupComplete && (
        <div className="live-secondary" role="status">
          Back from GitHub. Choose the repositories to use in Benana.
        </div>
      )}
      <div className="manage-actions">
        {canCancel && (
          <button className="live-secondary" onClick={onCancel}>
            Back to issues
          </button>
        )}
        <a className="live-secondary" href={installUrl}>
          <Github size={17} /> Install or configure App
        </a>
        <button className="live-secondary" onClick={() => void onRefresh()}>
          Refresh repositories
        </button>
      </div>
      <label className="live-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search repositories"
        />
      </label>
      {problem && <div className="live-error">{problem}</div>}
      <div className="repo-picker">
        {!filtered.length ? (
          <p>
            No eligible repositories found. Configure the GitHub App, then try
            again.
          </p>
        ) : (
          filtered.map((repository) => (
            <label key={repository.id}>
              <input
                type="checkbox"
                checked={chosen.has(repository.id)}
                onChange={() =>
                  setChosen((old) => {
                    const next = new Set(old);
                    if (next.has(repository.id)) next.delete(repository.id);
                    else next.add(repository.id);
                    return next;
                  })
                }
              />
              <span>
                <strong>{repository.fullName}</strong>
                <small>
                  {repository.private ? "Private" : "Public"} repository
                </small>
              </span>
            </label>
          ))
        )}
      </div>
      <button
        className="live-primary"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save selection"}
      </button>
    </section>
  );
}

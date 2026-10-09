import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  CircleDot,
  GitFork,
  Menu,
  Moon,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { BackendStatus } from "./backend-status";
import type { Repository } from "../domain/types";

export type SidebarScope = "all" | "mine" | "checkpoints";

interface WorkspaceShellProps {
  repositories: readonly Repository[];
  repositoryId: string;
  scope: SidebarScope;
  theme: "light" | "dark";
  children: ReactNode;
  onRepositoryChange: (repositoryId: string) => void;
  onScopeChange: (scope: SidebarScope) => void;
  onThemeChange: () => void;
}

type NavigationProps = Omit<WorkspaceShellProps, "children">;

const scopeItems = [
  { value: "all", label: "All issues", icon: CircleDot },
  { value: "mine", label: "My attempts", icon: UserRound },
  { value: "checkpoints", label: "Checkpoints", icon: CheckCircle2 },
] satisfies ReadonlyArray<{
  value: SidebarScope;
  label: string;
  icon: typeof CircleDot;
}>;

function WorkspaceNavigation({
  repositories,
  repositoryId,
  scope,
  theme,
  onRepositoryChange,
  onScopeChange,
  onThemeChange,
}: NavigationProps) {
  return (
    <>
      <div className="sidebar-brand">
        <div className="brand-mark" aria-hidden="true">
          B
        </div>
        <span>Benana</span>
      </div>
      <nav aria-label="Workspace views" className="sidebar-nav">
        {scopeItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className="sidebar-row"
              data-active={scope === item.value}
              aria-label={item.label}
              aria-current={scope === item.value ? true : undefined}
              title={item.label}
              key={item.value}
              type="button"
              onClick={() => onScopeChange(item.value)}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-section">
        <div className="sidebar-section-label">Repositories</div>
        {repositories.map((repository) => (
          <button
            className="sidebar-row repository-row"
            data-active={repository.id === repositoryId}
            aria-label={repository.name}
            aria-current={repository.id === repositoryId ? true : undefined}
            title={repository.name}
            key={repository.id}
            type="button"
            onClick={() => onRepositoryChange(repository.id)}
          >
            <span
              className="repo-dot"
              style={{ background: repository.accent }}
            />
            <span className="truncate">{repository.name}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <BackendStatus />
        <button
          className="sidebar-row"
          type="button"
          onClick={onThemeChange}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <div className="sidebar-user">
          <span className="avatar">PS</span>
          <span>
            <strong>Prathamesh</strong>
            <small>Local workspace</small>
          </span>
          <GitFork size={14} aria-label="Local Git workspace" />
        </div>
      </div>
    </>
  );
}

export function WorkspaceShell({
  children,
  ...navigation
}: WorkspaceShellProps) {
  return (
    <WorkspaceFrame
      navigation={(close) => (
        <WorkspaceNavigation
          {...navigation}
          onRepositoryChange={(id) => {
            navigation.onRepositoryChange(id);
            close();
          }}
          onScopeChange={(scope) => {
            navigation.onScopeChange(scope);
            close();
          }}
        />
      )}
    >
      {children}
    </WorkspaceFrame>
  );
}

export function WorkspaceFrame({
  children,
  navigation,
}: {
  children: ReactNode;
  navigation: (close: () => void) => ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <aside className="sidebar desktop-sidebar">
        {navigation(() => undefined)}
      </aside>
      <main className="workspace-frame">{children}</main>
      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Trigger asChild>
          <button
            className="mobile-menu-trigger icon-button"
            type="button"
            aria-label="Open navigation"
            title="Open navigation"
          >
            <Menu size={18} />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="sidebar mobile-navigation"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">
              Workspace navigation
            </Dialog.Title>
            <Dialog.Close
              className="icon-button mobile-menu-close"
              aria-label="Close navigation"
            >
              <X size={17} />
            </Dialog.Close>
            {navigation(close)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

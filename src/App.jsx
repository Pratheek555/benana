import React from "react";
import { call, hasDesktopBridge, isDemo } from "./api.js";
import ConnectModal from "./components/ConnectModal.jsx";
import GraphPanel from "./components/GraphPanel.jsx";
import Sidebar from "./components/workspace/Sidebar.jsx";
import TaskWorkspace from "./components/workspace/TaskWorkspace.jsx";
import RunInspector, { Checks } from "./components/workspace/RunInspector.jsx";
import GraphWorkspace from "./components/workspace/GraphWorkspace.jsx";
import {
  SecondaryView,
  RuntimeSetup,
  ProjectSetup,
} from "./components/workspace/SecondaryViews.jsx";
import { Badge } from "./components/workspace/ui.jsx";
import { useWorkspace } from "./hooks/useWorkspace.js";
import ModStudio from "./components/studio/ModStudio.jsx";

export default function App() {
  const [deepIngest, setDeepIngest] = React.useState(false);
  const [studioMode, setStudioMode] = React.useState(!isDemo);
  const workspace = useWorkspace();
  const {
    project,
    setProject,
    runs,
    sessions,
    inbox,
    proposals,
    integrations,
    selected,
    setSelected,
    route,
    setRoute,
    toast,
    connect,
    setConnect,
    notify,
    run,
    session,
    selectStartedRun,
    newTask,
    refresh,
    graphTick,
  } = workspace;

  if (!hasDesktopBridge() && !isDemo) return <RuntimeSetup />;
  if (studioMode)
    return <ModStudio onOpenWorkspace={() => setStudioMode(false)} />;
  if (!project) return <ProjectSetup onOpen={setProject} />;

  const center =
    route === "tasks" ? (
      <TaskWorkspace
        project={project}
        run={run}
        runs={runs}
        session={session}
        onStarted={selectStartedRun}
        notify={notify}
      />
    ) : ["entire", "history", "insights"].includes(route) ? (
      <GraphWorkspace kind={route} runs={runs} graphTick={graphTick} />
    ) : route === "settings" ? (
      <main className="page">
        <header>
          <h1>Settings</h1>
          <p>Repository verification and agent defaults.</p>
        </header>
        <Checks run={{ verify: [] }} project={project} />
      </main>
    ) : route === "benana-graph" ? (
      <main className="page graph-page">
        <header>
          <Badge tone="violet">Benana</Badge>
          <h1>Intent graph</h1>
          <p>Explore recorded direction, decisions, and dead ends.</p>
        </header>
        <button
          className="analyze"
          onClick={() =>
            call("graph:ingest", { deep: deepIngest })
              .then(() => notify("Intent graph re-ingested"))
              .catch((error) => notify(error.message, "error"))
          }
        >
          Re-ingest intent
        </button>
        <label className="deep-ingest">
          <input
            type="checkbox"
            checked={deepIngest}
            onChange={(event) => setDeepIngest(event.target.checked)}
          />
          Deep extraction with agent-assisted analysis
        </label>
        <GraphPanel
          tick={graphTick}
          focus={[]}
          onClearFocus={() => {}}
          project={project}
        />
      </main>
    ) : (
      <SecondaryView
        route={route}
        inbox={inbox}
        proposals={proposals}
        notify={notify}
        setConnect={setConnect}
        onStarted={selectStartedRun}
        refresh={refresh}
        integrations={integrations}
      />
    );

  return (
    <div className="workspace">
      <Sidebar
        project={project}
        runs={runs}
        sessions={sessions}
        inbox={inbox}
        route={route}
        setRoute={setRoute}
        selected={selected}
        setSelected={setSelected}
        onNew={newTask}
      />
      {center}
      {route === "tasks" && (
        <RunInspector
          run={run}
          project={project}
          integrations={integrations}
          notify={notify}
        />
      )}
      {route === "entire" && (
        <aside className="inspector source-panel">
          <h3>Graph source</h3>
          <button className="source active">
            <Badge tone="green">Entire</Badge>Repository relationships
          </button>
          <button className="source" onClick={() => setRoute("benana-graph")}>
            <Badge tone="violet">Benana</Badge>Intent graph
          </button>
        </aside>
      )}
      {connect && (
        <ConnectModal
          onClose={() => {
            setConnect(false);
            setRoute("tasks");
          }}
          notify={notify}
        />
      )}
      {toast && <div className={`toast ${toast.level}`}>{toast.text}</div>}
    </div>
  );
}

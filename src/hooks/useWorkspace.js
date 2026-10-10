import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, hasDesktopBridge, isDemo, on } from "../api.js";

export function useWorkspace() {
  const [project, setProjectState] = useState(null);
  const [runsMap, setRunsMap] = useState({});
  const [sessions, setSessions] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [integrations, setIntegrations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [route, setRoute] = useState("tasks");
  const [toast, setToast] = useState(null);
  const [connect, setConnect] = useState(false);
  const [graphTick, setGraphTick] = useState(0);
  const projectRef = useRef(null);
  const toastTimer = useRef(null);
  const notify = useCallback((text, level = "info") => {
    setToast({ text, level });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  const setProject = useCallback((next) => {
    projectRef.current = next;
    setProjectState(next);
  }, []);
  const refresh = useCallback(async () => {
    if (!projectRef.current) return;
    const repo = projectRef.current.repo;
    try {
      const [runs, attached, issues, improvements, status] = await Promise.all([
        call("run:list"),
        call("sessions:detect"),
        call("inbox:list"),
        call("improve:list").catch(() => []),
        call("status:integrations").catch(() => null),
      ]);
      if (projectRef.current?.repo !== repo) return;
      setRunsMap(
        Object.fromEntries((runs || []).map((item) => [item.id, item])),
      );
      setSessions(attached || []);
      setInbox(issues || []);
      setProposals(improvements || []);
      setIntegrations(status);
    } catch (error) {
      notify(error.message, "error");
    }
  }, [notify]);
  useEffect(() => {
    if (!hasDesktopBridge() && !isDemo) return;
    let live = true;
    call("config:get")
      .then(async (config) => {
        if (isDemo) return call("project:open", {});
        if (config.autoOpen && config.last?.repo)
          return call("project:open", config.last);
        return null;
      })
      .then((next) => live && next && setProject(next))
      .catch((error) => live && notify(error.message, "error"));
    return () => {
      live = false;
      clearTimeout(toastTimer.current);
    };
  }, [notify, setProject]);
  useEffect(() => {
    setRunsMap({});
    setSessions([]);
    setInbox([]);
    setProposals([]);
    setIntegrations(null);
    setSelected(null);
    if (project?.repo) refresh();
  }, [project?.repo, refresh]);
  useEffect(() => {
    if (!project?.repo) return;
    const repo = project.repo;
    const current = () => projectRef.current?.repo === repo;
    const offs = [
      on("run", (item) => {
        if (!current() || (item.repo && item.repo !== repo)) return;
        setRunsMap((items) => ({
          ...items,
          [item.id]: { ...items[item.id], ...item },
        }));
      }),
      on("inbox", () => current() && refresh()),
      on("proposals", () => current() && refresh()),
      on(
        "project",
        (next) => next?.repo === repo && current() && setProject(next),
      ),
      on("graph-changed", () => current() && setGraphTick((tick) => tick + 1)),
      on(
        "log",
        (entry) => entry?.level === "error" && notify(entry.text, "error"),
      ),
    ];
    const timer = setInterval(
      () =>
        call("sessions:detect")
          .then((items) => current() && setSessions(items || []))
          .catch(() => {}),
      5000,
    );
    return () => {
      offs.forEach((off) => off());
      clearInterval(timer);
    };
  }, [project?.repo, notify, refresh, setProject]);
  const runs = useMemo(
    () =>
      Object.values(runsMap).sort(
        (a, b) => (b.startedAt || 0) - (a.startedAt || 0),
      ),
    [runsMap],
  );
  const run = selected?.origin !== "attached" ? runsMap[selected?.id] : null;
  const session =
    selected?.origin === "attached"
      ? sessions.find((item) => item.id === selected.id)
      : null;
  const selectStartedRun = useCallback((started) => {
    setRunsMap((items) => ({ ...items, [started.id]: started }));
    setSelected({ id: started.id, origin: "native" });
    setRoute("tasks");
  }, []);
  const newTask = useCallback(() => {
    setSelected(null);
    setRoute("tasks");
    setTimeout(() => document.getElementById("task-composer")?.focus(), 0);
  }, []);
  return {
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
  };
}

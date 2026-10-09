import { Navigate, Route, Routes } from "react-router";
import { LiveApp } from "./pages/live-app";
import { RepositoryWorkspace } from "./pages/repository-workspace";
export function App() {
  return (
    <Routes>
      <Route path="/" element={<LiveApp />} />
      <Route path="/repositories" element={<LiveApp />} />
      <Route path="/repositories/:repositoryId" element={<LiveApp />} />
      <Route
        path="/repositories/:repositoryId/issues/:issueNumber"
        element={<LiveApp />}
      />
      <Route
        path="/demo"
        element={<Navigate replace to="/demo/repositories/benana" />}
      />
      <Route
        path="/demo/repositories/:repositoryId"
        element={<RepositoryWorkspace />}
      />
      <Route
        path="/demo/repositories/:repositoryId/issues/:issueId"
        element={<RepositoryWorkspace />}
      />
      <Route
        path="/demo/repositories/:repositoryId/issues/:issueId/attempts/:attemptId"
        element={<RepositoryWorkspace />}
      />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

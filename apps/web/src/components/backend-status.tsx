import { useEffect, useState } from "react";

type BackendState =
  | { kind: "checking" }
  | { kind: "connected"; service: "benana-api" }
  | { kind: "unavailable" };

type HealthResponse = {
  status: "ok";
  service: "benana-api";
};

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "ok" &&
    "service" in value &&
    value.service === "benana-api"
  );
}

async function readHealth(response: Response): Promise<HealthResponse | null> {
  if (!response.ok) return null;

  const value: unknown = await response.json();
  return isHealthResponse(value) ? value : null;
}

export function BackendStatus() {
  const [state, setState] = useState<BackendState>({ kind: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(5_000),
    ]);

    async function checkBackend() {
      try {
        const response = await fetch("/api/v1/health", {
          signal,
        });
        const health = await readHealth(response);
        if (controller.signal.aborted) return;
        if (!health) {
          setState({ kind: "unavailable" });
          return;
        }
        setState({ kind: "connected", service: health.service });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "unavailable" });
      }
    }

    void checkBackend();
    return () => controller.abort();
  }, []);

  const label =
    state.kind === "checking"
      ? "Backend checking"
      : state.kind === "connected"
        ? "Backend connected"
        : "Backend unavailable";

  return (
    <div className="demo-status" data-status={state.kind} role="status">
      <span className="status-dot" /> Demo / {label}
    </div>
  );
}

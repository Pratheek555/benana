import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  Handle,
  Position,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { mockToolEvents } from "../../data/mockToolEvents";

/* --------------------------------------------------
   Theme
-------------------------------------------------- */

const COLORS = {
  background: "#0b0d10",
  panel: "#12151a",
  surface: "#191d24",
  border: "#292f39",
  text: "#e7eaf0",
  muted: "#929baa",
  accent: "#8b7cff",
  success: "#48c78e",
  running: "#65a6ff",
  failed: "#f07178",
  pending: "#929baa",
};

function getStatusColor(status) {
  switch (String(status || "").toLowerCase()) {
    case "running":
      return COLORS.running;
    case "success":
    case "completed":
    case "done":
      return COLORS.success;
    case "failed":
    case "error":
      return COLORS.failed;
    default:
      return COLORS.pending;
  }
}

function getEventTitle(event = {}) {
  return (
    event.label ||
    event.toolName ||
    event.tool ||
    event.name ||
    event.title ||
    event.type ||
    "Agent step"
  );
}

function getEventDescription(event = {}) {
  return (
    event.description ||
    event.command ||
    event.filePath ||
    event.file ||
    event.input ||
    event.summary ||
    "No additional details"
  );
}

/* --------------------------------------------------
   Custom React Flow node
-------------------------------------------------- */

const ToolNode = memo(function ToolNode({ data, selected }) {
  const statusColor = getStatusColor(data.status);

  return (
    <div
      style={{
        width: 250,
        background: COLORS.surface,
        color: COLORS.text,
        border: `1px solid ${
          selected ? COLORS.accent : COLORS.border
        }`,
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: 10,
        boxShadow: selected
          ? `0 0 0 2px ${COLORS.accent}25`
          : "0 5px 18px #00000025",
        fontFamily: "Inter, system-ui, sans-serif",
        overflow: "hidden",
        transition: "border-color 150ms ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 8,
          height: 8,
          background: "#667085",
          border: `2px solid ${COLORS.surface}`,
        }}
      />

      <div
        style={{
          padding: "12px 13px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 650,
            lineHeight: 1.4,
            overflowWrap: "anywhere",
          }}
        >
          {data.title}
        </div>

        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            color: statusColor,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 700,
          }}
        >
          {data.status || "pending"}
        </span>
      </div>

      <div
        style={{
          padding: "0 13px 13px",
          color: COLORS.muted,
          fontSize: 11,
          lineHeight: 1.5,
          overflowWrap: "anywhere",
        }}
      >
        {data.description}
      </div>

      {data.type && (
        <div
          style={{
            borderTop: `1px solid ${COLORS.border}`,
            padding: "8px 13px",
            fontSize: 10,
            color: "#a9b2c0",
            background: "#ffffff04",
          }}
        >
          {data.type}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 8,
          height: 8,
          background: "#667085",
          border: `2px solid ${COLORS.surface}`,
        }}
      />
    </div>
  );
});

const nodeTypes = {
  custom: ToolNode,
};

/* --------------------------------------------------
   React Flow canvas

   Keep useReactFlow inside ReactFlowProvider.
-------------------------------------------------- */

function FlowContent({
  eventsLength,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
}) {
  const { fitView } = useReactFlow();

  // Refit after the graph has changed, and clean up the timer.
  useEffect(() => {
    if (eventsLength === 0) return undefined;

    const timer = setTimeout(() => {
      fitView({
        padding: 0.2,
        duration: 350,
        minZoom: 0.25,
        maxZoom: 1.1,
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [eventsLength, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      fitView
      minZoom={0.2}
      maxZoom={1.5}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: "smoothstep",
        style: {
          stroke: "#555d6b",
          strokeWidth: 1.5,
        },
      }}
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.background,
      }}
    >
      <Background
        color="#303641"
        gap={22}
        size={1}
        variant="dots"
      />

      <Controls
        position="bottom-left"
        showInteractive={false}
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />

      {eventsLength === 0 && (
        <Panel position="top-center">
          <div
            style={{
              marginTop: 70,
              padding: "18px 22px",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              background: COLORS.panel,
              color: COLORS.muted,
              textAlign: "center",
              fontSize: 13,
            }}
          >
            <div
              style={{
                color: COLORS.text,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              No tool activity yet
            </div>
            Start a demo run to see the agent's workflow.
          </div>
        </Panel>
      )}
    </ReactFlow>
  );
}

/* --------------------------------------------------
   Main ToolGraph component
-------------------------------------------------- */

export default function ToolGraph({
  externalEvents = null,
  onEventSelect,
}) {
  const [demoIndex, setDemoIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(null);

  const isDemo = externalEvents == null;

  /*
   * IMPORTANT:
   * Memoizing this array prevents the graph-building effect
   * from running repeatedly because of a new array reference
   * on every render.
   */
  const events = useMemo(() => {
    if (!isDemo) return externalEvents || [];

    return mockToolEvents.slice(0, demoIndex);
  }, [isDemo, externalEvents, demoIndex]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Add demo events one at a time.
  useEffect(() => {
    if (!isDemo || !isPlaying) return undefined;

    if (demoIndex >= mockToolEvents.length) {
      setIsPlaying(false);
      return undefined;
    }

    const timer = setTimeout(() => {
      setDemoIndex((current) => current + 1);
    }, 1200);

    return () => clearTimeout(timer);
  }, [isDemo, isPlaying, demoIndex]);

  // Build graph data only when the actual event inputs change.
  useEffect(() => {
    const nextNodes = events.map((event, index) => {
      const id = String(event.id ?? `event-${index}`);

      const isLatestRunningEvent =
        isDemo &&
        isPlaying &&
        index === events.length - 1 &&
        demoIndex < mockToolEvents.length;

      const status = isLatestRunningEvent
        ? "running"
        : event.status || "completed";

      return {
        id,
        type: "custom",
        position: {
          x: 100,
          y: index * 145 + 50,
        },
        data: {
          ...event,
          title: getEventTitle(event),
          description: getEventDescription(event),
          status,
          selected: id === selectedEventId,
        },
      };
    });

    const validNodeIds = new Set(nextNodes.map((node) => node.id));

    const nextEdges = events.flatMap((event, index) => {
      if (event.parentId == null) return [];

      const source = String(event.parentId);
      const target = String(event.id ?? `event-${index}`);

      // Avoid edges pointing to nodes that don't exist.
      if (!validNodeIds.has(source) || !validNodeIds.has(target)) {
        return [];
      }

      const targetEvent = events.find(
        (candidate, candidateIndex) =>
          String(candidate.id ?? `event-${candidateIndex}`) === target
      );

      const edgeStatus = targetEvent?.status;

      return [
        {
          id: `e-${source}-${target}`,
          source,
          target,
          type: "smoothstep",
          animated: edgeStatus === "running",
          style: {
            stroke:
              edgeStatus === "failed" || edgeStatus === "error"
                ? COLORS.failed
                : edgeStatus === "running"
                  ? COLORS.running
                  : "#555d6b",
            strokeWidth: 1.5,
          },
        },
      ];
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [
    events,
    selectedEventId,
    isDemo,
    isPlaying,
    demoIndex,
    setNodes,
    setEdges,
  ]);

  const handleNodeClick = useCallback(
    (_event, node) => {
      setSelectedEventId(node.id);

      const selected = events.find(
        (event, index) =>
          String(event.id ?? `event-${index}`) === node.id
      );

      if (selected) {
        onEventSelect?.(selected);
      }
    },
    [events, onEventSelect]
  );

  const selectedEvent = useMemo(
    () =>
      events.find(
        (event, index) =>
          String(event.id ?? `event-${index}`) === selectedEventId
      ) || null,
    [events, selectedEventId]
  );

  const startDemo = useCallback(() => {
    setDemoIndex(0);
    setSelectedEventId(null);
    setIsPlaying(true);
  }, []);

  const pauseDemo = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const resetDemo = useCallback(() => {
    setIsPlaying(false);
    setDemoIndex(0);
    setSelectedEventId(null);
  }, []);

  const demoFinished =
    isDemo && demoIndex >= mockToolEvents.length;

  return (
    <div
      className="tool-graph"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minHeight: 420,
        background: COLORS.background,
        color: COLORS.text,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          padding: "12px 14px",
          background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 13, fontWeight: 650 }}>
            Agent Tool Graph
          </div>
          <div
            style={{
              marginTop: 3,
              color: COLORS.muted,
              fontSize: 11,
            }}
          >
            {events.length} event{events.length === 1 ? "" : "s"}
            {isPlaying ? " · Running demo" : ""}
          </div>
        </div>

        {isDemo && (
          <>
            <button
              type="button"
              onClick={startDemo}
              disabled={isPlaying}
              style={buttonStyle(isPlaying)}
            >
              ▶ Start Demo Run
            </button>

            {isPlaying && (
              <button
                type="button"
                onClick={pauseDemo}
                style={buttonStyle(false)}
              >
                Ⅱ Pause
              </button>
            )}

            <button
              type="button"
              onClick={resetDemo}
              style={buttonStyle(false)}
            >
              ↺ Reset
            </button>

            {demoFinished && (
              <span
                style={{
                  color: COLORS.success,
                  fontSize: 11,
                }}
              >
                Demo complete
              </span>
            )}
          </>
        )}
      </div>

      {/* Graph and event details */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 360,
          }}
        >
          <ReactFlowProvider>
            <FlowContent
              eventsLength={events.length}
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
            />
          </ReactFlowProvider>
        </div>

        {selectedEvent && (
          <aside
            style={{
              width: 250,
              maxWidth: "40%",
              flexShrink: 0,
              overflowY: "auto",
              padding: 14,
              background: COLORS.panel,
              borderLeft: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
              }}
            >
              Event details
            </div>

            <div
              style={{
                fontSize: 14,
                fontWeight: 650,
                overflowWrap: "anywhere",
              }}
            >
              {getEventTitle(selectedEvent)}
            </div>

            <div
              style={{
                display: "inline-block",
                marginTop: 10,
                padding: "4px 7px",
                borderRadius: 6,
                background: "#ffffff08",
                color: getStatusColor(selectedEvent.status),
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              {selectedEvent.status || "completed"}
            </div>

            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                color: COLORS.muted,
                lineHeight: 1.6,
                overflowWrap: "anywhere",
              }}
            >
              {getEventDescription(selectedEvent)}
            </div>

            {selectedEvent.command && (
              <pre style={detailCodeStyle}>
                {selectedEvent.command}
              </pre>
            )}

            {selectedEvent.output && (
              <pre style={detailCodeStyle}>
                {String(selectedEvent.output)}
              </pre>
            )}

            {selectedEvent.filePath && (
              <div
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  color: COLORS.muted,
                  overflowWrap: "anywhere",
                }}
              >
                File: {selectedEvent.filePath}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function buttonStyle(disabled) {
  return {
    padding: "8px 11px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 7,
    background: disabled ? "#252a33" : "#1b2028",
    color: disabled ? "#7d8592" : COLORS.text,
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  };
}

const detailCodeStyle = {
  marginTop: 12,
  padding: 10,
  background: "#090b0e",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 7,
  color: "#c4cbd6",
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};
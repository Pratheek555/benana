import React, { memo, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  Handle,
  Position,
  Panel,
  useReactFlow,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

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

function statusColor(status) {
  switch (String(status || "").toLowerCase()) {
    case "success":
    case "completed":
    case "passed":
    case "changed":
      return status === "changed" ? "#c6a0ff" : COLORS.success;
    case "running":
      return COLORS.running;
    case "failed":
    case "error":
    case "fail":
      return COLORS.failed;
    default:
      return COLORS.pending;
  }
}

const InspectorNode = memo(function InspectorNode({ data, selected }) {
  const color = statusColor(data.status);

  return (
    <div
      style={{
        width: 230,
        overflow: "hidden",
        color: COLORS.text,
        background: COLORS.surface,
        border: `1px solid ${selected ? COLORS.accent : COLORS.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        boxShadow: selected ? `0 0 0 2px ${COLORS.accent}22` : "none",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#687386", border: "none", width: 7, height: 7 }}
      />

      <div style={{ padding: "12px 12px 5px" }}>
        <div style={{ fontSize: 12, fontWeight: 650, overflowWrap: "anywhere" }}>
          {data.title}
        </div>
      </div>

      <div
        style={{
          padding: "0 12px 12px",
          fontSize: 11,
          lineHeight: 1.5,
          color: COLORS.muted,
          overflowWrap: "anywhere",
        }}
      >
        {data.description}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          borderTop: `1px solid ${COLORS.border}`,
          background: "#ffffff04",
        }}
      >
        <span style={{ fontSize: 10, color: COLORS.muted }}>
          {data.type || "event"}
        </span>
        <span
          style={{
            fontSize: 10,
            color,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {data.status || "pending"}
        </span>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#687386", border: "none", width: 7, height: 7 }}
      />
    </div>
  );
});

const nodeTypes = { inspector: InspectorNode };

function FlowCanvas({ nodes, edges, onNodeClick }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!nodes.length) return undefined;

    const timer = setTimeout(() => {
      fitView({ padding: 0.18, duration: 250, maxZoom: 1 });
    }, 80);

    return () => clearTimeout(timer);
  }, [nodes.length, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      fitView
      minZoom={0.2}
      maxZoom={1.25}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: "smoothstep",
        style: { stroke: "#505968", strokeWidth: 1.5 },
      }}
      style={{ background: COLORS.background }}
    >
      <Background color="#303641" gap={22} size={1} variant="dots" />
      <Controls
        showInteractive={false}
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />
      {nodes.length === 0 && (
        <Panel position="top-center">
          <div style={{ color: COLORS.muted, marginTop: 45, fontSize: 12 }}>
            Nothing to visualize yet.
          </div>
        </Panel>
      )}
    </ReactFlow>
  );
}

export default function InspectorFlow({
  title,
  subtitle,
  items = [],
  mock = false,
}) {
  const [selectedId, setSelectedId] = useState(null);

  const nodes = useMemo(
    () =>
      items.map((item, index) => ({
        id: String(item.id ?? `item-${index}`),
        type: "inspector",
        position: { x: 100, y: index * 145 + 35 },
        data: item,
      })),
    [items]
  );

  const edges = useMemo(
    () =>
      nodes.slice(1).map((node, index) => ({
        id: `edge-${nodes[index].id}-${node.id}`,
        source: nodes[index].id,
        target: node.id,
        type: "smoothstep",
        animated: node.data.status === "running",
        style: {
          stroke:
            node.data.status === "failed"
              ? COLORS.failed
              : node.data.status === "running"
                ? COLORS.running
                : "#505968",
          strokeWidth: 1.5,
        },
      })),
    [nodes]
  );

  const selected = items.find(
    (item, index) => String(item.id ?? `item-${index}`) === selectedId
  );

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 390,
        minWidth: 0,
        color: COLORS.text,
        background: COLORS.background,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "13px 15px",
          background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <strong style={{ fontSize: 13 }}>{title}</strong>
          {mock && (
            <span
              style={{
                color: "#c6a0ff",
                fontSize: 10,
                border: "1px solid #624c88",
                borderRadius: 5,
                padding: "3px 6px",
              }}
            >
              DEMO DATA
            </span>
          )}
        </div>
        {subtitle && (
          <div style={{ color: COLORS.muted, fontSize: 11, marginTop: 5 }}>
            {subtitle}
          </div>
        )}
      </header>

      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 330,
          minWidth: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, minHeight: 330 }}>
          <ReactFlowProvider>
            <FlowCanvas
              nodes={nodes}
              edges={edges}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
            />
          </ReactFlowProvider>
        </div>

        {selected && (
          <aside
            style={{
              width: 185,
              flexShrink: 0,
              padding: 12,
              overflowY: "auto",
              background: COLORS.panel,
              borderLeft: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              style={{
                color: COLORS.muted,
                fontSize: 10,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Selected node
            </div>
            <strong style={{ fontSize: 12, overflowWrap: "anywhere" }}>
              {selected.title}
            </strong>
            <p style={{ fontSize: 11, lineHeight: 1.6, color: COLORS.muted }}>
              {selected.description}
            </p>
            <div style={{ fontSize: 10, color: statusColor(selected.status) }}>
              {selected.status || "pending"}
            </div>
            {selected.detail && (
              <p style={{ fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                {selected.detail}
              </p>
            )}
          </aside>
        )}
      </div>

      <footer
        style={{
          padding: "8px 12px",
          borderTop: `1px solid ${COLORS.border}`,
          color: COLORS.muted,
          fontSize: 10,
        }}
      >
        {items.length} nodes · Click a node to inspect it
      </footer>
    </section>
  );
}
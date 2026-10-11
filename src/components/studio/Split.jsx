import React from "react";

// Resizable panes. Drag a gutter to resize the panes on either side of it; double-click it to
// reset. Sizes are fractions of the container, remembered per `id` in localStorage.
const load = (id, n) => {
  try {
    const v = JSON.parse(localStorage.getItem(`benana-split:${id}`));
    if (Array.isArray(v) && v.length === n && v.every((x) => x > 0)) return v;
  } catch {}
  return null;
};
const save = (id, v) => {
  try { localStorage.setItem(`benana-split:${id}`, JSON.stringify(v)); } catch {}
};

// While dragging, iframes (the live game view) would swallow pointer events.
export function beginDrag(cursor) {
  document.body.classList.add("is-resizing");
  document.body.style.cursor = cursor;
  return () => {
    document.body.classList.remove("is-resizing");
    document.body.style.cursor = "";
  };
}

export default function Split({ id, direction = "row", initial, min = 120, className = "", children }) {
  const panes = React.Children.toArray(children).filter(Boolean);
  const n = panes.length;
  const defaults = initial && initial.length === n ? initial : Array(n).fill(1 / n);
  const [sizes, setSizes] = React.useState(() => load(id, n) || defaults);
  const ref = React.useRef(null);
  const row = direction === "row";

  React.useEffect(() => { if (sizes.length !== n) setSizes(load(id, n) || defaults); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (i) => (e) => {
    e.preventDefault();
    const box = ref.current.getBoundingClientRect();
    const total = row ? box.width : box.height;
    const origin = row ? e.clientX : e.clientY;
    const startSizes = sizes.slice();
    const pair = startSizes[i] + startSizes[i + 1];
    const minFrac = Math.min(min / total, pair / 2);
    const end = beginDrag(row ? "col-resize" : "row-resize");
    let latest = startSizes;
    const move = (ev) => {
      const delta = ((row ? ev.clientX : ev.clientY) - origin) / total;
      const a = Math.min(Math.max(startSizes[i] + delta, minFrac), pair - minFrac);
      latest = startSizes.slice();
      latest[i] = a;
      latest[i + 1] = pair - a;
      setSizes(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      end();
      save(id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reset = () => { setSizes(defaults); save(id, defaults); };

  // Grid tracks pin every pane to its share of the container in both directions.
  const tracks = panes.map((_, i) => `minmax(0, ${sizes[i] ?? 1 / n}fr)`).join(" var(--gutter, 12px) ");
  const style = row
    ? { gridTemplateColumns: tracks, gridTemplateRows: "minmax(0, 1fr)" }
    : { gridTemplateRows: tracks, gridTemplateColumns: "minmax(0, 1fr)" };
  return (
    <div ref={ref} className={`split ${row ? "split-row" : "split-col"} ${className}`} style={style}>
      {panes.map((pane, i) => (
        <React.Fragment key={pane.key ?? i}>
          <div className="split-pane">{pane}</div>
          {i < n - 1 && (
            <div
              className="split-gutter"
              role="separator"
              aria-orientation={row ? "vertical" : "horizontal"}
              title="Drag to resize · double-click to reset"
              onPointerDown={start(i)}
              onDoubleClick={reset}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

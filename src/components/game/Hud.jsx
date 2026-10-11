import React from "react";

// A player's screen over the 3D viewer, drawn with Minecraft's own GUI sprites (served by the viewer).
// The viewer renders vanilla textures only, so this is where the mod's generated item art and its boss bars show.
const S = 2; // GUI scale
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const snake = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const title = (name) => snake(name).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const label = (item) => item.customName || title(item.name);
const isModItem = (item) => Boolean(item?.texture);

function ItemIcon({ item, base, size = 16 * S }) {
  const [src, setSrc] = React.useState(0);
  const sources = item.texture ? [item.texture] : [`${base}items/${item.name}.png`, `${base}blocks/${item.name}.png`];
  React.useEffect(() => setSrc(0), [item.texture, item.name]);
  if (src >= sources.length) return <span className="hud-icon-text">{title(item.name).slice(0, 3)}</span>;
  return (
    <img
      className="hud-pixel"
      src={sources[src]}
      width={size}
      height={size}
      alt={label(item)}
      onError={() => setSrc((n) => n + 1)}
    />
  );
}

function BossBar({ bar, base }) {
  const color = ["pink", "blue", "red", "green", "yellow", "purple", "white"].includes(bar.color) ? bar.color : "purple";
  const pct = Math.max(0, Math.min(1, Number(bar.health) || 0));
  return (
    <div className="hud-boss">
      <span className="hud-text">{bar.title}</span>
      <div className="hud-boss-bar" style={{ backgroundImage: `url(${base}gui/sprites/boss_bar/${color}_background.png)` }}>
        <div style={{ width: `${pct * 100}%`, backgroundImage: `url(${base}gui/sprites/boss_bar/${color}_progress.png)` }} />
      </div>
    </div>
  );
}

function Hearts({ health, base }) {
  const hp = Math.max(0, Math.round(Number(health) || 0));
  return (
    <div className="hud-hearts">
      {Array.from({ length: 10 }, (_, i) => {
        const fill = hp >= (i + 1) * 2 ? "full" : hp === i * 2 + 1 ? "half" : null;
        return (
          <span key={i} style={{ backgroundImage: `url(${base}gui/sprites/hud/heart/container.png)` }}>
            {fill && <img className="hud-pixel" src={`${base}gui/sprites/hud/heart/${fill}.png`} alt="" />}
          </span>
        );
      })}
    </div>
  );
}

// Mod items counted across the hotbar, keyed by model and name, to notice pickups and uses.
const tally = (hotbar) => {
  const out = new Map();
  for (const i of hotbar || []) if (isModItem(i)) out.set(`${i.itemModel}|${label(i)}`, { item: i, count: (out.get(`${i.itemModel}|${label(i)}`)?.count || 0) + i.count });
  return out;
};

export default function Hud({ hud, viewerUrl }) {
  const base = `${viewerUrl}/textures/1.21.4/`;
  const [toast, setToast] = React.useState(null);
  const prev = React.useRef(null);

  React.useEffect(() => {
    const now = tally(hud?.hotbar);
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    let next = null;
    for (const [k, v] of now) if (v.count > (before.get(k)?.count || 0)) next = { verb: "Picked up", item: v.item };
    for (const [k, v] of before) if (v.count > (now.get(k)?.count || 0)) next = next || { verb: "Used", item: v.item };
    if (!next) return;
    setToast({ ...next, at: Date.now() });
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [hud]);

  if (!hud || !viewerUrl) return null;
  const effects = hud.effects || [];
  return (
    <div className="hud" style={{ "--s": S }}>
      {hud.bossBars?.length > 0 && (
        <div className="hud-top">
          {hud.bossBars.slice(0, 3).map((b, i) => (
            <BossBar key={i} bar={b} base={base} />
          ))}
        </div>
      )}
      {toast && (
        <div key={toast.at} className="hud-toast">
          <ItemIcon item={toast.item} base={base} size={48} />
          <div>
            <small>{toast.verb}</small>
            <strong>{label(toast.item)}</strong>
            <code>{toast.item.itemModel}</code>
          </div>
        </div>
      )}
      {(effects.length > 0 || hud.ground?.length > 0) && (
        <div className={`hud-side ${hud.bossBars?.length ? "below-boss" : ""}`}>
          {effects.map((e) => (
            <div key={e.name} className="hud-chip">
              <img className="hud-pixel" src={`${base}mob_effect/${snake(e.name)}.png`} alt="" width={18} height={18} />
              <span>
                {title(e.name)} {ROMAN[e.level] || e.level}
              </span>
            </div>
          ))}
          {hud.ground?.map((g) => (
            <div key={g.id} className={`hud-chip ${isModItem(g.item) ? "mod" : ""}`} title={g.item.itemModel || ""}>
              <ItemIcon item={g.item} base={base} size={20} />
              <span>{label(g.item)} on the ground</span>
              <em>{Math.round(g.distance)} m</em>
            </div>
          ))}
        </div>
      )}
      <div className="hud-bottom">
        {hud.actionbar && <span className="hud-text hud-actionbar">{hud.actionbar}</span>}
        <Hearts health={hud.health} base={base} />
        <div className="hud-hotbar" style={{ backgroundImage: `url(${base}gui/sprites/hud/hotbar.png)` }}>
          <img
            className="hud-pixel hud-selection"
            src={`${base}gui/sprites/hud/hotbar_selection.png`}
            alt=""
            style={{ left: `calc(${(hud.selected ?? 0) * 20 - 1}px * var(--s))` }}
          />
          {hud.hotbar.map(
            (item, i) =>
              item && (
                <span
                  key={i}
                  className={`hud-slot ${isModItem(item) ? "mod" : ""}`}
                  style={{ left: `calc(${3 + i * 20}px * var(--s))` }}
                  title={`${label(item)}${item.itemModel ? ` · ${item.itemModel}` : ""}`}
                >
                  <ItemIcon item={item} base={base} />
                  {item.count > 1 && <b>{item.count}</b>}
                </span>
              ),
          )}
        </div>
      </div>
    </div>
  );
}

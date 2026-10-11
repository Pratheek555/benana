// Detects edits to main-process code after launch. Electron loads these files once, so a change only takes
// effect after a restart; until then Benana would build and playtest mods with the old pipeline.
// host.cjs and mcp-minecraft.cjs are left out: they are spawned fresh for every deploy and playtest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FRESH = new Set(['lib/game/host.cjs', 'mcp-minecraft.cjs']);

function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.cjs')) {
        const rel = path.relative(root, full).replaceAll('\\', '/');
        if (!FRESH.has(rel)) out.set(rel, crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(root);
  return out;
}

function watch(root, onChange) {
  const boot = snapshot(root);
  let changed = [];
  let timer = null;
  const check = () => {
    let now;
    try { now = snapshot(root); } catch { return; }
    const next = [...new Set([...boot.keys(), ...now.keys()])].filter((f) => boot.get(f) !== now.get(f)).sort();
    if (next.join() === changed.join()) return;
    changed = next;
    onChange(state());
  };
  const state = () => ({ stale: changed.length > 0, changed });
  try {
    fs.watch(root, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(check, 400); });
  } catch {
    setInterval(check, 5000);
  }
  return { state };
}

module.exports = { watch };

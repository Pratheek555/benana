import React from "react";
import GamePane from "../game/GamePane.jsx";
import "./studio.css";

// Mod Studio shell. Owner: Track B. The prompt, checklist, and attempts panels are placeholders.
export default function ModStudio({ onOpenWorkspace }) {
  return (
    <div className="studio">
      <aside className="studio-side">
        <div className="studio-brand">
          <span className="brand">B</span>
          <strong>Mod Studio</strong>
        </div>
        <p className="studio-muted">
          Describe a mod. Benana builds it, plays it, and fixes what breaks.
        </p>
        <button className="studio-link" onClick={onOpenWorkspace}>
          Open repository workspace
        </button>
      </aside>
      <main className="studio-main">
        <GamePane />
      </main>
      <aside className="studio-inspector">
        <h3>Test plan</h3>
        <p className="studio-muted">No mod yet.</p>
      </aside>
    </div>
  );
}

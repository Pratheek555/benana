// Mod Studio pipeline: prompt -> spec/test plan -> build -> deploy -> playtest -> fix -> retry.
// Owner: Track B. Interface with the game runtime: docs/hackathon/CONTRACTS.md.

function handlers({ emit, log }) {
  void emit;
  void log;
  return {
    'studio:list': () => [],
  };
}

module.exports = { handlers };

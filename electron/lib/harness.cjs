// The harness itself is versioned data (Loop 4 edits it). Stored in the harness repo.
const DEFAULT = {
  version: 1,
  agent: 'claude',
  systemPrompt: [
    'You are working inside the Benana harness.',
    'Before planning, call intent_context with the task. Before editing, call intent_check with your plan and files.',
    'If intent_check reports a conflict, change approach or explain why the past reason no longer applies.',
    'When you make a meaningful choice, call intent_record (Decision). When an approach fails, record a DeadEnd.',
  ].join('\n'),
  rules: [],
  graders: { testCommand: '', maxAttempts: 2, intentCheck: true, maxFilesChanged: 15 },
};

function load(store) {
  const raw = store.read('harness.json');
  return raw ? { ...DEFAULT, ...JSON.parse(raw), graders: { ...DEFAULT.graders, ...(JSON.parse(raw).graders || {}) } } : { ...DEFAULT };
}

async function ensure(store) {
  if (!store.read('harness.json')) {
    store.write('harness.json', DEFAULT);
    await store.commit('harness v1 (default)', 'system');
  }
  return load(store);
}

function systemPrompt(h) {
  return [h.systemPrompt, ...h.rules.map((r) => `- ${r}`)].join('\n');
}

module.exports = { load, ensure, systemPrompt, DEFAULT };

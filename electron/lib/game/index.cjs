// Game runtime: local Paper server, the Mineflayer test bot, and the in-app viewer.
// Owner: Track A. Interface: docs/hackathon/CONTRACTS.md.
// BENANA_GAME_MOCK=1 returns canned results so the studio pipeline can be built before the real runtime lands.
const fs = require('node:fs');
const path = require('node:path');
const { appRoot } = require('../env.cjs');

const VERSION = '1.21.4';
const MCP = path.join(appRoot, 'electron', 'mcp-minecraft.cjs');
const mock = () => process.env.BENANA_GAME_MOCK === '1';

const TOOLS = [
  'game_setup', 'bot_state', 'nearby_entities', 'equip', 'look_at', 'move_to', 'attack',
  'use_item', 'track_entity', 'wait_ticks', 'chat', 'read_chat', 'server_log', 'report_check', 'finish',
];
const playtesterTools = TOOLS.map((t) => `mcp__minecraft__${t}`);

let state = { server: 'stopped', bot: 'offline', viewerUrl: null, controlUrl: null, version: VERSION, mock: mock(), error: null };
let emitter = () => {};

function setState(patch) {
  state = { ...state, ...patch, mock: mock() };
  emitter('game:status', state);
  return state;
}

const status = () => ({ ...state, mock: mock() });

async function start(emit = () => {}) {
  emitter = emit;
  if (mock()) return setState({ server: 'running', bot: 'online' });
  throw new Error('Game runtime not implemented yet (Track A). Set BENANA_GAME_MOCK=1.');
}

async function stop() {
  if (mock()) return setState({ server: 'stopped', bot: 'offline' });
  return setState({ server: 'stopped', bot: 'offline', viewerUrl: null, controlUrl: null });
}

async function deployPlugin({ jarPath }) {
  if (!fs.existsSync(jarPath)) return { loaded: false, plugin: null, errors: [`Jar not found: ${jarPath}`], logTail: [] };
  if (mock()) return { loaded: true, plugin: path.basename(jarPath, '.jar'), errors: [], logTail: ['[mock] plugin enabled'] };
  throw new Error('deployPlugin not implemented yet (Track A).');
}

async function runCommand(command) {
  if (mock()) return `[mock] ${command}`;
  throw new Error('runCommand not implemented yet (Track A).');
}

function mcpConfig({ runId, verdictFile, testPlanFile }) {
  return {
    mcpServers: {
      minecraft: {
        command: 'node',
        args: [MCP],
        env: {
          BENANA_GAME_URL: state.controlUrl || '',
          BENANA_VERDICT_FILE: verdictFile,
          BENANA_TEST_PLAN: testPlanFile,
          BENANA_RUN_ID: String(runId),
        },
      },
    },
  };
}

function playtestPrompt(testPlan) {
  return [
    'You are a Minecraft playtester. You control a real player bot on a local Paper server through the `minecraft` tools.',
    `Mod under test: ${testPlan.modName}: ${testPlan.summary}`,
    'Run `game_setup` with the setup commands, then perform every check like a player would and measure the outcome with tools.',
    'Call `report_check` once per check with what you expected, what you observed, and evidence. Check `server_log` for plugin errors.',
    'Finish with `finish`. Do not edit files.',
    '',
    'Test plan:',
    JSON.stringify(testPlan, null, 2),
  ].join('\n');
}

function readVerdict(verdictFile) {
  let v;
  try { v = JSON.parse(fs.readFileSync(verdictFile, 'utf8')); }
  catch (e) { return { version: 1, finished: false, passed: false, checks: [], serverErrors: [], error: `No verdict: ${e.message}` }; }
  const checks = Array.isArray(v.checks) ? v.checks : [];
  const serverErrors = Array.isArray(v.serverErrors) ? v.serverErrors : [];
  const finished = v.finished === true;
  return { ...v, checks, serverErrors, finished, passed: finished && checks.length > 0 && checks.every((c) => c.status === 'pass') && serverErrors.length === 0 };
}

function mockVerdict(testPlan, attempt) {
  const checks = (testPlan.checks || []).map((c, i) => {
    const failing = attempt <= 1 && i === 0;
    return {
      id: c.id,
      status: failing ? 'fail' : 'pass',
      expected: c.expect,
      observed: failing ? '[mock] max upward velocity 0.0; mob took damage but stayed grounded' : '[mock] matched expectation',
      evidence: { samples: [], serverLog: [] },
      ...(failing ? { suspectedCause: '[mock] velocity is overwritten by knockback after the damage event' } : {}),
    };
  });
  return { version: 1, runId: `mock_${attempt}`, finished: true, passed: checks.every((c) => c.status === 'pass'), summary: '[mock verdict]', checks, serverErrors: [] };
}

function handlers(emit) {
  emitter = emit;
  return {
    'game:status': () => status(),
    'game:start': () => start(emit),
    'game:stop': () => stop(),
    'game:command': ({ command }) => runCommand(command),
  };
}

module.exports = {
  VERSION, status, start, stop, deployPlugin, runCommand,
  mcpConfig, playtesterTools, playtestPrompt, readVerdict, mockVerdict, handlers,
};

#!/usr/bin/env node
// Benana intent MCP server (stdio, newline-delimited JSON-RPC).
// Gives any Claude Code / Codex session three tools over the local intent graph:
//   intent_context, intent_check, intent_record, intent_why
// Env: BENANA_INTENT_DIR (intent repo on disk), BENANA_ATTEMPT (optional attempt id).
const readline = require('node:readline');
const { RepoStore } = require('./lib/store.cjs');
const graph = require('./lib/graph.cjs');
const codeGraph = require('./lib/code-graph.cjs');

const dir = process.env.BENANA_INTENT_DIR;
const attempt = process.env.BENANA_ATTEMPT || 'external';
const store = Object.assign(Object.create(RepoStore.prototype), { dir, kind: 'intent', repo: 'local', name: 'local' });

const tools = [
  {
    name: 'intent_context',
    description: 'Before planning: get past decisions, dead ends and project directions relevant to a task and/or files. Use this first.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['task'] },
  },
  {
    name: 'intent_check',
    description: 'Before editing: check a plan (and the files it touches) against past dead ends and decisions. Returns conflicts with sources.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['plan'] },
  },
  {
    name: 'intent_record',
    description: 'Record your intent so future contributors see it: a Decision you made (with reason), a DeadEnd you hit, or an Intent you are pursuing.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['Decision', 'DeadEnd', 'Intent'] },
        title: { type: 'string' }, reason: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
      },
      required: ['type', 'title', 'reason'],
    },
  },
  {
    name: 'intent_why',
    description: 'Before changing a file: why is it the way it is? Returns the decisions, dead ends and agent runs that touched it, oldest first, plus recent history of the files it imports or changes together with.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Repository-relative path' } }, required: ['file'] },
  },
];

async function call(name, a) {
  const g = graph.loadGraph(store);
  if (name === 'intent_context') return graph.context(g, { text: a.task, files: a.files || [] });
  if (name === 'intent_check') {
    const conflicts = graph.check(g, { text: a.plan, files: a.files || [], attempt });
    return { ok: conflicts.length === 0, conflicts };
  }
  if (name === 'intent_record') {
    const node = graph.record(store, { type: a.type, title: a.title, reason: a.reason, touches: a.files || [], source: `agent:${attempt}`, attempt });
    return { recorded: node.id };
  }
  if (name === 'intent_why') {
    // The agent runs in the checkout, so Entire's code graph is read from the working directory.
    const code = await codeGraph.snapshot(process.cwd()).catch(() => ({ links: [] }));
    return codeGraph.why(g, code, a.file);
  }
  throw new Error(`unknown tool ${name}`);
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = req;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'benana-intent', version: '0.1.0' } } });
    } else if (method === 'tools/list') {
      send({ id, result: { tools } });
    } else if (method === 'tools/call') {
      const out = await call(params.name, params.arguments || {});
      send({ id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
    } else if (method === 'ping') {
      send({ id, result: {} });
    } else {
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
  }
});

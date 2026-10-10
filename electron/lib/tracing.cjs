// Neatlogs tracing. Benana's LLM work happens in `claude` / `codex` subprocesses, so there is
// no in-process SDK client to wrap(); instead each entry point gets a WORKFLOW root and the
// agent's streamed events are recorded as AGENT / TOOL / GUARDRAIL / LLM spans.
// Export is a no-op when NEATLOGS_API_KEY is unset.
const neatlogs = require('neatlogs');
const { env } = require('./env.cjs');

let ready = null;

function init() {
  if (!ready) {
    ready = neatlogs.init({
      apiKey: env('NEATLOGS_API_KEY') || undefined,
      endpoint: env('NEATLOGS_ENDPOINT', 'https://ingest.neatlogs.com'),
      workflowName: 'benana-harness',
    }).catch((e) => console.warn(`neatlogs init failed: ${e.message}`));
  }
  return ready;
}

// Root span for one entry point (an agent run, an extraction, an analyst pass).
function workflow(name, { input, sessionId, entryPoint } = {}, fn) {
  return neatlogs.trace({ name, kind: 'WORKFLOW', input, sessionId, sessionEntryPoint: entryPoint || name }, fn);
}

// The active span as a W3C carrier, so later child spans (created from process callbacks,
// where async context is lost) can be parented explicitly with under().
function capture() {
  const carrier = {};
  try { neatlogs.injectTraceContext(carrier); } catch { /* tracing off */ }
  const traceId = (carrier.traceparent || '').split('-')[1] || null;
  return { carrier, traceId };
}

const under = (ref, fn) => (ref?.carrier?.traceparent ? neatlogs.extractTraceContext(ref.carrier, fn) : fn());

function agent(name, input, fn) {
  return neatlogs.trace({ name, kind: 'AGENT', input }, fn);
}

// Model and token counts reported by the agent CLI (claude stream-json / codex exec --json).
function setUsage(span, { model, provider, usage = {} }) {
  if (model) span.setAttribute('neatlogs.llm.model_name', model);
  if (provider) span.setAttribute('neatlogs.llm.provider', provider);
  const prompt = usage.inputTokens;
  const completion = usage.outputTokens;
  if (prompt != null) span.setAttribute('neatlogs.llm.token_count.prompt', prompt);
  if (completion != null) span.setAttribute('neatlogs.llm.token_count.completion', completion);
  if (prompt != null || completion != null) span.setAttribute('neatlogs.llm.token_count.total', (prompt || 0) + (completion || 0));
  if (usage.cacheRead != null) span.setAttribute('neatlogs.llm.token_count.cache_read', usage.cacheRead);
  if (usage.costUsd != null) span.setAttribute('benana.cost_usd', usage.costUsd);
}

function llm(name, { model, provider, input }, fn) {
  return neatlogs.trace({ name, kind: 'LLM', input }, async (span) => {
    const out = await fn(span);
    setUsage(span, { model, provider, usage: out?.usage });
    return out;
  });
}

// A tool call seen in the agent's event stream. The span stays open until the returned
// end(output) is called (when the tool result arrives), so its duration is real.
function openTool(parent, name, input) {
  let end;
  const done = new Promise((resolve) => { end = resolve; });
  under(parent, () => neatlogs.trace({ name, kind: 'TOOL', input }, async (span) => {
    span.setAttribute('neatlogs.tool.name', name);
    const output = await done;
    if (output !== undefined) setOutput(output);
    return output;
  })).catch(() => {});
  return end;
}

function guardrail(name, input, result) {
  return neatlogs.trace({ name, kind: 'GUARDRAIL', input }, (span) => {
    span.setAttribute('benana.grader.pass', Boolean(result.pass));
    if (!result.pass) span.setAttribute('neatlogs.error.message', String(result.detail).slice(0, 500));
    return result;
  });
}

const setOutput = (value) => { try { neatlogs.setTraceOutput(value); } catch { /* outside a trace */ } };

async function shutdown() {
  try { await neatlogs.flush(); await neatlogs.shutdown(); } catch { /* best effort on exit */ }
}

module.exports = { init, workflow, capture, under, agent, llm, openTool, guardrail, setUsage, setOutput, shutdown };

// Uses the user's local `claude` CLI (their own login) for one-shot LLM calls.
// No API key is required; if ANTHROPIC_API_KEY is set the CLI will use it.
const { spawn } = require('node:child_process');
const tracing = require('./tracing.cjs');

function askClaude(prompt, opts = {}) {
  return tracing.llm(opts.name || 'claude -p', { provider: 'anthropic', input: prompt }, async (span) => {
    const { value, usage, model } = await runClaude(prompt, opts);
    if (model) span.setAttribute('neatlogs.llm.model_name', model);
    tracing.setOutput(value);
    return { value, usage };
  }).then((r) => r.value);
}

function runClaude(prompt, { json = false, timeoutMs = 180000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--output-format', 'json'], { cwd, env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('claude timed out')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
      try {
        const res = JSON.parse(out);
        const text = res.result || '';
        const usage = { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens, cacheRead: res.usage?.cache_read_input_tokens, costUsd: res.total_cost_usd };
        const model = Object.keys(res.modelUsage || {})[0];
        if (!json) return resolve({ value: text, usage, model });
        const m = text.match(/\{[\s\S]*\}/);
        resolve({ value: m ? JSON.parse(m[0]) : null, usage, model });
      } catch (e) { reject(e); }
    });
    p.stdin.end(prompt);
  });
}

module.exports = { askClaude };

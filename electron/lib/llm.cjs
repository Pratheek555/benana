// Uses the user's local `claude` CLI (their own login) for one-shot LLM calls.
// No API key is required; if ANTHROPIC_API_KEY is set the CLI will use it.
// Every call is charged to the daily token budget.
const { spawn } = require('node:child_process');
const budget = require('./budget.cjs');

function askClaude(prompt, { json = false, timeoutMs = 180000, cwd, model, kind = 'llm' } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--tools', ''];
    if (model) args.push('--model', model);
    const p = spawn('claude', args, { cwd, env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('claude timed out')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().slice(0, 300) || `claude exited ${code}`));
      try {
        const res = JSON.parse(out);
        const u = res.usage || {};
        budget.charge(kind, (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
        const text = res.result || '';
        if (!json) return resolve(text);
        resolve(parseJSON(text));
      } catch (e) { reject(e); }
    });
    p.stdin.end(prompt);
  });
}

// Takes the first balanced JSON object or array out of a model reply.
function parseJSON(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

module.exports = { askClaude, parseJSON };

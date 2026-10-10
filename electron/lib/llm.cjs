// Uses the user's local `claude` CLI (their own login) for one-shot LLM calls.
// No API key is required; if ANTHROPIC_API_KEY is set the CLI will use it.
const { spawn } = require('node:child_process');

function askClaude(prompt, { json = false, timeoutMs = 180000, cwd } = {}) {
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
        const text = JSON.parse(out).result || '';
        if (!json) return resolve(text);
        const m = text.match(/\{[\s\S]*\}/);
        resolve(m ? JSON.parse(m[0]) : null);
      } catch (e) { reject(e); }
    });
    p.stdin.end(prompt);
  });
}

module.exports = { askClaude };

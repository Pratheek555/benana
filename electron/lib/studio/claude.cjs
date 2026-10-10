// Runs one headless Claude Code session and streams its activity.
// Sessions run inside the mod repo so the repo's Entire and Neatlogs hooks capture them.
const { spawnExecutable, terminateProcessTree } = require('../processes.cjs');
const { normalizeUsage } = require('../providers.cjs');

const MODELS = { build: 'opus', playtest: 'sonnet' };

function summarize(input) {
  const text = JSON.stringify(input ?? {});
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => c.text || '').join('\n');
  return JSON.stringify(content ?? '');
}

/**
 * @returns {{ done: Promise<{ok, sessionId, final, usage, error}>, stop: () => void }}
 */
function runClaude({ cwd, prompt, model, tools, allowedTools = [], mcpConfigFile, appendSystemPrompt, timeoutMs = 20 * 60 * 1000, onEvent = () => {} }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', 'acceptEdits', '--setting-sources', 'project,local'];
  if (tools) args.push('--tools', tools.join(','));
  if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
  if (mcpConfigFile) args.push('--mcp-config', mcpConfigFile, '--strict-mcp-config');
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnExecutable('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
  const run = { sessionId: null, final: '', usage: null, error: null, stopped: false };
  const names = new Map();

  const done = new Promise((resolve) => {
    let buf = '';
    let stderr = '';
    const timer = setTimeout(() => { run.error = `Timed out after ${Math.round(timeoutMs / 60000)} minutes.`; terminateProcessTree(child); }, timeoutMs);
    const handle = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'system' && ev.session_id) {
        if (!run.sessionId) onEvent({ kind: 'session', sessionId: ev.session_id, model });
        run.sessionId = ev.session_id;
      } else if (ev.type === 'assistant') {
        for (const item of ev.message?.content || []) {
          if (item.type === 'text' && item.text.trim()) onEvent({ kind: 'text', text: item.text.trim() });
          if (item.type === 'tool_use') {
            names.set(item.id, item.name);
            onEvent({ kind: 'tool', name: item.name.replace(/^mcp__\w+?__/, ''), input: item.input, summary: summarize(item.input) });
          }
        }
      } else if (ev.type === 'user') {
        for (const item of ev.message?.content || []) {
          if (item.type !== 'tool_result') continue;
          const name = (names.get(item.tool_use_id) || 'tool').replace(/^mcp__\w+?__/, '');
          onEvent({ kind: 'result', name, isError: Boolean(item.is_error), text: resultText(item.content).slice(0, 1500) });
        }
      } else if (ev.type === 'result') {
        run.final = ev.result || '';
        run.usage = normalizeUsage(ev.usage, ev);
        if (ev.is_error) run.error = String(ev.result || 'Claude reported an error.');
      }
    };
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.filter(Boolean).forEach(handle);
    });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    child.on('error', (e) => { run.error = `Could not start Claude Code: ${e.message}`; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) handle(buf);
      if (run.stopped) run.error = 'Stopped.';
      else if (code !== 0 && !run.error) run.error = stderr.trim() || `Claude exited with code ${code}.`;
      resolve({ ok: !run.error, sessionId: run.sessionId, final: run.final, usage: run.usage, error: run.error });
    });
  });

  child.stdin.end(prompt);
  return { done, stop: () => { run.stopped = true; terminateProcessTree(child); } };
}

module.exports = { runClaude, MODELS };

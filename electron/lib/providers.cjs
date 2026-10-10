const fs = require("node:fs");
const path = require("node:path");
const { dataDir, appRoot } = require("./env.cjs");
const harnessLib = require("./harness.cjs");

const MCP = path.join(appRoot, "electron", "mcp-server.cjs");
const STEP_TYPES = new Set(["command_execution", "mcp_tool_call", "file_change"]);

function agentCommand(run, harness, prompt) {
  const mcpEnv = {
    BENANA_INTENT_DIR: run.intentDir,
    BENANA_ATTEMPT: String(run.attempt),
    BENANA_RUN_ID: run.id,
  };
  if (run.kind === "codex") {
    const config = [
      "-c", 'mcp_servers.benana-intent.command="node"',
      "-c", `mcp_servers.benana-intent.args=[${JSON.stringify(MCP)}]`,
      "-c", `mcp_servers.benana-intent.env={BENANA_INTENT_DIR=${JSON.stringify(run.intentDir)},BENANA_ATTEMPT=${JSON.stringify(String(run.attempt))},BENANA_RUN_ID=${JSON.stringify(run.id)}}`,
    ];
    const args = run.sessionId
      ? ["exec", "resume", "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="workspace-write"', ...config, run.sessionId, "-"]
      : [
          "exec", "--json", "--sandbox", "workspace-write",
          "--skip-git-repo-check", "-C", run.worktree,
          ...config,
          "-",
        ];
    return { cmd: "codex", args, stdin: `${harnessLib.systemPrompt(harness)}\n\n${prompt}` };
  }

  const mcpFile = path.join(dataDir, "attempts", run.id, "mcp.json");
  fs.writeFileSync(mcpFile, JSON.stringify({
    mcpServers: { "benana-intent": { command: "node", args: [MCP], env: mcpEnv } },
  }));
  const args = [
    "-p", "--output-format", "stream-json", "--verbose", "--mcp-config", mcpFile,
    "--append-system-prompt", harnessLib.systemPrompt(harness),
    "--permission-mode", "acceptEdits", "--allowedTools",
    "mcp__benana-intent__intent_context,mcp__benana-intent__intent_check,mcp__benana-intent__intent_record,Read,Edit,Write,Glob,Grep,Bash",
  ];
  if (run.sessionId) args.push("--resume", run.sessionId);
  return { cmd: "claude", args, stdin: prompt };
}

function normalizeUsage(usage = {}, event = {}) {
  return {
    inputTokens: usage.inputTokens ?? usage.input_tokens ?? usage.input_tokens_count ?? 0,
    outputTokens: usage.outputTokens ?? usage.output_tokens ?? usage.output_tokens_count ?? 0,
    cacheReadInputTokens: usage.cacheReadInputTokens ?? usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens ?? 0,
    costUsd: event.total_cost_usd ?? usage.costUsd ?? usage.cost_usd ?? usage.total_cost_usd ?? 0,
  };
}

function recordToolFailure(run, label, content) {
  run.failedSteps ||= [];
  run.failedSteps.push({ label, text: String(content || "Tool failed").slice(0, 2000), source: "local" });
}

function handleEvent(run, line, hooks) {
  let event;
  try { event = JSON.parse(line); }
  catch { hooks.say("agent", line); return; }

  if (event.type === "turn.completed") run.usage = normalizeUsage(event.usage, event);
  if (event.type === "item.started" && STEP_TYPES.has(event.item?.type)) run.step += 1;
  if (event.type === "system" && event.session_id) run.sessionId = event.session_id;
  else if (event.type === "thread.started" && event.thread_id) run.sessionId = event.thread_id;
  else if (event.type === "turn.failed" || event.type === "error" || (event.type === "result" && event.is_error)) {
    run.terminalFailure = String(event.error?.message || event.message || event.result || "The agent reported a terminal failure.");
  } else if (event.type === "assistant") {
    for (const item of event.message?.content || []) {
      if (item.type === "text" && item.text.trim()) hooks.say("agent", item.text);
      if (item.type === "tool_use") {
        run.step += 1;
        hooks.say("tool", `${item.name} ${JSON.stringify(item.input).slice(0, 220)}`);
      }
      if (item.type === "tool_result" && item.is_error) recordToolFailure(run, item.tool_use_id || "Claude tool", item.content);
    }
  } else if (event.type === "user") {
    for (const item of event.message?.content || []) if (item.type === "tool_result") {
      hooks.say("tool", String(item.content || "Tool result").slice(0, 2000));
      if (item.is_error) recordToolFailure(run, item.tool_use_id || "Claude tool", item.content);
    }
  } else {
    const item = event.item || event.msg;
    if (item?.type === "agent_message" && item.text) { run.final = item.text; hooks.say("agent", item.text); }
    if (STEP_TYPES.has(item?.type)) hooks.say("tool", String(item.command || item.server || item.type));
    if (item?.type === "command_execution" && event.type === "item.completed" && item.exit_code != null && item.exit_code !== 0)
      recordToolFailure(run, "Codex command", `${item.command || "command"} exited ${item.exit_code}`);
    if (event.type === "result") { run.final = event.result || ""; run.usage = normalizeUsage(event.usage, event); }
  }
  hooks.update();
}

module.exports = { agentCommand, handleEvent, normalizeUsage };

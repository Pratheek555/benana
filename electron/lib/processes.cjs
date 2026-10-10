const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

function resolveExecutable(command, platform = process.platform) {
  if (
    path.isAbsolute(command) ||
    command.includes("/") ||
    command.includes("\\")
  )
    return command;
  const finder = platform === "win32" ? "where.exe" : "which";
  const found = spawnSync(finder, [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (found.status !== 0) return command;
  const choices = found.stdout
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (platform === "win32") {
    // `where` also lists extensionless Unix shims (npm, Maven) that Windows cannot execute.
    const runnable = choices.filter((x) => /\.(exe|com|cmd|bat)$/i.test(x));
    return runnable.find((x) => /\.(exe|com)$/i.test(x)) || runnable[0] || command;
  }
  return choices.find((x) => !/\.(cmd|bat)$/i.test(x)) || choices[0] || command;
}

function spawnExecutable(command, args, options = {}) {
  const platform = options.platform || process.platform;
  const executable = resolveExecutable(command, platform);
  const spawnOptions = { ...options };
  delete spawnOptions.platform;
  spawnOptions.windowsHide = true;
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    const script =
      "& { $tool = $args[0]; $toolArgs = @($args | Select-Object -Skip 1); & $tool @toolArgs; exit $LASTEXITCODE }";
    return spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
        executable,
        ...args,
      ],
      spawnOptions,
    );
  }
  return spawn(executable, args, spawnOptions);
}

function runCommand(
  command,
  cwd,
  { timeoutMs = 10 * 60 * 1000, spawnFn = spawn, onSpawn } = {},
) {
  return new Promise((resolve) => {
    const shell =
      process.platform === "win32"
        ? {
            cmd: process.env.ComSpec || "cmd.exe",
            args: ["/d", "/s", "/c", command],
          }
        : { cmd: "/bin/sh", args: ["-c", command] };
    let child;
    try {
      child = spawnFn(shell.cmd, shell.args, {
        cwd,
        env: process.env,
        windowsHide: true,
      });
      onSpawn?.(child);
    } catch (error) {
      return resolve({ code: null, error: error.message, tail: error.message });
    }
    let output = "";
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        tail:
          output.trim().split(/\r?\n/).slice(-12).join("\n") ||
          result.error ||
          "",
      });
    };
    child.stdout?.on("data", (data) => {
      output += data;
    });
    child.stderr?.on("data", (data) => {
      output += data;
    });
    child.once("error", (error) =>
      finish({ code: null, error: error.message }),
    );
    child.once("close", (code) => finish({ code }));
    timer = setTimeout(() => {
      terminateProcessTree(child);
      finish({
        code: null,
        error: `verification timed out after ${timeoutMs}ms`,
        timedOut: true,
      });
    }, timeoutMs);
  });
}

function copyWorkspace(source, target) {
  const root = path.resolve(target);
  for (const name of fs.readdirSync(root)) {
    if (name === ".git") continue;
    const entry = path.resolve(root, name);
    if (path.dirname(entry) !== root)
      throw new Error(`Refusing to remove path outside retry workspace: ${entry}`);
    fs.rmSync(entry, { recursive: true, force: true });
  }
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => path.basename(entry) !== ".git",
  });
}

function terminateProcessTree(child, platform = process.platform) {
  if (!child || child.exitCode != null || child.killed) return;
  if (platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try { child.kill("SIGTERM"); } catch {}
}

module.exports = {
  copyWorkspace,
  resolveExecutable,
  runCommand,
  spawnExecutable,
  terminateProcessTree,
};

// Thin promise wrapper over the native git binary.
const { execFile } = require('node:child_process');

function git(cwd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...opts.env } }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`git ${args[0]}: ${stderr || err.message}`));
      resolve(stdout);
    });
  });
}

module.exports = { git };

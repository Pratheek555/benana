// Runs Electron for `npm run dev`. When the app exits with RESTART_CODE (the in-app Restart button),
// Electron is started again, so main-process code reloads without stopping Vite or concurrently.
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const RESTART_CODE = 75;
let child = null;

function run() {
  child = spawn(electron, ['.'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, BENANA_DEV: '1', BENANA_RESTARTABLE: '1' },
  });
  child.on('exit', (code) => {
    if (code === RESTART_CODE) {
      console.log('[benana] restarting Electron to load new code');
      return run();
    }
    process.exit(code ?? 0);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill(); process.exit(0); });
run();

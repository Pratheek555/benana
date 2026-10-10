// Loads the project .env from the repo root.
const path = require('node:path');
const os = require('node:os');
const dotenv = require('dotenv');

const appRoot = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(appRoot, '.env'), quiet: true });

const dataDir = process.env.BENANA_DATA_DIR || path.join(os.homedir(), '.benana');

module.exports = {
  appRoot,
  dataDir,
  env: (k, fallback = '') => process.env[k] || fallback,
};

// Process entry point and the only file that opens a port: validate config,
// check the database, listen, and shut down gracefully on SIGINT/SIGTERM.

import 'dotenv/config';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
// Validated (zod) when it loads: an invalid rule set stops startup here. The
// chat endpoint is the engine's caller.
import './config/riskRules.js';
import { closePool, initPool, query, setDbLogger } from './db/pool.js';
import { createLogger } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  // No logger yet (it is configured from this config); print names only, never values.
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}

const logger = createLogger(config.log);
initPool({ ...config.db, applicationName: 'revivecare-api' });
setDbLogger(logger);

try {
  await query('SELECT 1');
} catch (err) {
  logger.fatal({ err: err.message }, 'database unreachable at startup');
  await closePool();
  process.exit(1);
}

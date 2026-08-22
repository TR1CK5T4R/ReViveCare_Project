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

const app = createApp({ config, logger });
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'ReviveCare API listening');
});
server.on('error', (err) => {
  logger.fatal({ err }, 'server failed to start');
  process.exit(1);
});

let shuttingDown = false;
function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'shutting down');
  // If in-flight requests don't finish in time, exit anyway.
  setTimeout(() => {
    logger.error('graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // Stop accepting connections; the callback runs once in-flight requests finish.
  server.close(async (err) => {
    app.locals.sessionStore.close(); // stops the expired-session pruning timer
    await closePool();
    logger.info('shutdown complete');
    process.exit(err ? 1 : exitCode);
  });
  // Idle keep-alive connections would otherwise hold server.close() open.
  server.closeIdleConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  shutdown('uncaughtException', 1);
});

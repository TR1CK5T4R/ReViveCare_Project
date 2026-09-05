// Builds the real app with test configuration. Only TEST_DATABASE_URL comes
// from the environment; everything else is fixed here so tests don't depend
// on a developer's .env.

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/utils/logger.js';

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    SESSION_SECRET: 'test-session-secret-0123456789abcdefghij',
    CSRF_SECRET: 'test-csrf-secret-0123456789abcdefghijklmn',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** @returns {{ app: import('express').Express, config: object }} */
export function makeApp(overrides = {}) {
  const config = testConfig(overrides);
  return { app: createApp({ config, logger: createLogger(config.log) }), config };
}

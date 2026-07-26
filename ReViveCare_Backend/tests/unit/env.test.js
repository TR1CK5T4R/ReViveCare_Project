import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/env.js';

const minimal = {
  DATABASE_URL: 'postgresql://revivecare@localhost:5432/revivecare_test',
  SESSION_SECRET: 'x'.repeat(32),
  CSRF_SECRET: 'y'.repeat(32),
};

function issuesFor(env) {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err.issues;
  }
  throw new Error('expected loadConfig to throw');
}

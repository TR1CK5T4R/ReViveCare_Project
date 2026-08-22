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

describe('loadConfig', () => {
  it('lists every missing required variable by name', () => {
    const issues = issuesFor({});
    expect(issues).toEqual([
      'DATABASE_URL: is required but not set',
      'SESSION_SECRET: is required but not set',
      'CSRF_SECRET: is required but not set',
    ]);
  });

  it('reports invalid values without echoing them', () => {
    const issues = issuesFor({ ...minimal, SESSION_SECRET: 'short-secret', PORT: 'abc', NODE_ENV: 'staging' });
    expect(issues.map((i) => i.split(':')[0]).sort()).toEqual(['NODE_ENV', 'PORT', 'SESSION_SECRET']);
    expect(issues.join('\n')).not.toContain('short-secret');
  });

  it('rejects a non-Postgres DATABASE_URL', () => {
    expect(issuesFor({ ...minimal, DATABASE_URL: 'mysql://x/y' })[0]).toMatch(/^DATABASE_URL:/);
  });

});

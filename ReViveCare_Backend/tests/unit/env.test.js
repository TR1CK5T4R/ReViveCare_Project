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

  it('applies Django defaults for hosts, CORS and CSRF origins', () => {
    const config = loadConfig(minimal);
    expect(config.allowedHosts).toEqual(['localhost', '127.0.0.1']);
    expect(config.cors.allowedOrigins).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
    ]);
    expect(config.csrf.trustedOrigins).toEqual(config.cors.allowedOrigins);
    expect(config.session).toMatchObject({ cookieName: 'sessionid', maxAgeSeconds: 86400, cookieSecure: false });
    expect(config.csrf).toMatchObject({
      cookieName: 'csrftoken',
      headerName: 'x-csrftoken',
      cookieMaxAgeSeconds: 31449600,
    });
  });

  it('splits lists like Django (no trimming) and rejects malformed origins', () => {
    expect(loadConfig({ ...minimal, ALLOWED_HOSTS: 'a.test,b.test' }).allowedHosts).toEqual(['a.test', 'b.test']);
    expect(issuesFor({ ...minimal, CORS_ALLOWED_ORIGINS: 'http://ok.test, http://space.test' })).toEqual([
      'CORS_ALLOWED_ORIGINS: " http://space.test" is not an origin like http://host:port',
    ]);
  });

});

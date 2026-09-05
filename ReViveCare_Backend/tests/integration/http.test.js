// Cross-cutting HTTP behaviour: 404s, APPEND_SLASH, headers, CORS, hosts, health.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePool, initPool } from '../../src/db/pool.js';
import { NOT_FOUND } from '../helpers/djangoPages.js';
import { makeApp } from '../helpers/app.js';

let app;
beforeAll(() => {
  ({ app } = makeApp());
});

describe('404 and APPEND_SLASH (Django DEBUG=False)', () => {
  it("answers an unknown path with Django's exact 404 page", async () => {
    const res = await request(app).get('/no/such/page/');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.text).toBe(NOT_FOUND);
  });

  it.each(['get', 'post', 'put', 'delete'])(
    '301-redirects %s /csrf to /csrf/, keeping the query string',
    async (method) => {
      const res = await request(app)[method]('/csrf?a=1&b=2');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/csrf/?a=1&b=2');
      expect(res.text).toBe('');
    },
  );

  it('matches paths case-sensitively and never strips a slash', async () => {
    expect((await request(app).get('/CSRF/')).status).toBe(404);
    expect((await request(app).get('/api/health/')).status).toBe(404);
  });
});

describe('security headers', () => {
  it("mirrors Django's headers and adds no CORP or HSTS outside production", async () => {
    const res = await request(app).get('/csrf/');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends HSTS in production like Django's SECURE_HSTS_* settings", async () => {
    const { app: prod } = makeApp({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' });
    const res = await request(prod).get('/csrf/');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
  });
});

describe('CORS (django-cors-headers settings)', () => {
  it('allows a configured origin with credentials', async () => {
    const res = await request(app).get('/csrf/').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no CORS headers at all for other origins', async () => {
    const res = await request(app).get('/csrf/').set('Origin', 'http://evil.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it("answers a preflight with an empty 200 and Django's allowed methods/headers", async () => {
    const res = await request(app)
      .options('/patient/logout/')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-csrftoken, content-type');
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe('DELETE,GET,OPTIONS,PATCH,POST,PUT');
    expect(res.headers['access-control-allow-headers']).toBe(
      'accept,authorization,content-type,user-agent,x-csrftoken,x-requested-with',
    );
    expect(res.headers['access-control-max-age']).toBe('86400');
  });

  it('answers a preflight from another origin with an empty 200 and no CORS headers', async () => {
    const res = await request(app)
      .options('/patient/logout/')
      .set('Origin', 'http://evil.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('lets a plain OPTIONS (no Access-Control-Request-Method) reach the view, like Django', async () => {
    const res = await request(app).options('/patient/logout/');
    expect(res.status).toBe(302);
  });
});

describe('Host validation', () => {
  it("rejects a Host outside ALLOWED_HOSTS with Django's 400 page", async () => {
    const res = await request(app).get('/csrf/').set('Host', 'evil.test');
    expect(res.status).toBe(400);
    expect(res.text).toContain('<h1>Bad Request (400)</h1>');
  });
});

describe('GET /api/health', () => {
  afterEach(async () => {
    await closePool();
    initPool({ connectionString: process.env.TEST_DATABASE_URL, applicationName: 'revivecare-test' });
  });

  it('reports ok when the database answers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('reports 503 when the database is unreachable', async () => {
    await closePool();
    initPool({ connectionString: 'postgresql://revivecare@127.0.0.1:1/nowhere', connectionTimeoutMillis: 500 });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'error' });
  });
});

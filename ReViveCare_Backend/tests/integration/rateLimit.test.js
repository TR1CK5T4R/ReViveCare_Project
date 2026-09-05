// Login rate limiting: failed attempts only, per IP.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeApp } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';

beforeEach(async () => {
  await truncateAll();
});

const attempt = (app, email) => request(app).post('/login/').type('form').send({ email });

describe('POST /login/ rate limit', () => {
  it('blocks the attempt after LOGIN_RATE_LIMIT_MAX failed ones with 429', async () => {
    const { app } = makeApp({ LOGIN_RATE_LIMIT_MAX: '3' });
    for (let i = 0; i < 3; i += 1) expect((await attempt(app, `nobody${i}@example.test`)).status).toBe(302);
    const blocked = await attempt(app, 'nobody@example.test');
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain('Too many login attempts');
    expect(blocked.headers['ratelimit-policy']).toBeDefined();
  });

  it('does not count successful logins', async () => {
    await createPatient({ email: 'asha@example.test' });
    const { app } = makeApp({ LOGIN_RATE_LIMIT_MAX: '2' });
    for (let i = 0; i < 5; i += 1)
      expect((await attempt(app, 'asha@example.test')).headers.location).toBe('/patient/dashboard/');
    expect((await attempt(app, 'nobody@example.test')).status).toBe(302);
  });

  it('only limits /login/', async () => {
    const { app } = makeApp({ LOGIN_RATE_LIMIT_MAX: '1' });
    await attempt(app, 'nobody@example.test');
    expect((await attempt(app, 'nobody@example.test')).status).toBe(429);
    expect((await request(app).get('/csrf/')).status).toBe(200);
  });
});

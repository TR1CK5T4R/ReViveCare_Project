// E07 POST /login/, E09 /patient/logout/ against the real app and test database.
// (E03 /csrf/ is in home.test.js.)
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { makeApp } from '../helpers/app.js';
import { setCookies, sidFromCookieValue } from '../helpers/cookies.js';
import { createPatient, sessionData, truncateAll } from '../helpers/db.js';

const TRUSTED_ORIGIN = 'http://localhost:5173';

let app;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
});

/** Log in through the API with a cookie-keeping agent; returns the agent and response. */
async function login(email, agent = request.agent(app)) {
  const res = await agent.post('/login/').type('form').send({ email });
  return { agent, res };
}

/** GET /csrf/ and return the token value the frontend would read from document.cookie. */
async function csrfToken(agent) {
  const res = await agent.get('/csrf/');
  return decodeURIComponent(setCookies(res).csrftoken.value);
}

describe('POST /login/ (E07)', () => {
  it('logs in a known email: 302 to the dashboard, HttpOnly session cookie, Django session keys', async () => {
    const patient = await createPatient({ name: 'Asha Rao', email: 'asha@example.test' });
    const { res } = await login('asha@example.test');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/patient/dashboard/');
    expect(res.text).toBe('');
    const cookie = setCookies(res).sessionid;
    expect(cookie.attributes).toMatchObject({ path: '/', httponly: true, samesite: 'Lax' });
    expect(cookie.attributes.secure).toBeUndefined(); // only in production
    const lifetime = (Date.parse(cookie.attributes.expires) - Date.now()) / 1000;
    expect(lifetime).toBeGreaterThan(86400 - 60);
    expect(lifetime).toBeLessThanOrEqual(86400);
    const { cookie: _cookieMeta, ...data } = await sessionData(sidFromCookieValue(cookie.value));
    expect(data).toEqual({ patient_id: patient.id, patient_email: 'asha@example.test', patient_name: 'Asha Rao' });
  });

  it('adds Vary: Cookie on success (session accessed) but not on failure, like Django', async () => {
    await createPatient({ email: 'asha@example.test' });
    expect((await login('asha@example.test')).res.headers.vary).toMatch(/Cookie/);
    expect((await login('nobody@example.test')).res.headers.vary ?? '').not.toMatch(/Cookie/);
  });

  it('normalises the email like Python strip().lower()', async () => {
    await createPatient({ email: 'asha@example.test' });
    const { res } = await login('\x1c  Asha@Example.TEST \x85');
    expect(res.headers.location).toBe('/patient/dashboard/');
  });

  it('never matches a stored email with capitals (a legacy Django quirk)', async () => {
    await createPatient({ email: 'Mixed@Example.test' });
    const { res } = await login('Mixed@Example.test');
    expect(res.headers.location).toBe('/');
  });

});

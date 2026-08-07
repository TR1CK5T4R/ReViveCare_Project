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

  it('redirects an unknown email to / without setting a session cookie', async () => {
    const { res } = await login('nobody@example.test');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(setCookies(res).sessionid).toBeUndefined();
    expect((await query('SELECT count(*) AS n FROM sessions')).rows[0].n).toBe(0);
  });

  it('ignores the password field (email-only login)', async () => {
    await createPatient({ email: 'asha@example.test' });
    const res = await request(app).post('/login/').type('form').send({ email: 'asha@example.test', password: 'wrong' });
    expect(res.headers.location).toBe('/patient/dashboard/');
  });

  it('uses the last value of a repeated email field, like QueryDict.get', async () => {
    await createPatient({ email: 'second@example.test' });
    const res = await request(app)
      .post('/login/')
      .type('form')
      .send('email=first%40example.test&email=second%40example.test');
    expect(res.headers.location).toBe('/patient/dashboard/');
  });

  it('answers 500 for a NUL byte in the email, like Django on Postgres', async () => {
    await createPatient({ email: 'asha@example.test' });
    const res = await request(app).post('/login/').type('form').send('email=asha%00%40example.test');
    expect(res.status).toBe(500);
    expect(res.text).toContain('<h1>Server Error (500)</h1>');
    expect(setCookies(res).sessionid).toBeUndefined();
  });

  it('treats a JSON body as an empty email (Django reads request.POST only)', async () => {
    await createPatient({ email: 'asha@example.test' });
    const res = await request(app).post('/login/').send({ email: 'asha@example.test' });
    expect(res.headers.location).toBe('/');
  });

  it('needs no CSRF token (@csrf_exempt)', async () => {
    await createPatient({ email: 'asha@example.test' });
    const res = await request(app)
      .post('/login/')
      .set('Origin', 'http://evil.test')
      .type('form')
      .send({ email: 'asha@example.test' });
    expect(res.headers.location).toBe('/patient/dashboard/');
  });

  it('regenerates the session on success: new id, old row and data gone', async () => {
    const asha = await createPatient({ email: 'asha@example.test' });
    const ravi = await createPatient({ email: 'ravi@example.test' });
    const { agent, res: first } = await login('asha@example.test');
    const firstSid = sidFromCookieValue(setCookies(first).sessionid.value);
    // Simulate chat history left by the first patient.
    await query(
      `UPDATE sessions SET sess = jsonb_set(sess::jsonb, '{chat_history}', '[{"role":"user","content":"x"}]')::json WHERE sid = $1`,
      [firstSid],
    );

    const { res: second } = await login('ravi@example.test', agent);
    const secondSid = sidFromCookieValue(setCookies(second).sessionid.value);
    expect(secondSid).not.toBe(firstSid);
    expect(await sessionData(firstSid)).toBeNull();
    const data = await sessionData(secondSid);
    expect(data.patient_id).toBe(ravi.id);
    expect(data.chat_history).toBeUndefined();
    expect(asha.id).not.toBe(ravi.id);
  });

  it('leaves an existing session untouched when the login fails (as Django does)', async () => {
    const asha = await createPatient({ email: 'asha@example.test' });
    const { agent, res } = await login('asha@example.test');
    const sid = sidFromCookieValue(setCookies(res).sessionid.value);
    const { res: failed } = await login('nobody@example.test', agent);
    expect(failed.headers.location).toBe('/');
    expect((await sessionData(sid)).patient_id).toBe(asha.id);
  });

  it('does not serve the Django HTML login page: GET /login/ is 404', async () => {
    const res = await request(app).get('/login/');
    expect(res.status).toBe(404);
  });

  it.each(['put', 'patch', 'delete', 'head', 'options'])(
    '%s /login/ (dropped HTML view) is 404 too',
    async (method) => {
      const res = await request(app)[method]('/login/');
      expect(res.status).toBe(404);
      expect(res.headers.allow).toBeUndefined();
    },
  );
});

describe('/patient/logout/ (E09)', () => {
  it('GET flushes the session, deletes the cookie and redirects to /', async () => {
    await createPatient({ email: 'asha@example.test' });
    const { agent, res } = await login('asha@example.test');
    const sid = sidFromCookieValue(setCookies(res).sessionid.value);
    const out = await agent.get('/patient/logout/');
    expect(out.status).toBe(302);
    expect(out.headers.location).toBe('/');
    const cleared = setCookies(out).sessionid;
    expect(cleared.value).toBe('');
    expect(Date.parse(cleared.attributes.expires)).toBe(0);
    expect(cleared.attributes).toMatchObject({ path: '/', samesite: 'Lax' });
    expect(await sessionData(sid)).toBeNull();
  });

  it('adds Vary: Cookie (flush accesses the session)', async () => {
    expect((await request(app).get('/patient/logout/')).headers.vary).toMatch(/Cookie/);
  });

  it('HEAD flushes the session too (Django: any method)', async () => {
    await createPatient({ email: 'asha@example.test' });
    const { agent, res } = await login('asha@example.test');
    const sid = sidFromCookieValue(setCookies(res).sessionid.value);
    const out = await agent.head('/patient/logout/');
    expect(out.status).toBe(302);
    expect(await sessionData(sid)).toBeNull();
  });

  it('PUT and DELETE with cookie + X-CSRFToken log out, like POST', async () => {
    for (const method of ['put', 'delete']) {
      const agent = request.agent(app);
      const token = await csrfToken(agent);
      const res = await agent[method]('/patient/logout/').set('X-CSRFToken', token).set('Origin', TRUSTED_ORIGIN);
      expect(res.status).toBe(302);
    }
  });

});

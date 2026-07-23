// E08 /patient/dashboard/ against the real app and test database.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { NOT_FOUND } from '../helpers/djangoPages.js';
import { makeApp } from '../helpers/app.js';
import { setCookies, sidFromCookieValue } from '../helpers/cookies.js';
import { createPatient, sessionData, truncateAll } from '../helpers/db.js';

// What React's apiCall sends (djangoApi.js:26-62).
const REACT_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

let app;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
});

/** A cookie-keeping agent logged in as `email`, plus its session cookie value. */
async function loggedIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/login/').type('form').send({ email });
  expect(res.headers.location).toBe('/patient/dashboard/');
  return { agent, cookie: setCookies(res).sessionid.value };
}

describe('/patient/dashboard/ JSON mode (E08, what React calls)', () => {
  it("returns the logged-in patient's id, name, email and info", async () => {
    const patient = await createPatient({ name: 'Asha Rao', email: 'asha@example.test', info: 'ACL repair.' });
    const { agent } = await loggedIn('asha@example.test');
    const res = await agent.get('/patient/dashboard/').set(REACT_HEADERS);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers.vary).toMatch(/Cookie/);
    expect(res.text).toBe(
      JSON.stringify({
        patient: { id: patient.id, name: 'Asha Rao', email: 'asha@example.test', info: 'ACL repair.' },
      }),
    );
    expect(typeof res.body.patient.id).toBe('number');
  });

  it('returns the whole info text, unicode included', async () => {
    const info = `${'घुटने की सर्जरी। '.repeat(200)}\nLine two "quoted"`;
    await createPatient({ email: 'hindi@example.test', info });
    const { agent } = await loggedIn('hindi@example.test');
    expect((await agent.get('/patient/dashboard/').set(REACT_HEADERS)).body.patient.info).toBe(info);
  });

  it('shows each patient only their own record (the session decides, nothing else)', async () => {
    const asha = await createPatient({ name: 'Asha', email: 'asha@example.test' });
    const ravi = await createPatient({ name: 'Ravi', email: 'ravi@example.test' });
    const a = await loggedIn('asha@example.test');
    const r = await loggedIn('ravi@example.test');
    expect((await a.agent.get('/patient/dashboard/').set(REACT_HEADERS)).body.patient.id).toBe(asha.id);
    expect((await r.agent.get('/patient/dashboard/').set(REACT_HEADERS)).body.patient.id).toBe(ravi.id);
    // Query strings and bodies can't pick another patient: the view only reads the session.
    const probe = await a.agent
      .post(`/patient/dashboard/?id=${ravi.id}&patient_id=${ravi.id}`)
      .set(REACT_HEADERS)
      .send({ id: ravi.id, patient_id: ravi.id });
    expect(probe.body.patient.id).toBe(asha.id);
  });

  it('rejects a forged session cookie (unsigned or signed with another secret) with 401', async () => {
    await createPatient({ email: 'asha@example.test' });
    const { cookie } = await loggedIn('asha@example.test');
    const sid = sidFromCookieValue(cookie);
    for (const forged of [sid, encodeURIComponent(`s:${sid}.not-the-signature`)]) {
      const res = await request(app).get('/patient/dashboard/').set(REACT_HEADERS).set('Cookie', `sessionid=${forged}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Not authenticated' });
      expect(setCookies(res).sessionid.attributes.expires).toBe('Thu, 01 Jan 1970 00:00:00 GMT');
    }
  });

});

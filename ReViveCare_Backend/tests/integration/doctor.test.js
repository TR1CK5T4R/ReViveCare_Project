// E06 POST /doctor_info against the real app and test database.
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { makeApp } from '../helpers/app.js';
import { setCookies } from '../helpers/cookies.js';
import { createPatient, truncateAll } from '../helpers/db.js';

const SERVER_ERROR = '<h1>Server Error (500)</h1>';

let app;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
});

/** POST a raw body to /doctor_info the way React does (JSON headers). */
const post = (body, contentType = 'application/json') =>
  request(app).post('/doctor_info').set('Content-Type', contentType).set('Accept', 'application/json').send(body);

/** Every stored patient, as the business columns Django had. */
async function patients() {
  const { rows } = await query(
    `SELECT p.id, u.name, u.email, p.info, u.password, u.phone, u.is_active, p.age, p.gender, p.address,
            p.assigned_doctor_id, u.created_at, u.updated_at
       FROM patients p JOIN users u ON u.id = p.user_id ORDER BY p.id`,
  );
  return rows;
}

describe('POST /doctor_info (E06): create', () => {
  it('creates a patient and answers {"success": true, "created": true}', async () => {
    const res = await post(JSON.stringify({ name: 'Asha Rao', email: 'asha@example.test', info: 'ACL repair.' }));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.text).toBe('{"success":true,"created":true}');
    const [row] = await patients();
    expect(row).toMatchObject({
      name: 'Asha Rao',
      email: 'asha@example.test',
      info: 'ACL repair.',
      password: null,
      phone: null,
      is_active: true,
      age: null,
      gender: null,
      address: null,
      assigned_doctor_id: null,
    });
    expect(row.created_at).toBeTruthy();
  });

  it('stores the email exactly as sent: no trimming, no lower-casing', async () => {
    await post(JSON.stringify({ name: 'N', email: ' Mixed@Example.TEST ', info: 'I' }));
    expect((await patients())[0].email).toBe(' Mixed@Example.TEST ');
    // ...so that patient can never log in (login strips and lower-cases).
    const login = await request(app).post('/login/').type('form').send({ email: ' Mixed@Example.TEST ' });
    expect(login.headers.location).toBe('/');
  });

  it('the new patient can log in and sees the data on the dashboard', async () => {
    await post(JSON.stringify({ name: 'Ravi', email: 'ravi@example.test', info: 'Hip replacement.' }));
    const agent = request.agent(app);
    await agent.post('/login/').type('form').send({ email: 'ravi@example.test' });
    const res = await agent.get('/patient/dashboard/').set('Accept', 'application/json');
    expect(res.body.patient).toMatchObject({ name: 'Ravi', email: 'ravi@example.test', info: 'Hip replacement.' });
  });

  it.each([
    [
      { name: 5, email: 5.0, info: true },
      { name: '5', email: '5.0', info: 'True' },
    ],
    [
      { name: [1, 'a'], email: 'e@x.test', info: { a: 1 } },
      { name: "[1, 'a']", email: 'e@x.test', info: "{'a': 1}" },
    ],
  ])('turns non-strings into Python str(): %j', async (body, stored) => {
    // JSON.stringify writes 5.0 as 5, so send the literal text Python would see.
    const text = JSON.stringify(body).replace('"email":5', '"email":5.0');
    expect((await post(text)).body).toEqual({ success: true, created: true });
    expect(await patients()).toEqual([expect.objectContaining(stored)]);
  });

});

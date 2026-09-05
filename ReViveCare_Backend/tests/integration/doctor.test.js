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

  it('accepts NaN / Infinity like Python json.loads', async () => {
    const res = await post('{"email": "e@x.test", "name": NaN, "info": -Infinity}');
    expect(res.status).toBe(200);
    expect(await patients()).toEqual([expect.objectContaining({ name: 'nan', info: '-inf' })]);
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/json; charset=utf-8', ''])(
    'parses the body as JSON whatever the Content-Type (%j)',
    async (type) => {
      const res = await request(app)
        .post('/doctor_info')
        .set('Content-Type', type)
        // A string goes out as-is; supertest would re-serialize a Buffer or object for these types.
        .send('{"email": "e@x.test", "name": "n", "info": "i"}');
      expect(res.body).toEqual({ success: true, created: true });
    },
  );

  it('ignores extra keys', async () => {
    const res = await post(JSON.stringify({ email: 'e@x.test', name: 'n', info: 'i', password: 'x', age: 40 }));
    expect(res.status).toBe(200);
    expect((await patients())[0]).toMatchObject({ password: null, age: null });
  });
});

describe('POST /doctor_info (E06): update', () => {
  it('updates name and info of the patient with that exact email: {"created": false}', async () => {
    const existing = await createPatient({ name: 'Old', email: 'asha@example.test', info: 'old info' });
    const before = (await patients())[0];
    const res = await post(JSON.stringify({ email: 'asha@example.test', name: 'New', info: 'new info' }));
    expect(res.text).toBe('{"success":true,"created":false}');
    const [after] = await patients();
    expect(after).toMatchObject({ id: existing.id, name: 'New', email: 'asha@example.test', info: 'new info' });
    expect(after.created_at).toEqual(before.created_at);
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at)); // timestamptz stays a string
  });

  it('matches the email case-sensitively: a different case creates a second patient', async () => {
    await createPatient({ email: 'asha@example.test' });
    const res = await post(JSON.stringify({ email: 'Asha@example.test', name: 'n', info: 'i' }));
    expect(res.body.created).toBe(true);
    expect(await patients()).toHaveLength(2);
  });

  it('lets anyone overwrite any patient: no auth, no CSRF, any Origin', async () => {
    await createPatient({ email: 'asha@example.test' });
    const res = await request(app)
      .post('/doctor_info')
      .set('Origin', 'http://evil.example')
      .send({ email: 'asha@example.test', name: 'Changed', info: 'Changed' });
    expect(res.status).toBe(200);
    expect((await patients())[0].name).toBe('Changed');
  });

  it('two concurrent requests for a new email create exactly one patient', async () => {
    const body = JSON.stringify({ email: 'race@example.test', name: 'n', info: 'i' });
    const results = await Promise.all(Array.from({ length: 5 }, () => post(body)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.filter((r) => r.body.created)).toHaveLength(1);
    expect(await patients()).toHaveLength(1);
  });
});

describe('POST /doctor_info (E06): errors are 500s and write nothing', () => {
  it.each([
    ['invalid JSON', '{"email": '],
    ['an empty body', ''],
    ['a JSON array', '[]'],
    ['a JSON string', '"x"'],
    ['a missing name', '{"email": "e@x.test", "info": "i"}'],
    ['a null email', '{"email": null, "name": "n", "info": "i"}'],
    ['a null info', '{"email": "e@x.test", "name": "n", "info": null}'],
    ['single quotes', "{'email': 'e', 'name': 'n', 'info': 'i'}"],
    ['a trailing comma', '{"email": "e", "name": "n", "info": "i",}'],
    ['a name over 100 characters (Postgres VARCHAR)', JSON.stringify({ email: 'e', name: 'x'.repeat(101), info: 'i' })],
    ['an email over 254 characters', JSON.stringify({ email: 'x'.repeat(255), name: 'n', info: 'i' })],
    ['a NUL character (Postgres text)', '{"email": "e", "name": "a\\u0000b", "info": "i"}'],
    ['a lone surrogate (psycopg UnicodeEncodeError)', '{"email": "e", "name": "\\ud800", "info": "i"}'],
    ['an int over 4300 digits', `{"email": ${'1'.repeat(4301)}, "name": "n", "info": "i"}`],
  ])('%s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(500);
    expect(res.text).toContain(SERVER_ERROR);
    expect(await patients()).toEqual([]);
  });

  it('a failing update leaves the existing patient unchanged', async () => {
    await createPatient({ name: 'Old', email: 'asha@example.test', info: 'old' });
    const res = await post(JSON.stringify({ email: 'asha@example.test', name: 'x'.repeat(101), info: 'new' }));
    expect(res.status).toBe(500);
    expect((await patients())[0]).toMatchObject({ name: 'Old', info: 'old' });
  });

  it('accepts exactly 100 characters of name and 254 of email', async () => {
    const res = await post(JSON.stringify({ email: 'é'.repeat(254), name: '😀'.repeat(100), info: 'i' }));
    expect(res.status).toBe(200);
  });

  it("answers a body over 2.5 MB with Django's 400 page (DATA_UPLOAD_MAX_MEMORY_SIZE)", async () => {
    const res = await post(JSON.stringify({ email: 'e', name: 'n', info: 'x'.repeat(2_621_440) }));
    expect(res.status).toBe(400);
    expect(await patients()).toEqual([]);
  });
});

describe('POST /doctor_info (E06): review follow-ups', () => {
  /** Send raw bytes with node:http, optionally chunked (no Content-Length). */
  async function rawPost(bytes, { chunked = false, headers = {} } = {}) {
    const server = app.listen(0);
    try {
      return await new Promise((resolve, reject) => {
        const req = http.request(
          { port: server.address().port, method: 'POST', path: '/doctor_info', headers },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
        if (chunked) {
          req.write(bytes); // write() before end() → Transfer-Encoding: chunked, no Content-Length
          req.end();
        } else {
          req.setHeader('Content-Length', bytes.length);
          req.end(bytes);
        }
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it('a chunked body (no Content-Length) reads as empty, like Django: 500, nothing written', async () => {
    const status = await rawPost(Buffer.from('{"email": "e", "name": "n", "info": "i"}'), { chunked: true });
    expect(status).toBe(500);
    expect(await patients()).toEqual([]);
  });

  it('a body without any Content-Type header is still parsed', async () => {
    expect(await rawPost(Buffer.from('{"email": "e@x.test", "name": "n", "info": "i"}'))).toBe(200);
    expect(await patients()).toHaveLength(1);
  });

  it('a patient may share an email with a doctor (UNIQUE per role): created', async () => {
    await query(`INSERT INTO users (role, name, email, password) VALUES ('doctor', 'Dr', 'same@x.test', 'x')`);
    const res = await post(JSON.stringify({ email: 'same@x.test', name: 'n', info: 'i' }));
    expect(res.body).toEqual({ success: true, created: true });
  });

  it('concurrent updates of one patient are serialised; one of the writes wins whole', async () => {
    await createPatient({ email: 'asha@example.test' });
    const bodies = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ email: 'asha@example.test', name: `N${i}`, info: `I${i}` }),
    );
    const results = await Promise.all(bodies.map((b) => post(b)));
    expect(results.every((r) => r.body.created === false)).toBe(true);
    const [row] = await patients();
    expect(row.info).toBe(row.name.replace('N', 'I')); // name and info from the same request
  });

  it('timestamps come from the write itself (clock_timestamp), not the transaction start', async () => {
    await post(JSON.stringify({ email: 'e@x.test', name: 'n', info: 'i' }));
    const [row] = await patients();
    expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.created_at));
  });
});

describe('/doctor_info (E06): logged differences', () => {
  it('UTF-8 bytes of a lone surrogate inside a list: Node 500; Django decoded them (surrogatepass) and stored the repr', async () => {
    const body = Buffer.concat([
      Buffer.from('{"email": "e@x.test", "name": ["'),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from('"], "info": "i"}'),
    ]);
    // text/plain + Buffer: supertest sends the bytes untouched.
    const res = await request(app).post('/doctor_info').set('Content-Type', 'text/plain').send(body);
    expect(res.status).toBe(500);
    expect(await patients()).toEqual([]);
  });

  it('a compressed body (Content-Encoding: gzip) is 400 and writes nothing; Django failed to decode it (500)', async () => {
    const res = await request(app)
      .post('/doctor_info')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(gzipSync('{"email": "e", "name": "n", "info": "i"}'));
    expect(res.status).toBe(400);
    expect(await patients()).toEqual([]);
  });
});

describe('/doctor_info (E06): methods and routing', () => {
  it.each(['get', 'put', 'patch', 'delete', 'head'])('%s → 405 Allow: POST, empty body', async (method) => {
    const res = await request(app)[method]('/doctor_info');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.text ?? '').toBe('');
  });

  it('a plain OPTIONS (not a preflight) is 405 too', async () => {
    expect((await request(app).options('/doctor_info')).status).toBe(405);
  });

  it('/doctor_info/ (with a slash) is 404: Django never removes a slash', async () => {
    const res = await request(app).post('/doctor_info/').send({ email: 'e', name: 'n', info: 'i' });
    expect(res.status).toBe(404);
    expect(await patients()).toEqual([]);
  });

  it('sets no cookies and creates no session', async () => {
    const res = await post(JSON.stringify({ email: 'e', name: 'n', info: 'i' }));
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(setCookies(res)).toEqual({});
    expect((await query('SELECT count(*) AS n FROM sessions')).rows[0].n).toBe(0);
  });

  it('E04 /doc_port/ and E05 /doc_info_page/ (dropped HTML pages) are 404', async () => {
    expect((await request(app).get('/doc_port/')).status).toBe(404);
    expect((await request(app).get('/doc_info_page/')).status).toBe(404);
  });
});

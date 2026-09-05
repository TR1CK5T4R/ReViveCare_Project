// The dev-only per-request query counter (app.js 3b): no endpoint runs a query per row (no N+1).
import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { testConfig } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';

/** The real app with an in-memory pino logger that records every "queries per request" line. */
function appWithCounts() {
  const counts = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      const line = JSON.parse(chunk);
      if (line.msg === 'queries per request') counts.push(line.queries);
      done();
    },
  });
  return { app: createApp({ config: testConfig(), logger: pino({ level: 'debug' }, sink) }), counts };
}

let app;
let counts;
beforeEach(async () => {
  await truncateAll();
  ({ app, counts } = appWithCounts());
});

describe('queries per request (dev-only counter)', () => {
  it('login 1, dashboard 1, doctor_info create 3: constant, whatever the data size', async () => {
    for (let i = 0; i < 20; i += 1) await createPatient({ email: `p${i}@example.test` });
    const agent = request.agent(app);
    await agent.post('/login/').type('form').send({ email: 'p3@example.test' });
    await agent.get('/patient/dashboard/').set('Accept', 'application/json');
    await request(app)
      .post('/doctor_info')
      .set('Content-Type', 'application/json')
      .send('{"email":"n@example.test","name":"n","info":"i"}');
    await new Promise((resolve) => setImmediate(resolve)); // let the last 'finish' log flush
    // doctor_info create: locked lookup + users insert + patients insert (BEGIN/SAVEPOINT/COMMIT not counted).
    expect(counts).toEqual([1, 1, 3]);
  });
});

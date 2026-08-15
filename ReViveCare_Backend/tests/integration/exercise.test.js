// E23 POST /exercise/sessions/ (new) and the removed E18-E21 paths.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { accuracyScore } from '../../src/services/exercise.service.js';
import { makeApp } from '../helpers/app.js';
import { setCookies } from '../helpers/cookies.js';
import { createPatient, truncateAll } from '../helpers/db.js';

const ORIGIN = 'http://localhost:5173';
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

let app;
let patient;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
  patient = await createPatient({ email: 'asha@example.test' });
});

/** Logged in, with the CSRF cookie React reads; returns a function that posts a set like React does. */
async function reactClient(email = 'asha@example.test') {
  const agent = request.agent(app);
  await agent.post('/login/').type('form').send({ email });
  const token = decodeURIComponent(setCookies(await agent.get('/csrf/')).csrftoken.value);
  return (body) =>
    agent
      .post('/exercise/sessions/')
      .set('Origin', ORIGIN)
      .set('X-CSRFToken', token)
      .set('Accept', 'application/json')
      .send(body);
}

const validSet = (overrides = {}) => ({
  exercise_type: 'shoulder-extension',
  target_reps: 12,
  excellent_reps: 4,
  good_reps: 9,
  partial_reps: 3,
  started_at: minutesAgo(5),
  ended_at: minutesAgo(1),
  ...overrides,
});

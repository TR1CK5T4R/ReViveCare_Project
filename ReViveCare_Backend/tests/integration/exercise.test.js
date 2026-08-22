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

async function storedSessions() {
  const { rows } = await query(
    `SELECT patient_id, exercise_type, start_time, end_time, target_reps, excellent_reps, good_reps,
            partial_reps, completed_reps, accuracy_score, notes
       FROM exercise_sessions ORDER BY id`,
  );
  return rows;
}

describe('POST /exercise/sessions/ (E23): stores a set', () => {
  it('stores a finished set for the logged-in patient: 201 {success, id, completed_reps}', async () => {
    const post = await reactClient();
    const body = validSet();
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, id: expect.any(Number), completed_reps: 12 });
    const [row] = await storedSessions();
    expect(row).toMatchObject({
      patient_id: patient.id,
      exercise_type: 'shoulder-extension',
      target_reps: 12,
      excellent_reps: 4,
      good_reps: 9,
      partial_reps: 3,
      completed_reps: 12,
      accuracy_score: 75,
      notes: null,
    });
    expect(Date.parse(row.start_time)).toBe(Date.parse(body.started_at));
    expect(Date.parse(row.end_time)).toBe(Date.parse(body.ended_at));
  });

  it('stores an abandoned set with no end time and no reps (accuracy 0.0)', async () => {
    const post = await reactClient();
    const res = await post(validSet({ excellent_reps: 0, good_reps: 0, partial_reps: 0, ended_at: null }));
    expect(res.status).toBe(201);
    expect((await storedSessions())[0]).toMatchObject({ end_time: null, completed_reps: 0, accuracy_score: 0 });
  });

  it('ignores unknown keys (the patient comes from the session, never the body)', async () => {
    const other = await createPatient({ email: 'ravi@example.test' });
    const post = await reactClient();
    await post(validSet({ patient_id: other.id, accuracy_score: 100, notes: 'x' }));
    expect((await storedSessions())[0]).toMatchObject({ patient_id: patient.id, accuracy_score: 75, notes: null });
  });

});

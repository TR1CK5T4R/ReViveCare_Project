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

  it('accuracy is the old Django page formula: good / all reps x 100, one decimal', () => {
    expect(accuracyScore(9, 12)).toBe(75);
    expect(accuracyScore(2, 3)).toBe(66.7);
    expect(accuracyScore(1, 3)).toBe(33.3);
    expect(accuracyScore(0, 0)).toBe(0);
  });
});

describe('POST /exercise/sessions/ (E23): rejects', () => {
  it.each([
    ['an unknown exercise type', { exercise_type: 'squats' }, 'exercise_type'],
    ['target_reps 0', { target_reps: 0 }, 'target_reps'],
    ['target_reps 51', { target_reps: 51, good_reps: 0, excellent_reps: 0, partial_reps: 0 }, 'target_reps'],
    ['a fractional count', { partial_reps: 1.5 }, 'partial_reps'],
    ['a string count', { good_reps: '9' }, 'good_reps'],
    ['a negative count', { partial_reps: -1 }, 'partial_reps'],
    ['more excellent than good reps', { excellent_reps: 10, good_reps: 9 }, 'excellent_reps'],
    ['more reps than the target', { good_reps: 10, partial_reps: 3 }, 'partial_reps'],
    ['a start time without a zone', { started_at: '2026-10-15T10:00:00' }, 'started_at'],
    [
      'a start time in the future',
      { started_at: new Date(Date.now() + 5 * 60_000).toISOString(), ended_at: null },
      'started_at',
    ],
    ['an end before the start', { ended_at: minutesAgo(10) }, 'ended_at'],
    ['a missing field', { ended_at: undefined }, 'ended_at'],
  ])('%s → 400 with the field named, nothing stored', async (_label, overrides, field) => {
    const post = await reactClient();
    const res = await post(validSet(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
    expect(Object.keys(res.body.fields)).toContain(field);
    expect(await storedSessions()).toEqual([]);
  });

  it('a body that is not JSON → 400 {"fields": {"body": ...}}', async () => {
    const post = await reactClient();
    const res = await post('{not json').set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request', fields: { body: 'must be a JSON object' } });
  });

});

// SQL for exercise sessions. completed_reps is a generated column
// (good_reps + partial_reps, 0003_exercise.sql), so it's read back, never written.

import { query } from '../db/pool.js';

/**
 * @param {{ patientId: number, exerciseType: string, startTime: string, endTime: string | null,
 *   targetReps: number, excellentReps: number, goodReps: number, partialReps: number, accuracyScore: number }} s
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ id: number, completed_reps: number }>}
 */
export async function insertExerciseSession(s, client) {
  const { rows } = await query(
    `INSERT INTO exercise_sessions
       (patient_id, exercise_type, start_time, end_time, target_reps, excellent_reps, good_reps, partial_reps,
        accuracy_score, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
     RETURNING id, completed_reps`,
    [
      s.patientId,
      s.exerciseType,
      s.startTime,
      s.endTime,
      s.targetReps,
      s.excellentReps,
      s.goodReps,
      s.partialReps,
      s.accuracyScore,
    ],
    client,
  );
  return rows[0];
}

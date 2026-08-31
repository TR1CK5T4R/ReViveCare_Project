// Storing a finished or abandoned exercise set (E23). The reps were
// counted in the browser with the ported Django logic; the server stores them.

import { insertExerciseSession } from '../repositories/exercise.repository.js';

const FOREIGN_KEY_VIOLATION = '23503';

/**
 * The quality rate the old Django workout page showed patients:
 * good reps (which include excellent ones) out of all reps, as a percentage
 * with one decimal, 0 when there were no reps.
 * Django parity: templates/side_lateral_raise.html:739-742 (`.toFixed(1)`, JS there too)
 *
 * @param {number} goodReps
 * @param {number} completedReps good + partial
 */
export function accuracyScore(goodReps, completedReps) {
  return completedReps > 0 ? Number(((goodReps / completedReps) * 100).toFixed(1)) : 0.0;
}

/**
 * @param {number} patientId from the session
 * @param {{ exercise_type: string, target_reps: number, excellent_reps: number, good_reps: number,
 *   partial_reps: number, started_at: string, ended_at: string | null }} set validated body
 * @returns {Promise<{ id: number, completed_reps: number } | null>} null when the patient no longer exists
 */
export async function recordExerciseSet(patientId, set) {
  try {
    return await insertExerciseSession({
      patientId,
      exerciseType: set.exercise_type,
      startTime: set.started_at,
      endTime: set.ended_at,
      targetReps: set.target_reps,
      excellentReps: set.excellent_reps,
      goodReps: set.good_reps,
      partialReps: set.partial_reps,
      accuracyScore: accuracyScore(set.good_reps, set.good_reps + set.partial_reps),
    });
  } catch (err) {
    // The patient row was deleted after login (exercise_sessions.patient_id FK).
    if (err.code === FOREIGN_KEY_VIOLATION && err.constraint === 'exercise_sessions_patient_fkey') return null;
    throw err;
  }
}

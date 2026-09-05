// HTTP side of E23 POST /exercise/sessions/. Errors follow the
// contract: 401 like E08's JSON mode, 400 {"error": "Invalid request", "fields": {...}}.

import { recordExerciseSet } from '../services/exercise.service.js';
import { sendJson } from '../utils/djangoResponses.js';
import { fieldErrors } from '../validators/exercise.validators.js';
import { sessionPatientId } from '../middleware/auth.js';

export function createExerciseController() {
  return {
    notAuthenticated(req, res) {
      sendJson(res, 401, { error: 'Not authenticated' });
    },

    /** validate()'s onInvalid, and the handler for a body that isn't JSON. */
    invalid(error, req, res) {
      sendJson(res, 400, {
        error: 'Invalid request',
        fields: error ? fieldErrors(error) : { body: 'must be a JSON object' },
      });
    },

    async saveSession(req, res) {
      const saved = await recordExerciseSet(sessionPatientId(req), req.validated.body);
      if (!saved) return sendJson(res, 404, { error: 'Patient not found' });
      req.log.info({ patientId: sessionPatientId(req), exerciseSessionId: saved.id }, 'exercise set saved');
      sendJson(res, 201, { success: true, id: saved.id, completed_reps: saved.completed_reps });
    },
  };
}

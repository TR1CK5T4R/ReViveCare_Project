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

  };
}

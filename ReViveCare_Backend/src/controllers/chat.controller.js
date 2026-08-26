// HTTP side of E11 POST /patient/chatbot/send/. Django answers every outcome
// with HTTP 200 and {"success": ...}; the body is written with Python's
// json.dumps rules so it's byte-identical to Django's JsonResponse.

import { sessionPatientId } from '../middleware/auth.js';
import { sendChatMessage } from '../services/chat.service.js';
import { sendPythonJson } from '../utils/djangoResponses.js';

/**
 * @param {{ groq: object, alerts: object }} deps
 */
export function createChatController({ groq, alerts }) {
  const fail = (res, error) => sendPythonJson(res, 200, { success: false, error });

  return {
    /** Django parity: Patients/views.py:chatbot_send (`if not patient_id:`), before the try. */
    notAuthenticated(req, res) {
      fail(res, 'Not authenticated');
    },

  };
}

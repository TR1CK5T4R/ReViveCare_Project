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

    /** Django parity: Patients/views.py:chatbot_send */
    async send(req, res) {
      let result;
      try {
        result = await sendChatMessage(
          {
            patientId: sessionPatientId(req),
            body: req.body,
            bodyError: req.bodyError,
            history: req.session.chat_history ?? [],
          },
          { groq, alerts, logger: req.log },
        );
      } catch (err) {
        // Django: print(f"Error in chatbot_send: {e}"). Never log the message or the model's text.
        req.log.error({ error: err.name, pyType: err.pyType, status: err.status }, 'chat turn failed');
        return fail(res, 'Server error');
      }
      if (result.kind === 'patient_not_found') return fail(res, 'Patient not found');
      if (result.kind === 'empty_message') return fail(res, 'Empty message');
      req.session.chat_history = result.history;
      sendPythonJson(res, 200, {
        success: true,
        response: result.patientResponse,
        seriousness_score: result.seriousnessScore,
      });
    },
  };
}

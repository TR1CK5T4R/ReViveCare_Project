// The patient chat turn behind POST /patient/chatbot/send/: read the message,
// ask the model with the patient's context and the session history, evaluate
// the reply with the risk engine, alert the doctor if needed.
// Plain function: no req/res, no SQL (the repository loads the patient).
// Django parity: Patients/views.py:chatbot_send (R-CHAT-01..05)

import { aiConfig } from '../config/ai.js';
import { buildSystemPrompt } from '../integrations/groq/prompts.js';
import { createChatCompletion } from '../integrations/groq/client.js';
import { findPatientById } from '../repositories/patient.repository.js';
import { pyLower, pyStrip } from '../utils/pythonCompat.js';
import { PythonError, pyJsonLoads, toPlainJson } from '../utils/pythonJson.js';
import { sendDoctorAlert } from './alert.service.js';
import { evaluatePatient } from './riskEngine.js';

/** `data.get(key, default)` that must return a str for the following .strip()/.lower(). */
function stringField(data, key, fallback) {
  const value = data.has(key) ? data.get(key) : fallback;
  if (typeof value !== 'string') throw new PythonError('AttributeError', `${key} is not a string`);
  return value;
}

/**
 * One chat turn.
 *
 * @param {{ patientId: number, body?: Buffer, bodyError?: Error, history?: unknown[] }} request
 *   body: raw request bytes; bodyError: why they couldn't be read (too large, compressed);
 *   history: the session's chat_history
 * @param {{ groq: object, alerts: object, logger: import('pino').Logger, now?: () => Date,
 *   complete?: Function, alert?: Function }} deps
 * @returns {Promise<{ kind: 'patient_not_found' } | { kind: 'empty_message' } |
 *   { kind: 'ok', patientResponse: unknown, seriousnessScore: number, history: object[] }>}
 * @throws anything Django's `except Exception` turned into {"success": false, "error": "Server error"}
 */
export async function sendChatMessage(
  { patientId, body, bodyError, history = [] },
  { groq, alerts, logger, now = () => new Date(), complete = createChatCompletion, alert = sendDoctorAlert },
) {
  // The patient is loaded before the body is read, as in Django.
  const patient = await findPatientById(patientId);
  if (!patient) return { kind: 'patient_not_found' };

}

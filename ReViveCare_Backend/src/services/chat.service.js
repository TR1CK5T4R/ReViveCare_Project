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

  // request.body: a too-large or undecodable body raises here, inside Django's try.
  if (bodyError) throw bodyError;
  const data = pyJsonLoads(body ?? Buffer.alloc(0));
  if (!(data instanceof Map)) throw new PythonError('AttributeError', 'request body is not a JSON object');
  const userMessage = pyStrip(stringField(data, 'message', ''));
  const language = pyLower(stringField(data, 'language', 'english'));
  if (!userMessage) return { kind: 'empty_message' };

  // LangChain message objects only accept text here; anything else (a model
  // that once answered with a non-string patient_response) fails the request.
  const messages = [{ role: 'system', content: buildSystemPrompt(patient.info, language) }];
  for (const item of history) {
    if (typeof item?.content !== 'string' || item.role === undefined) {
      throw new PythonError('ValidationError', 'unusable chat_history item');
    }
    messages.push({ role: item.role === 'user' ? 'user' : 'assistant', content: item.content });
  }
  messages.push({ role: 'user', content: userMessage });
  // httpx encodes the request as strict UTF-8, so Django failed ("Server error")
  // on a lone surrogate anywhere in the conversation; JSON.stringify would escape it.
  if (messages.some((m) => !m.content.isWellFormed())) {
    throw new PythonError('UnicodeEncodeError', 'surrogates not allowed');
  }

  const reply = await complete(messages, { ...groq, logger });
  const { patientResponse, seriousnessScore, alertDoctor } = evaluatePatient({ llmReply: reply });

  // R-CHAT-03: only successful turns are stored; keep the last 20 items.
  const updated = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: toPlainJson(patientResponse) },
  ].slice(-aiConfig.historyWindow);

  // R-CHAT-04/05: synchronous, before the response, like Django. Never throws.
  if (alertDoctor) {
    await alert(
      { patient, userQuery: userMessage, patientResponse, score: seriousnessScore, now: now() },
      {
        settings: alerts,
        logger,
      },
    );
  }
  // The alert flag is a health signal: not logged here (alert.service logs only that an alert ran).
  logger.info({ patientId, historyItems: updated.length }, 'chat turn answered');
  return { kind: 'ok', patientResponse, seriousnessScore, history: updated };
}

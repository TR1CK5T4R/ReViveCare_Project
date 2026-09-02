// Brute-force protection for POST /login/ (approved addition; Django
// had none). Counts only *failed* attempts per client IP, so a patient who
// logs in normally is never blocked. Uses req.ip, which honours TRUST_PROXY.
// In-memory counter: correct for a single Node process.

import { rateLimit } from 'express-rate-limit';
import { errorPage, sendHtml, sendPythonJson } from '../utils/djangoResponses.js';

export const LOGIN_SUCCESS_LOCATION = '/patient/dashboard/';

const TOO_MANY_PAGE = errorPage('Too Many Requests (429)', 'Too many login attempts. Please try again later.');

/**
 * @param {{ max: number, windowMs: number }} options config.loginRateLimit
 * @returns {import('express').RequestHandler}
 */
export function loginRateLimit({ max, windowMs }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Login answers 302 in both cases; success is the redirect to the dashboard
    // (Patients/views.py:login), failure the redirect to '/'.
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.getHeader('Location') === LOGIN_SUCCESS_LOCATION,
    handler: (req, res) => {
      req.log?.warn('login rate limit reached');
      sendHtml(res, 429, TOO_MANY_PAGE);
    },
  });
}

/**
 * Cost protection for POST /patient/chatbot/send/ (approved addition;
 * Django had none): every message is a paid Groq call. Counted per patient
 * (not per session: logging in again creates a new session). Runs after
 * requirePatient, so there is always a patient id. Over the limit, the answer
 * has the endpoint's own shape (HTTP 200, success false), which React already
 * shows as an error.
 *
 * @param {{ max: number, windowMs: number }} options config.chatRateLimit
 * @returns {import('express').RequestHandler}
 */
export function chatRateLimit({ max, windowMs }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `patient:${req.session.patient_id}`,
    handler: (req, res) => {
      req.log?.warn({ patientId: req.session.patient_id }, 'chat rate limit reached');
      sendPythonJson(res, 200, { success: false, error: 'Too many messages' });
    },
  });
}

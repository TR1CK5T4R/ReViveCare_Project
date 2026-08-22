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

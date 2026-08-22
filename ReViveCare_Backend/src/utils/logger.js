// The app's pino logger. Structured JSON in production, pino-pretty in dev.
// Redaction keeps credentials and session ids out of logs. Project rule: app
// code logs patient ids, never names, emails, medical info or chat text.

import pino from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrftoken"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  // Postgres puts row values in error details, e.g. "Key (email, role)=(…) already exists".
  'err.detail',
  '*.err.detail',
];

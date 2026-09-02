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

/**
 * @param {{ level: string, pretty: boolean }} options
 * @returns {import('pino').Logger}
 */
export function createLogger({ level, pretty }) {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } } } : {}),
  });
}

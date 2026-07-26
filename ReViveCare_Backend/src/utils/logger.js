// The app's pino logger. Structured JSON in production, pino-pretty in dev.
// Redaction keeps credentials and session ids out of logs. Project rule: app
// code logs patient ids, never names, emails, medical info or chat text.

import pino from 'pino';

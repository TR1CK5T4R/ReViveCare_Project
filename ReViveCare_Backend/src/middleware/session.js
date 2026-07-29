// Server-side sessions stored in PostgreSQL (table `sessions`, created by
// db/migrations/0006_sessions.sql), replacing Django's database session
// engine. The session holds patient_id, patient_email, patient_name and
// chat_history, exactly the keys Django used.

import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';

/**
 * @param {{ config: object, pool: import('pg').Pool, logger: import('pino').Logger }} deps
 * @returns {{ middleware: import('express').RequestHandler, store: object }}
 */
export function createSession({ config, pool, logger }) {
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: 'sessions',
    // The migration owns the table; the app never creates schema at runtime.
    createTableIfMissing: false,
    // Django only moves a session's expiry when the session is saved. Without
    // this, every request would extend it in the database (but not in the
    // browser's cookie).
    disableTouch: true,
    pruneSessionInterval: config.session.pruneIntervalSeconds,
    errorLog: (...args) => logger.error({ detail: String(args[0]) }, 'session store error'),
  });

}

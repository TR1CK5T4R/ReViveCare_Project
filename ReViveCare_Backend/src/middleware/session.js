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

  const middleware = session({
    name: config.session.cookieName,
    secret: config.session.secret,
    store,
    // Like Django: write the session and send the cookie only when the session
    // data changed (SESSION_SAVE_EVERY_REQUEST is False), and never create
    // empty sessions for anonymous visitors.
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      // Django settings.py:169-172
      httpOnly: true,
      sameSite: 'lax',
      secure: config.session.cookieSecure,
      maxAge: config.session.maxAgeSeconds * 1000,
      path: '/',
    },
  });

  return { middleware, store };
}

/**
 * Delete the browser's session cookie when it points at no session data, for
 * views that read the session and found it empty. express-session silently
 * starts a fresh session for an expired, unknown or forged cookie and leaves
 * the cookie alone; Django's SessionMiddleware deletes it instead (the load
 * failed, so the session "is empty").
 *
 * Django parity: django/contrib/sessions/middleware.py process_response (delete_cookie branch)
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} cookieName
 */
export function clearDeadSessionCookie(req, res, cookieName) {
  const hasData = Object.keys(req.session ?? {}).some((key) => key !== 'cookie');
  if (req.cookies?.[cookieName] !== undefined && !hasData) {
    // Same deletion as logout.
    res.clearCookie(cookieName, { path: '/', sameSite: 'lax' });
  }
}

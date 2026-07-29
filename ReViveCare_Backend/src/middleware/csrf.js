// CSRF protection matching what React relies on: GET /csrf/ sets a
// non-HttpOnly `csrftoken` cookie, React reads it and echoes it in the
// X-CSRFToken header, and unsafe requests to non-exempt Django views must
// carry both. Applied per route, like Django (most React POSTs are
// @csrf_exempt; only views without the decorator are protected).
//
// csrf-csrf does the double-submit check (header === cookie) and signs the
// token with CSRF_SECRET. Django's CsrfViewMiddleware also checks the Origin
// header first; that part is below.

import { doubleCsrf } from 'csrf-csrf';
import { AppError } from '../utils/httpErrors.js';
import { csrfFailurePage } from '../utils/djangoResponses.js';

// Django parity: CsrfViewMiddleware treats these as safe (no check).
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS', 'TRACE'];

/**
 * @param {object} csrfConfig config.csrf
 * @returns {{ ensureCsrfCookie: (req, res) => void, csrfProtect: import('express').RequestHandler }}
 */
export function createCsrf({ secret, cookieName, headerName, cookieMaxAgeSeconds, trustedOrigins }) {
  const { generateCsrfToken, validateRequest } = doubleCsrf({
    getSecret: () => secret,
    // Django's CSRF secret isn't tied to the session, and login regenerates the
    // session. A session-bound token fetched before login would then
    // fail on the next POST, so the token is deliberately not bound.
    getSessionIdentifier: () => '',
    cookieName,
    // Django defaults: CSRF_COOKIE_HTTPONLY=False (JS must read it),
    // SAMESITE='Lax', SECURE=False, AGE=one year, PATH='/'.
    cookieOptions: { httpOnly: false, sameSite: 'lax', secure: false, path: '/', maxAge: cookieMaxAgeSeconds * 1000 },
    getCsrfTokenFromRequest: (req) => req.headers[headerName],
    ignoredMethods: SAFE_METHODS,
  });

  const exactOrigins = new Set(trustedOrigins.filter((o) => !o.includes('*')));
  // 'https://*.example.com' → scheme 'https', pattern '.example.com'
  const wildcardOrigins = trustedOrigins
    .filter((o) => o.includes('*'))
    .map((o) => {
      const url = new URL(o.replace('*', 'wildcard-placeholder'));
      return { scheme: url.protocol.slice(0, -1), pattern: url.host.replace('wildcard-placeholder', '') };
    });

  // Django parity: CsrfViewMiddleware._origin_verified.
  function originVerified(req) {
    const origin = req.headers.origin;
    if (origin === `${req.protocol}://${req.headers.host}`) return true;
    if (exactOrigins.has(origin)) return true;
    let url;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    const scheme = url.protocol.slice(0, -1);
    return wildcardOrigins.some(
      ({ scheme: s, pattern }) => s === scheme && (url.host.endsWith(pattern) || url.host === pattern.slice(1)),
    );
  }

  const reject = (noCookie) => new AppError(403, csrfFailurePage({ noCookie }));

  return {
    /**
     * Django's @ensure_csrf_cookie: (re)send the csrftoken cookie, keeping a
     * still-valid existing token.
     */
    ensureCsrfCookie(req, res) {
      generateCsrfToken(req, res);
      res.vary('Cookie');
    },

    /** Django's CsrfViewMiddleware check for one view. */
    csrfProtect(req, res, next) {
      if (SAFE_METHODS.includes(req.method)) return next();
      // Same order as Django: Origin first, then the cookie, then the token.
      if (req.headers.origin !== undefined && !originVerified(req)) return next(reject(false));
      if (!req.cookies?.[cookieName]) return next(reject(true));
      if (!validateRequest(req)) return next(reject(false));
      next();
    },
  };
}

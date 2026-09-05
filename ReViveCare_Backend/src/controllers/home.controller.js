// HTTP side of the Django `Home` app. E03 GET /csrf/ is the only Home view
// Node serves; E02 `/` (the HTML landing page) is dropped and falls
// through to the Django-style 404.

import { sendJson } from '../utils/djangoResponses.js';

/**
 * @param {{ csrf: ReturnType<import('../middleware/csrf.js').createCsrf> }} deps
 */
export function createHomeController({ csrf }) {
  return {
    /**
     * Django parity: Home/views.py:get_csrf_token (@ensure_csrf_cookie).
     * Unsafe methods are checked by csrfProtect first (routes/index.js), as
     * Django's global CsrfViewMiddleware does before the view runs.
     */
    csrf(req, res) {
      csrf.ensureCsrfCookie(req, res);
      sendJson(res, 200, { success: 'CSRF cookie set' });
    },
  };
}

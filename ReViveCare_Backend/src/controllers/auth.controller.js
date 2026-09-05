// HTTP side of E07 POST /login/ and E09 /patient/logout/.
// Reads the request, calls the auth service, writes Django's exact response.

import { findLoginPatient, normalizeLoginEmail } from '../services/auth.service.js';
import { sendRedirect } from '../utils/djangoResponses.js';
import { LOGIN_SUCCESS_LOCATION } from '../middleware/rateLimit.js';

// express-session uses callbacks; these wrap them for async/await.
const regenerateSession = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const destroySession = (req) =>
  new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));

/**
 * @param {{ sessionCookieName: string }} deps
 */
export function createAuthController({ sessionCookieName }) {
  return {
    /** Django parity: Patients/views.py:login (POST branch) */
    async login(req, res) {
      const email = normalizeLoginEmail(req.body?.email);
      const patient = await findLoginPatient(email);
      if (!patient) {
        // Not found: the existing session (if any) is left untouched, as in Django.
        req.log.info('login failed: unknown email');
        return sendRedirect(res, '/');
      }
      // Intentional difference (fixes): a new session id and no
      // leftover data (e.g. another patient's chat_history). Django reused the session.
      await regenerateSession(req);
      req.session.patient_id = patient.id;
      req.session.patient_email = patient.email;
      req.session.patient_name = patient.name;
      req.log.info({ patientId: patient.id }, 'patient logged in');
      // Django's SessionMiddleware adds Vary: Cookie whenever the session was accessed.
      res.vary('Cookie');
      sendRedirect(res, LOGIN_SUCCESS_LOCATION);
    },

    /** Django parity: Patients/views.py:patient_logout (session.flush(), any method) */
    async logout(req, res) {
      const patientId = req.session.patient_id;
      const hadCookie = req.cookies[sessionCookieName] !== undefined;
      await destroySession(req);
      res.vary('Cookie'); // flush() accesses the session (Django SessionMiddleware)
      // Django's SessionMiddleware deletes the cookie when the request carried
      // one and the session is now empty.
      if (hadCookie) res.clearCookie(sessionCookieName, { path: '/', sameSite: 'lax' });
      req.log.info({ patientId }, 'patient logged out');
      sendRedirect(res, '/');
    },
  };
}

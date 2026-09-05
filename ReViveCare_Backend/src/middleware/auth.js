// Auth guards. Django has no auth decorators or roles in this project: each
// view checks `request.session.get('patient_id')` itself and answers in its
// own way (E08: 401 JSON; E11: 200 {"success": false, ...}). So the guard
// takes the endpoint's own "not logged in" response. There is no requireRole:
// Django has no doctor login and no role checks.

import { clearDeadSessionCookie } from './session.js';

/**
 * The logged-in patient's id, or null. Mirrors Python truthiness of
 * `request.session.get('patient_id')` (missing, None, 0 → not logged in).
 *
 * @param {import('express').Request} req
 * @returns {number | null}
 */
export function sessionPatientId(req) {
  const id = req.session?.patient_id;
  return id ? id : null;
}

/**
 * Let the request through only if the session has a patient_id.
 * Either way the session was read, so the response varies by cookie (Django's
 * SessionMiddleware adds `Vary: Cookie`). When there's no patient, a dead
 * session cookie is deleted first, as Django does.
 *
 * @param {import('express').RequestHandler} onUnauthenticated the endpoint's Django response
 * @param {string} sessionCookieName
 * @returns {import('express').RequestHandler}
 */
export function requirePatient(onUnauthenticated, sessionCookieName) {
  return (req, res, next) => {
    res.vary('Cookie');
    if (sessionPatientId(req) !== null) return next();
    clearDeadSessionCookie(req, res, sessionCookieName);
    onUnauthenticated(req, res, next);
  };
}

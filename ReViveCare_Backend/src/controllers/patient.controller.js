// HTTP side of E08 /patient/dashboard/. JSON mode is what React uses; the
// HTML template is dropped, but its redirects to /login/ are kept.

import { getDashboardPatient } from '../services/patient.service.js';
import { NOT_FOUND_PAGE, sendHtml, sendJson, sendRedirect } from '../utils/djangoResponses.js';
import { sessionPatientId } from '../middleware/auth.js';

/**
 * Django's test for "this is an API call (from React)": the raw Content-Type
 * header *equals* application/json (so "application/json; charset=utf-8"
 * doesn't count), or the Accept header *contains* it. Compared raw, not with
 * req.is() / req.accepts(), which parse and would accept more.
 *
 * Django parity: Patients/views.py:patient_dashboard
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isJsonMode(req) {
  return req.get('Content-Type') === 'application/json' || (req.get('Accept') ?? '').includes('application/json');
}

export function createPatientController() {
  return {
    /**
     * No patient_id in the session. Used as requirePatient's response (routes/index.js).
     * Django parity: Patients/views.py:patient_dashboard (`if not patient_id:`)
     */
    dashboardNotAuthenticated(req, res) {
      if (isJsonMode(req)) return sendJson(res, 401, { error: 'Not authenticated' });
      // HTML mode: Django also queued a messages.error for the dropped templates.
      sendRedirect(res, '/login/');
    },

    /** Django parity: Patients/views.py:patient_dashboard (logged-in branch) */
    async dashboard(req, res) {
      const patient = await getDashboardPatient(sessionPatientId(req));
      if (!patient) {
        // The row was deleted after login. Django keeps the session as it is.
        if (isJsonMode(req)) return sendJson(res, 404, { error: 'Patient not found' });
        return sendRedirect(res, '/login/');
      }
      if (isJsonMode(req)) {
        // Key order as in Django's dict: id, name, email, info.
        return sendJson(res, 200, {
          patient: { id: patient.id, name: patient.name, email: patient.email, info: patient.info },
        });
      }
      // Django rendered patient_dashboard.html here; the template is dropped.
      sendHtml(res, 404, NOT_FOUND_PAGE);
    },
  };
}

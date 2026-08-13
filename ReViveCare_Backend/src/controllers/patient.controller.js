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
 * Django parity: Patients/views.py:patient_dashboard (R-AUTH-02)
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isJsonMode(req) {
  return req.get('Content-Type') === 'application/json' || (req.get('Accept') ?? '').includes('application/json');
}

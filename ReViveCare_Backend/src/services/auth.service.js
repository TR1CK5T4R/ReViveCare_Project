// Patient login rules. Plain functions: no req/res, no SQL.

import { findPatientByEmail } from '../repositories/patient.repository.js';
import { pyLower, pyStrip } from '../utils/pythonCompat.js';

/**
 * The email exactly as Django's login view reads it:
 * `request.POST.get('email', '').strip().lower()`.
 * QueryDict.get returns the *last* value of a repeated field.
 *
 * Django parity: Patients/views.py:login (R-AUTH-01)
 *
 * @param {string | string[] | undefined} formValue req.body.email from express.urlencoded
 * @returns {string}
 */
export function normalizeLoginEmail(formValue) {
  const value = Array.isArray(formValue) ? formValue[formValue.length - 1] : formValue;
  return pyLower(pyStrip(typeof value === 'string' ? value : ''));
}

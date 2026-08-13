// Patient portal rules. Plain functions: no req/res, no SQL.

import { findPatientById } from '../repositories/patient.repository.js';

/**
 * The patient the dashboard shows, or null when the row no longer exists
 * (Django's Patient.DoesNotExist branch).
 *
 * Django parity: Patients/views.py:patient_dashboard (`Patient.objects.get(id=patient_id)`)
 *
 * @param {number} patientId the session's patient_id
 * @returns {Promise<{ id: number, name: string, email: string, info: string } | null>}
 */
export async function getDashboardPatient(patientId) {
  return findPatientById(patientId);
}

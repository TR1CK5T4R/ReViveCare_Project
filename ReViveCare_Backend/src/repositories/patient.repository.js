// SQL for patients. A patient is a `patients` row joined to its `users` row
//; patients.id is the id Django used and the API exposes.

import { query } from '../db/pool.js';

/**
 * Find a patient by exact email, like Django's Patient.objects.get(email=email):
 * case-sensitive, no trimming.
 *
 * @param {string} email
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ id: number, name: string, email: string } | null>}
 */
export async function findPatientByEmail(email, client) {
  const { rows } = await query(
    `SELECT p.id, u.name, u.email
       FROM users u
       JOIN patients p ON p.user_id = u.id
      WHERE u.email = $1 AND u.role = 'patient'`,
    [email],
    client,
  );
  return rows[0] ?? null;
}

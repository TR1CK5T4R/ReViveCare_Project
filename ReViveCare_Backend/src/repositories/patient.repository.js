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

/**
 * Find a patient by id, like Django's Patient.objects.get(id=patient_id).
 * No is_active filter and no ordering: .get() has neither.
 *
 * @param {number} id patients.id (the id Django used)
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ id: number, name: string, email: string, info: string } | null>}
 */
export async function findPatientById(id, client) {
  const { rows } = await query(
    `SELECT p.id, u.name, u.email, p.info
       FROM patients p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1`,
    [id],
    client,
  );
  return rows[0] ?? null;
}

/**
 * Lock and return the patient with exactly this email (case-sensitive), for
 * Django's update_or_create, which runs select_for_update().get(email=...).
 *
 * @param {string} email
 * @param {import('pg').PoolClient} client inside a transaction
 * @returns {Promise<{ patientId: number, userId: number } | null>}
 */
export async function findPatientForUpdateByEmail(email, client) {
  const { rows } = await query(
    `SELECT p.id AS "patientId", u.id AS "userId"
       FROM users u
       JOIN patients p ON p.user_id = u.id
      WHERE u.email = $1 AND u.role = 'patient'
        FOR UPDATE`,
    [email],
    client,
  );
  return rows[0] ?? null;
}

/**
 * Create a patient the way Django's Patient.objects.create(email, name, info)
 * did: every optional column NULL, is_active true, both timestamps clock_timestamp().
 * Two rows here (users + patients); call inside a transaction.
 *
 * @param {{ email: string, name: string, info: string }} patient
 * @param {import('pg').PoolClient} client
 * @returns {Promise<number>} the new patients.id
 */
export async function insertPatient({ email, name, info }, client) {
  const { rows: users } = await query(
    // clock_timestamp(), not the column default now() (= transaction start): Django
    // calls timezone.now() for each field when it saves, after taking the row lock.
    `INSERT INTO users (role, name, email, created_at, updated_at)
     VALUES ('patient', $1, $2, clock_timestamp(), clock_timestamp())
     RETURNING id`,
    [name, email],
    client,
  );
  const { rows } = await query(
    'INSERT INTO patients (user_id, info) VALUES ($1, $2) RETURNING id',
    [users[0].id, info],
    client,
  );
  return rows[0].id;
}

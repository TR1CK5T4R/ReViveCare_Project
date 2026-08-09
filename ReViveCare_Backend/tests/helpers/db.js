// Database helpers for integration tests: wipe tables, create rows.

import { query } from '../../src/db/pool.js';
import { withTransaction } from '../../src/db/tx.js';

export async function truncateAll() {
  await query(
    'TRUNCATE users, doctors, patients, exercise_sessions, chat_messages, patient_reports, sessions RESTART IDENTITY CASCADE',
  );
}

let counter = 0;

/**
 * Insert a patient (users + patients rows), like Django's doctor_info would.
 *
 * @returns {Promise<{ id: number, userId: number, name: string, email: string, info: string }>}
 */
export async function createPatient({ name, email, info = 'Knee replacement. Test data.' } = {}) {
  counter += 1;
  const values = { name: name ?? `Test Patient ${counter}`, email: email ?? `patient${counter}@example.test`, info };
  return withTransaction(async (client) => {
    const { rows: users } = await client.query(
      `INSERT INTO users (role, name, email) VALUES ('patient', $1, $2) RETURNING id`,
      [values.name, values.email],
    );
    const { rows: patients } = await client.query('INSERT INTO patients (user_id, info) VALUES ($1, $2) RETURNING id', [
      users[0].id,
      values.info,
    ]);
    return { id: patients[0].id, userId: users[0].id, ...values };
  });
}

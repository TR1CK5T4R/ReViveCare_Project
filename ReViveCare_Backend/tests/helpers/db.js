// Database helpers for integration tests: wipe tables, create rows.

import { query } from '../../src/db/pool.js';
import { withTransaction } from '../../src/db/tx.js';

export async function truncateAll() {
  await query(
    'TRUNCATE users, doctors, patients, exercise_sessions, chat_messages, patient_reports, sessions RESTART IDENTITY CASCADE',
  );
}

let counter = 0;

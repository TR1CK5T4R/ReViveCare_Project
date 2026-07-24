// Identity sequences don't advance when rows are inserted with explicit ids
// (the ETL keeps Django's ids; the seed assigns its own). Without this, the
// next normal INSERT would get id 1 and collide with an existing row.

import { query } from '../../src/db/pool.js';

// Every table with an identity id. Table names are interpolated below, so they
// must only ever come from this hard-coded list.
export const IDENTITY_TABLES = [
  'users',
  'doctors',
  'patients',
  'exercise_sessions',
  'chat_messages',
  'patient_reports',
];

/**
 * Move each identity sequence to max(id), so the next generated id is max + 1
 * (or 1 for an empty table).
 *
 * @param {import('pg').PoolClient} client
 */
export async function resetIdentitySequences(client) {
  for (const table of IDENTITY_TABLES) {
    await query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM ${table}`,
      [table],
      client,
    );
  }
}

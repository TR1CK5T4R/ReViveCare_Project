// Runs once before all test files: rebuilds revivecare_test from the migrations,
// so every run starts from the current schema.

import 'dotenv/config';
import { closePool, initPool } from '../../src/db/pool.js';
import { applyPending, resetSchema } from '../../scripts/lib/migrations.js';
import { resolveDatabase } from '../../scripts/lib/target.js';

export async function setup() {
  const target = resolveDatabase('TEST_DATABASE_URL');
  if (!target.dbName.endsWith('_test')) {
    throw new Error(`TEST_DATABASE_URL must point at a *_test database (got "${target.dbName}")`);
  }
  initPool({ connectionString: target.url, applicationName: 'revivecare-test-setup' });
  try {
    await resetSchema();
    await applyPending();
  } finally {
    await closePool();
  }
}

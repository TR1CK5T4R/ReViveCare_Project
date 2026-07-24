// Runs once before all test files: rebuilds revivecare_test from the migrations,
// so every run starts from the current schema.

import 'dotenv/config';
import { closePool, initPool } from '../../src/db/pool.js';
import { applyPending, resetSchema } from '../../scripts/lib/migrations.js';
import { resolveDatabase } from '../../scripts/lib/target.js';

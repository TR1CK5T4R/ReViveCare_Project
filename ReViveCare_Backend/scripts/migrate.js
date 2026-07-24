// Applies the plain-SQL migrations in db/migrations/ (engine: scripts/lib/migrations.js).
//
//   node scripts/migrate.js                  apply everything pending
//   node scripts/migrate.js --status         list applied / pending
//   node scripts/migrate.js --to 0006        apply pending files up to and including 0006
//   node scripts/migrate.js --reset          drop and recreate schema public (dev/test/parity only)
//   ... --database TEST_DATABASE_URL         pick the target (default DATABASE_URL)
//
// Forward-only by design: there are no down migrations. A mistake in an
// applied migration is fixed by a new migration, which is how production would
// have to do it anyway (a down script that drops a column would also drop data).
// Local databases are rebuilt with --reset instead of being rolled back.

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { closePool, initPool } from '../src/db/pool.js';
import { applyPending, migrationState, resetSchema } from './lib/migrations.js';
import { assertDisposableDatabase, resolveDatabase } from './lib/target.js';

const { values: args } = parseArgs({
  options: {
    database: { type: 'string', default: 'DATABASE_URL' },
    status: { type: 'boolean', default: false },
    to: { type: 'string' },
    reset: { type: 'boolean', default: false },
  },
});

async function main() {
  const target = resolveDatabase(args.database);
  initPool({ connectionString: target.url, applicationName: 'revivecare-migrate' });

  if (args.reset) {
    const env = process.env.NODE_ENV;
    if (env !== 'development' && env !== 'test') {
      throw new Error(`Refusing to reset: NODE_ENV must be development or test (got "${env ?? ''}")`);
    }
    assertDisposableDatabase(target.dbName, 'reset the schema');
    await resetSchema();
    console.log(`Reset schema public on ${target.dbName}`);
    return;
  }

  if (args.status) {
    const { files, applied, problems } = await migrationState();
    console.log(`Migrations on ${target.dbName}:`);
    for (const f of files) {
      const row = applied.get(f.version);
      console.log(`  ${row ? 'applied' : 'pending'}  ${f.file}${row ? `  (${row.applied_at})` : ''}`);
    }
    for (const p of problems) console.log(`  PROBLEM  ${p}`);
    return;
  }

  const count = await applyPending({ to: args.to, onApplied: (file) => console.log(`Applied ${file}`) });
  console.log(count === 0 ? `${target.dbName} is up to date` : `${target.dbName}: ${count} migration(s) applied`);
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}

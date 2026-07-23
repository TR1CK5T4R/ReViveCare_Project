// The migration engine behind scripts/migrate.js, also used by the test
// global setup. Plain SQL files in db/migrations/, applied in filename order,
// each in its own transaction, recorded with a SHA-256 checksum.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '../../src/db/pool.js';
import { withTransaction } from '../../src/db/tx.js';

export const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Read db/migrations/*.sql in filename order, with a SHA-256 of each file. */
export async function loadMigrationFiles() {
  const names = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const files = [];
  for (const file of names) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Bad migration file name "${file}" (expected 0001_some_name.sql)`);
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    files.push({
      version: match[1],
      name: match[2],
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return files;
}

/** Drop and recreate schema public. Callers must check the target is disposable first. */
export async function resetSchema() {
  await query('DROP SCHEMA public CASCADE');
  await query('CREATE SCHEMA public');
}

/**
 * Compare the files with schema_migrations.
 *
 * @returns {Promise<{ files: object[], applied: Map<string, object>, problems: string[] }>}
 */
export async function migrationState() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT,
      checksum   TEXT,
      applied_at TIMESTAMPTZ DEFAULT now()
    )`);
  const files = await loadMigrationFiles();
  const { rows } = await query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  const applied = new Map(rows.map((row) => [row.version, row]));

  // An applied migration must never change or disappear: the database would no
  // longer match what the files say it is.
  const problems = [];
  for (const row of rows) {
    const file = files.find((f) => f.version === row.version);
    if (!file) problems.push(`${row.version}_${row.name}.sql was applied but the file is missing`);
    else if (file.checksum !== row.checksum)
      problems.push(`${file.file} changed after it was applied (checksum mismatch)`);
  }
  return { files, applied, problems };
}

/**
 * Apply pending migrations (optionally only up to `to`).
 *
 * @param {{ to?: string, onApplied?: (file: string) => void }} [options]
 * @returns {Promise<number>} how many were applied
 * @throws if an applied file changed, `to` is unknown, or a migration fails
 */
export async function applyPending({ to, onApplied = () => {} } = {}) {
  const { files, applied, problems } = await migrationState();
  if (problems.length > 0) {
    throw new Error(
      `Refusing to migrate:\n  - ${problems.join('\n  - ')}\nWrite a new migration instead of editing an applied one.`,
    );
  }
  if (to !== undefined && !files.some((f) => f.version === to))
    throw new Error(`--to ${to}: no migration with that version`);
  const pending = files.filter((f) => !applied.has(f.version) && (to === undefined || f.version <= to));

  for (const migration of pending) {
    // Each file runs in its own transaction: a failing file leaves no partial
    // schema behind and is not recorded, and the earlier files stay applied.
    // (Two runners racing on the same file: the second one's INSERT hits the
    // primary key and its whole transaction rolls back.)
    try {
      await withTransaction(async (client) => {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
      });
    } catch (err) {
      throw new Error(`${migration.file} failed: ${err.message}`, { cause: err });
    }
    onApplied(migration.file);
  }
  return pending.length;
}

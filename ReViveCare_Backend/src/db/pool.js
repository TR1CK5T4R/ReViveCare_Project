// The single PostgreSQL connection pool, the type parsers that make `pg` return
// Django-compatible values, and the `query()` helper every repository uses.
// Request flow: repository → query() → pool → PostgreSQL.

import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const { Pool, types } = pg;

// ─── Type parsers ────────────────────────────────────────────────────────────
// These are global to the `pg` module: every pool and client in the process
// gets them, including the ones the scripts/ tools create.

// int8 (OID 20): BIGINT ids and COUNT(*). `pg` returns strings by default
// because int8 can exceed 2^53. Django returns plain ints and our ids stay far
// below 2^53, so Number is safe. We still refuse unsafe values loudly instead
// of silently returning a rounded id.
types.setTypeParser(types.builtins.INT8, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`int8 value ${value} is outside the safe integer range`);
  }
  return n;
});

// numeric (OID 1700): `pg` returns strings by default. We have no NUMERIC
// columns (Django FloatFields map to DOUBLE PRECISION, which `pg` already
// returns as numbers); numeric only appears from SQL expressions such as
// AVG(integer). Django's JsonResponse writes those Python floats as JSON
// numbers, and DRF (which would stringify Decimals) is never used. See.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number.parseFloat(value));

// date (OID 1082): the default builds a JS Date at *local* midnight, which
// shifts the day in negative-offset time zones. Keep Postgres's 'YYYY-MM-DD',
// which is also what Django's DateField serializes to.
types.setTypeParser(types.builtins.DATE, (value) => value);

// timestamptz (OID 1184): the default JS Date keeps only milliseconds, but
// Django stores microseconds. Keep the raw string ('2026-10-15 08:30:00.123456+00')
// so nothing is lost; utils/djangoSerialize.js turns it into whatever format
// the endpoint's Django encoder produces. No current endpoint returns a
// datetime. The session time zone is pinned to UTC
// below, so the offset is always +00.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => value);

// ─── Pool ────────────────────────────────────────────────────────────────────

const SLOW_QUERY_MS = 200;

let pool = null;

// Reporters for slow queries and idle-client errors. They default to a JSON
// line on stderr (used by the scripts/ tools); the app swaps in its pino
// logger at startup with setDbLogger().
let logSlowQuery = (entry) => {
  process.stderr.write(`${JSON.stringify({ level: 'warn', msg: 'slow query', ...entry })}\n`);
};
let logError = (entry) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', ...entry })}\n`);
};

/**
 * Create the process-wide pool. Call once at startup (server, script or test
 * setup). Calling it again without closePool() first is a bug, so it throws.
 *
 * @param {object} options
 * @param {string} options.connectionString postgres://… URL
 * @param {string} [options.applicationName] shows up in pg_stat_activity
 * @param {number} [options.max] pool size
 * @param {number} [options.idleTimeoutMillis]
 * @param {number} [options.connectionTimeoutMillis]
 * @param {number} [options.statementTimeoutMillis] server-side cap per statement
 * @returns {pg.Pool}
 */
export function initPool({
  connectionString,
  applicationName = 'revivecare-api',
  max = 10,
  idleTimeoutMillis = 30_000,
  connectionTimeoutMillis = 5_000,
  statementTimeoutMillis = 15_000,
}) {
  if (pool) throw new Error('Pool already initialised; call closePool() first');
  if (!connectionString) throw new Error('No database connection string');

  pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    // Server-side cap so one runaway query can't hold a connection forever.
    statement_timeout: statementTimeoutMillis,
    application_name: applicationName,
    // Django runs with TIME_ZONE='UTC' and USE_TZ=True. Pinning the session
    // zone makes now()::date, AT TIME ZONE and raw timestamptz text match it,
    // whatever zone the Postgres server or the laptop is in.
    options: '-c TimeZone=UTC',
  });

  // An idle client can lose its connection (DB restart, network). Without a
  // listener, that 'error' event would crash the process.
  pool.on('error', (err) => logError({ msg: 'idle pg client error', err: err.message }));

  return pool;
}

/**
 * The current pool.
 *
 * @returns {pg.Pool}
 * @throws if initPool() hasn't been called
 */
export function getPool() {
  if (!pool) throw new Error('Database pool not initialised: call initPool() first');
  return pool;
}

/**
 * Send slow-query warnings and idle-client errors to the app's logger.
 *
 * @param {import('pino').Logger} logger
 */
export function setDbLogger(logger) {
  logSlowQuery = (entry) => logger.warn(entry, 'slow query');
  logError = (entry) => logger.error(entry);
}

/**
 * Per-request count of app queries (dev only, see app.js): finds N+1 loops.
 * Counts query() calls; the session store's own SQL (one read per request with
 * a cookie, one write when the session changed) and BEGIN/COMMIT aren't included.
 */
export const requestQueries = new AsyncLocalStorage();

/**
 * Run one parameterized query. Values always go in `params` ($1, $2, …),
 * never into `text`.
 *
 * Queries slower than 200 ms are reported with their SQL text and duration
 * only; parameter values may hold patient data, so they are never logged.
 *
 * @param {string} text SQL with $n placeholders
 * @param {unknown[]} [params]
 * @param {pg.Pool | pg.PoolClient} [client] pass the transaction client inside withTransaction
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = [], client = getPool()) {
  const counter = requestQueries.getStore();
  if (counter) counter.count += 1;
  const started = performance.now();
  const result = await client.query(text, params);
  const durationMs = performance.now() - started;
  if (durationMs > SLOW_QUERY_MS) {
    logSlowQuery({
      sql: text.replace(/\s+/g, ' ').trim().slice(0, 500),
      durationMs: Math.round(durationMs),
      rows: result.rowCount,
    });
  }
  return result;
}

/**
 * Close every connection. Used on graceful shutdown, at the end of scripts and
 * after test runs. Safe to call when no pool exists.
 *
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}

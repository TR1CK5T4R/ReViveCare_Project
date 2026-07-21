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

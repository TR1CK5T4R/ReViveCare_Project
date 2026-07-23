// Shared by the scripts/ tools: which database a script talks to, and the
// guard that keeps destructive scripts away from anything but throwaway DBs.

// --database takes the *name* of an env var, never a URL, so connection
// strings (and passwords) never appear in shell history or npm scripts.
const DATABASE_ENV_VARS = ['DATABASE_URL', 'TEST_DATABASE_URL', 'PARITY_DATABASE_URL'];

// Databases whose contents may be wiped or filled with fake data.
const DISPOSABLE_SUFFIXES = ['_dev', '_test', '_parity'];

/**
 * Resolve the `--database <ENV_VAR>` option to a connection string.
 *
 * @param {string} [envVar] one of DATABASE_URL, TEST_DATABASE_URL, PARITY_DATABASE_URL
 * @returns {{ envVar: string, url: string, dbName: string }}
 */
export function resolveDatabase(envVar = 'DATABASE_URL') {
  if (!DATABASE_ENV_VARS.includes(envVar)) {
    throw new Error(`--database must be one of ${DATABASE_ENV_VARS.join(', ')} (got "${envVar}")`);
  }
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} is not set (add it to .env)`);
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!dbName) throw new Error(`${envVar} has no database name`);
  return { envVar, url, dbName };
}

/**
 * Throw unless the database name marks it as a dev/test/parity database.
 *
 * @param {string} dbName
 * @param {string} action what the caller is about to do, for the error message
 */
export function assertDisposableDatabase(dbName, action) {
  if (!DISPOSABLE_SUFFIXES.some((suffix) => dbName.endsWith(suffix))) {
    throw new Error(
      `Refusing to ${action} on "${dbName}": only databases ending in ${DISPOSABLE_SUFFIXES.join(', ')} are allowed`,
    );
  }
}

// withTransaction(): run several queries on one connection as a single unit.
// Services use it for multi-statement writes (e.g. doctor_info writes users +
// patients); the Django equivalent is transaction.atomic.

import { getPool } from './pool.js';

/**
 * Check out a client, BEGIN, run `fn(client)`, COMMIT. Any error rolls back
 * and is re-thrown. The client is always released.
 *
 * Every query inside `fn` must use the `client` it receives (e.g.
 * `query(sql, params, client)`); a query sent through the pool would run on a
 * different connection, outside the transaction.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @param {import('pg').Pool} [pool]
 * @returns {Promise<T>} whatever `fn` returns
 */
export async function withTransaction(fn, pool = getPool()) {
  const client = await pool.connect();
  // If ROLLBACK itself fails, the connection is in an unknown state; passing an
  // error to release() makes the pool destroy it instead of reusing it.
  let brokenConnection;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      brokenConnection = rollbackErr;
    }
    throw err;
  } finally {
    client.release(brokenConnection);
  }
}

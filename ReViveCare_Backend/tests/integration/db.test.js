// src/db: type parsers, the query helper and withTransaction.
import { describe, expect, it } from 'vitest';
import { getPool, query, setDbLogger } from '../../src/db/pool.js';
import { withTransaction } from '../../src/db/tx.js';
import { truncateAll } from '../helpers/db.js';

describe('type parsers', () => {
  it('returns int8 and COUNT(*) as numbers, like Django ints', async () => {
    const { rows } = await query('SELECT 42::bigint AS id, count(*) AS n FROM (VALUES (1), (2)) v');
    expect(rows[0]).toEqual({ id: 42, n: 2 });
  });

  it('refuses int8 values that would lose precision', async () => {
    await expect(query('SELECT 9007199254740993::bigint AS big')).rejects.toThrow(/safe integer/);
  });

  it('returns numeric as a number and date as a plain YYYY-MM-DD string', async () => {
    const { rows } = await query("SELECT avg(x) AS a, DATE '2026-01-31' AS d FROM (VALUES (1), (2)) v(x)");
    expect(rows[0]).toEqual({ a: 1.5, d: '2026-01-31' });
  });

  it('returns timestamptz as raw UTC text with microseconds (session TimeZone pinned to UTC)', async () => {
    const { rows } = await query("SELECT TIMESTAMPTZ '2026-02-05 21:55:33.134592+05:30' AS t");
    expect(rows[0].t).toBe('2026-02-05 16:25:33.134592+00');
  });
});

describe('query()', () => {
  it('reports slow queries with SQL text and duration only, never parameters', async () => {
    const entries = [];
    setDbLogger({ warn: (entry) => entries.push(entry), error: () => {} });
    await query('SELECT pg_sleep(0.25), $1::text AS secret', ['patient medical text']);
    expect(entries).toHaveLength(1);
    expect(entries[0].sql).toBe('SELECT pg_sleep(0.25), $1::text AS secret');
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(200);
    expect(JSON.stringify(entries)).not.toContain('patient medical text');
  });
});

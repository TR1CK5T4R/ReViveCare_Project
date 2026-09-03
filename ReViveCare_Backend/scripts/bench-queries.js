// Measures the hot queries with EXPLAIN (ANALYZE, BUFFERS) so the effect of
// db/migrations/0007_indexes.sql can be reported with real numbers.
//
//   node scripts/bench-queries.js --database PARITY_DATABASE_URL --save bench/baseline.json
//   node scripts/bench-queries.js --compare bench/baseline.json bench/indexed.json
//
// `npm run bench` runs the whole procedure: reset the parity DB, migrate up to
// 0006 (no secondary indexes), seed, bench → baseline.json, apply 0007, bench →
// indexed.json, print the comparison.
//
// Method, per query: resolve realistic parameters from the data, run it 5 times
// to warm the cache, then run EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) 20 times
// and keep Postgres's own "Execution Time" (server-side; excludes network and
// client time). Writes run inside BEGIN/ROLLBACK so the data doesn't change.
// Median = mean of the 10th and 11th of 20 sorted samples; p95 = nearest rank (19th).

import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { closePool, getPool, initPool } from '../src/db/pool.js';
import { resolveDatabase } from './lib/target.js';

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 20;
const ROOT = path.join(import.meta.dirname, '..');

// Each query is what the Node backend sends (and, for sessions,
// connect-pg-simple's own SQL). `candidate: true` marks queries no endpoint sends yet:
// they show what an unindexed access pattern costs; 0007 adds no index for them.
const QUERIES = [
  {
    id: 'login_lookup',
    serves: 'E07 POST /login/',
    sql: `SELECT p.id, u.name, u.email FROM users u JOIN patients p ON p.user_id = u.id
           WHERE u.email = $1 AND u.role = 'patient'`,
    params: (p) => [p.patientEmail],
  },
  {
    id: 'patient_by_id',
    serves: 'E08 GET /patient/dashboard/, E11 POST /patient/chatbot/send/',
    sql: `SELECT p.id, u.name, u.email, p.info FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    params: (p) => [p.patientId],
  },
  {
    id: 'doctor_info_lookup',
    serves: 'E06 POST /doctor_info (row-locked lookup before the upsert)',
    sql: `SELECT p.id, p.user_id FROM users u JOIN patients p ON p.user_id = u.id
           WHERE u.email = $1 AND u.role = 'patient' FOR UPDATE`,
    params: (p) => [p.patientEmail],
    write: true,
  },
  {
    id: 'session_load',
    serves: 'every request with a session cookie (connect-pg-simple get)',
    sql: `SELECT sess FROM sessions WHERE sid = $1 AND expire >= to_timestamp($2)`,
    params: (p) => [p.sid, p.nowEpoch],
  },
  {
    id: 'session_save',
    serves: 'login, chat, any request that changes the session (connect-pg-simple set)',
    sql: `INSERT INTO sessions (sess, expire, sid) SELECT $1, to_timestamp($2), $3
          ON CONFLICT (sid) DO UPDATE SET sess = $1, expire = to_timestamp($2) RETURNING sid`,
    params: (p) => [p.sess, p.nowEpoch + 86_400, p.sid],
    write: true,
  },
  {
    id: 'session_prune',
    serves: 'connect-pg-simple pruning, every 15 minutes',
    sql: `DELETE FROM sessions WHERE expire < to_timestamp($1)`,
    params: (p) => [p.nowEpoch],
    write: true,
  },
  {
    id: 'exercise_insert',
    serves: 'E23 POST /exercise/sessions/ (repositories/exercise.repository.js)',
    sql: `INSERT INTO exercise_sessions (patient_id, exercise_type, start_time, end_time, target_reps, excellent_reps,
            good_reps, partial_reps, accuracy_score, notes)
          VALUES ($1, 'arm-raises', now() - interval '5 minutes', now(), 12, 4, 9, 3, 75, NULL)
          RETURNING id, completed_reps`,
    params: (p) => [p.patientId],
    write: true,
  },
  {
    id: 'exercise_history',
    serves: 'candidate: latest 20 workouts of a patient (no endpoint reads them)',
    sql: `SELECT id, exercise_type, start_time, end_time, target_reps, completed_reps, accuracy_score
            FROM exercise_sessions WHERE patient_id = $1 ORDER BY start_time DESC LIMIT 20`,
    params: (p) => [p.activePatientId],
    candidate: true,
  },
  {
    id: 'chat_history',
    serves: 'candidate: stored chat of a patient (no endpoint; live history is in the session)',
    sql: `SELECT id, sender, message, seriousness_score, sent_at
            FROM chat_messages WHERE patient_id = $1 ORDER BY sent_at, id LIMIT 50`,
    params: (p) => [p.activePatientId],
    candidate: true,
  },
  {
    id: 'doctor_patient_list',
    serves: "candidate: a doctor's patients (React shows hard-coded data; no endpoint)",
    sql: `SELECT p.id, u.name, u.email FROM patients p JOIN users u ON u.id = p.user_id
           WHERE p.assigned_doctor_id = $1 ORDER BY u.updated_at DESC`,
    params: (p) => [p.doctorId],
    candidate: true,
  },
  {
    id: 'high_risk_messages',
    serves: 'candidate: latest AI replies above the 0.75 alert threshold (no endpoint)',
    sql: `SELECT id, patient_id, seriousness_score, sent_at FROM chat_messages
           WHERE sender = 'ai' AND seriousness_score > 0.75 ORDER BY sent_at DESC LIMIT 50`,
    params: () => [],
    candidate: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pick parameter values from the data deterministically (no random ids). */
async function resolveParams(client) {
  const one = async (sql) => (await client.query(sql)).rows[0];
  const patient = await one(
    `SELECT p.id, u.email FROM patients p JOIN users u ON u.id = p.user_id ORDER BY p.id OFFSET 600 LIMIT 1`,
  );
  const active = await one(
    `SELECT patient_id FROM exercise_sessions ORDER BY id OFFSET (SELECT count(*) / 2 FROM exercise_sessions) LIMIT 1`,
  );
  const doctor = await one(
    `SELECT assigned_doctor_id AS id FROM patients WHERE assigned_doctor_id IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1`,
  );
  const session = await one(
    `SELECT sid, sess::text AS sess FROM sessions WHERE expire > now() ORDER BY sid OFFSET 10000 LIMIT 1`,
  );
  if (!patient || !active || !doctor || !session)
    throw new Error('Database has too little data to benchmark: run the seed first');
  return {
    patientId: patient.id,
    patientEmail: patient.email,
    activePatientId: active.patient_id,
    doctorId: doctor.id,
    sid: session.sid,
    sess: session.sess,
    nowEpoch: Date.now() / 1000,
  };
}

function median(sorted) {
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

function percentile(sorted, p) {
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}

/** Every scan node in the plan, e.g. "Index Scan on users using users_email_role_key". */
function collectScans(plan, out = []) {
  if (plan['Node Type'].includes('Scan')) {
    const on = plan['Relation Name'] ? ` on ${plan['Relation Name']}` : '';
    const using = plan['Index Name'] ? ` using ${plan['Index Name']}` : '';
    out.push(`${plan['Node Type']}${on}${using}`);
  }
  for (const child of plan.Plans ?? []) collectScans(child, out);
  return out;
}

// Plans without a scan node (e.g. INSERT ... ON CONFLICT → "ModifyTable") show their top node.
function describePlan(summary) {
  return summary.scans.length > 0 ? summary.scans.join('; ') : summary.topNode;
}

async function runOnce(client, q, params, explain) {
  const sql = explain ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}` : q.sql;
  if (!q.write) return client.query(sql, params);
  await client.query('BEGIN');
  try {
    return await client.query(sql, params);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function benchQuery(client, q, params) {
  for (let i = 0; i < WARMUP_RUNS; i += 1) await runOnce(client, q, params, false);
  const exec = [];
  const planning = [];
  let last;
  for (let i = 0; i < MEASURED_RUNS; i += 1) {
    const { rows } = await runOnce(client, q, params, true);
    last = rows[0]['QUERY PLAN'][0];
    exec.push(last['Execution Time']);
    planning.push(last['Planning Time']);
  }
  exec.sort((a, b) => a - b);
  planning.sort((a, b) => a - b);
  const round3 = (x) => Math.round(x * 1000) / 1000;
  return {
    summary: {
      id: q.id,
      serves: q.serves,
      candidate: q.candidate === true,
      medianMs: round3(median(exec)),
      p95Ms: round3(percentile(exec, 95)),
      minMs: round3(exec[0]),
      maxMs: round3(exec[exec.length - 1]),
      planningMedianMs: round3(median(planning)),
      topNode: last.Plan['Node Type'],
      scans: collectScans(last.Plan),
      rowsReturned: last.Plan['Actual Rows'],
      sharedHitBlocks: last.Plan['Shared Hit Blocks'],
      sharedReadBlocks: last.Plan['Shared Read Blocks'],
    },
    plan: last,
  };
}

// ─── Modes ───────────────────────────────────────────────────────────────────

async function bench(databaseEnvVar, savePath) {
  const target = resolveDatabase(databaseEnvVar);
  initPool({ connectionString: target.url, applicationName: 'revivecare-bench' });
  const client = await getPool().connect();
  try {
    // Same, fresh statistics for both runs, so the planner sees the real table sizes.
    await client.query('ANALYZE');
    const params = await resolveParams(client);
    const tables = {};
    for (const t of [
      'users',
      'patients',
      'doctors',
      'exercise_sessions',
      'chat_messages',
      'patient_reports',
      'sessions',
    ]) {
      tables[t] = (await client.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n;
    }
    const { rows: migrations } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const { rows: version } = await client.query('SHOW server_version');

    const label = path.basename(savePath, '.json');
    const rawDir = path.join(ROOT, 'bench', 'raw', label);
    await mkdir(rawDir, { recursive: true });
    const results = [];
    for (const q of QUERIES) {
      const { summary, plan } = await benchQuery(client, q, q.params(params));
      results.push(summary);
      await writeFile(path.join(rawDir, `${q.id}.json`), JSON.stringify(plan, null, 2));
      console.log(
        `${q.id.padEnd(20)} median ${summary.medianMs.toFixed(3)} ms  p95 ${summary.p95Ms.toFixed(3)} ms  ${describePlan(summary)}`,
      );
    }

    const output = {
      label,
      database: target.dbName,
      measuredAt: new Date().toISOString(),
      postgresVersion: version[0].server_version,
      migrationsApplied: migrations.map((m) => m.version),
      method: `${WARMUP_RUNS} warm-up runs, then ${MEASURED_RUNS} x EXPLAIN (ANALYZE, BUFFERS); server-side Execution Time`,
      tableRows: tables,
      queries: results,
    };
    await mkdir(path.dirname(path.resolve(ROOT, savePath)), { recursive: true });
    await writeFile(path.resolve(ROOT, savePath), `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Saved ${savePath}`);
  } finally {
    client.release();
  }
}

async function compare(beforePath, afterPath) {
  const before = JSON.parse(await readFile(path.resolve(ROOT, beforePath), 'utf8'));
  const after = JSON.parse(await readFile(path.resolve(ROOT, afterPath), 'utf8'));
  const lines = [
    `Before: ${before.label} (migrations ${before.migrationsApplied.join(',')})  After: ${after.label} (migrations ${after.migrationsApplied.join(',')})`,
    '',
    '| Query | Serves | Before median / p95 (ms) | After median / p95 (ms) | Median change | Plan before → after |',
    '|---|---|---|---|---|---|',
  ];
  for (const b of before.queries) {
    const a = after.queries.find((q) => q.id === b.id);
    if (!a) continue;
    const change = ((a.medianMs - b.medianMs) / b.medianMs) * 100;
    const plan =
      describePlan(b) === describePlan(a)
        ? `${describePlan(b)} (unchanged)`
        : `${describePlan(b)} → ${describePlan(a)}`;
    lines.push(
      `| \`${b.id}\`${b.candidate ? ' (candidate)' : ''} | ${b.serves} | ${b.medianMs.toFixed(3)} / ${b.p95Ms.toFixed(3)} | ${a.medianMs.toFixed(3)} / ${a.p95Ms.toFixed(3)} | ${change >= 0 ? '+' : ''}${change.toFixed(0)}% | ${plan} |`,
    );
  }
  console.log(lines.join('\n'));
}

async function main() {
  const { values: args, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      database: { type: 'string', default: 'PARITY_DATABASE_URL' },
      save: { type: 'string' },
      compare: { type: 'boolean', default: false },
    },
  });
  if (args.compare) {
    if (positionals.length !== 2) throw new Error('Usage: --compare <before.json> <after.json>');
    await compare(positionals[0], positionals[1]);
  } else {
    if (!args.save) throw new Error('Usage: --save bench/<label>.json [--database PARITY_DATABASE_URL]');
    await bench(args.database, args.save);
  }
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}

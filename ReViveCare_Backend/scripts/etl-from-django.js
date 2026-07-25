// One-off copy of Django's data (a *copy* of db.sqlite3) into the PostgreSQL
// schema from db/migrations, following the mapping.
//
//   node scripts/etl-from-django.js <path-to-sqlite-copy> [--database DATABASE_URL]
//
// - Never reads legacy_django_backend/db.sqlite3 itself, and opens the copy read-only.
// - Refuses to run unless the target tables are empty.
// - Inserts everything in one transaction, in foreign-key order, keeping Django's ids.
// - Not migrated: django_session (all expired; users log in again),
//   auth_*, django_admin_log, django_content_type, django_migrations (unused).
// - No mapped column holds JSON, so there is no text → jsonb conversion to do.
// - Prints a verification report: row counts, field-by-field comparison of up
//   to 20 random rows per table, and foreign-key integrity checks. The report
//   contains ids and counts only, never names, emails or medical text.

import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { closePool, initPool, query } from '../src/db/pool.js';
import { withTransaction } from '../src/db/tx.js';
import { IDENTITY_TABLES as TARGET_TABLES, resetIdentitySequences } from './lib/sequences.js';
import { resolveDatabase } from './lib/target.js';

const DJANGO_DB = path.resolve(import.meta.dirname, '..', '..', 'legacy_django_backend', 'db.sqlite3');
const SAMPLE_SIZE = 20;

// ─── Value transforms ─────────────────────────────────

/** SQLite stores Django BooleanFields as 0/1 integers. */
function toBool(value, where) {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(`${where}: expected 0/1 boolean, got ${typeof value}`);
}

// Django on SQLite writes datetimes as naive text 'YYYY-MM-DD HH:MM:SS[.ffffff]'.
// With USE_TZ=True that text is UTC, so appending '+00' gives Postgres the exact
// instant, microseconds included.
const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

function toTimestamptz(value, where) {
  if (value === null) return null;
  if (typeof value !== 'string' || !SQLITE_DATETIME.test(value)) {
    throw new Error(`${where}: unexpected datetime format`);
  }
  return `${value}+00`;
}

/**
 * Microseconds since the epoch as a BigInt, for comparing a SQLite datetime
 * with a Postgres timestamptz string exactly (Date only keeps milliseconds).
 */
function epochMicros(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:([+-])(\d{2})(?::?(\d{2}))?)?$/.exec(
    text,
  );
  if (!m) throw new Error('unparseable datetime');
  const [, y, mo, d, h, mi, s, frac = '', sign, oh = '0', om = '0'] = m;
  const millis = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offsetMinutes = sign ? (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
  return BigInt(millis - offsetMinutes * 60_000) * 1000n + BigInt(frac.padEnd(6, '0'));
}

// ─── Table mapping, used for both loading and verifying ─────────────────────
// fields: [source column, target column, kind]. kind decides the transform
// and how values are compared.

const MAPPINGS = [
  {
    source: 'Doctor_doctor',
    target: 'doctors',
    targetSelect: `SELECT d.id, u.name, u.email, u.password, u.phone, u.is_active, u.created_at, u.updated_at,
                          d.specialty, d.license_number, u.role
                     FROM doctors d JOIN users u ON u.id = d.user_id
                    WHERE d.id = ANY($1::bigint[])`,
    fields: [
      ['name', 'name', 'text'],
      ['email', 'email', 'text'],
      ['password', 'password', 'text'],
      ['phone', 'phone', 'text'],
      ['is_active', 'is_active', 'bool'],
      ['created_at', 'created_at', 'datetime'],
      ['updated_at', 'updated_at', 'datetime'],
      ['specialty', 'specialty', 'text'],
      ['license_number', 'license_number', 'text'],
    ],
    expectedRole: 'doctor',
  },
  {
    source: 'Patients_patient',
    target: 'patients',
    targetSelect: `SELECT p.id, u.name, u.email, u.password, u.phone, u.is_active, u.created_at, u.updated_at,
                          p.age, p.gender, p.address, p.info, p.assigned_doctor_id, u.role
                     FROM patients p JOIN users u ON u.id = p.user_id
                    WHERE p.id = ANY($1::bigint[])`,
    fields: [
      ['name', 'name', 'text'],
      ['email', 'email', 'text'],
      ['password', 'password', 'text'],
      ['phone', 'phone', 'text'],
      ['is_active', 'is_active', 'bool'],
      ['created_at', 'created_at', 'datetime'],
      ['updated_at', 'updated_at', 'datetime'],
      ['age', 'age', 'number'],
      ['gender', 'gender', 'text'],
      ['address', 'address', 'text'],
      ['info', 'info', 'text'],
      ['assigned_doctor_id', 'assigned_doctor_id', 'number'],
    ],
    expectedRole: 'patient',
  },
  {
    source: 'Patients_exercisesession',
    target: 'exercise_sessions',
    targetSelect: `SELECT id, patient_id, exercise_type, start_time, end_time, target_reps, completed_reps,
                          excellent_reps, good_reps, partial_reps, accuracy_score, notes
                     FROM exercise_sessions WHERE id = ANY($1::bigint[])`,
    fields: [
      ['patient_id', 'patient_id', 'number'],
      ['exercise_type', 'exercise_type', 'text'],
      ['start_time', 'start_time', 'datetime'],
      ['end_time', 'end_time', 'datetime'],
      ['target_reps', 'target_reps', 'number'],
      ['completed_reps', 'completed_reps', 'number'],
      ['excellent_reps', 'excellent_reps', 'number'],
      ['good_reps', 'good_reps', 'number'],
      ['partial_reps', 'partial_reps', 'number'],
      ['accuracy_score', 'accuracy_score', 'number'],
      ['notes', 'notes', 'text'],
    ],
  },
  {
    source: 'Patients_chatmessage',
    target: 'chat_messages',
    targetSelect: `SELECT id, patient_id, sender, message, language, seriousness_score, sent_at
                     FROM chat_messages WHERE id = ANY($1::bigint[])`,
    fields: [
      ['patient_id', 'patient_id', 'number'],
      ['sender', 'sender', 'text'],
      ['message', 'message', 'text'],
      ['language', 'language', 'text'],
      ['seriousness_score', 'seriousness_score', 'number'],
      ['timestamp', 'sent_at', 'datetime'],
    ],
  },
  {
    source: 'Patients_patientreport',
    target: 'patient_reports',
    targetSelect: `SELECT id, patient_id, report_type, title, description, file_url, uploaded_by_doctor_id, created_at
                     FROM patient_reports WHERE id = ANY($1::bigint[])`,
    fields: [
      ['patient_id', 'patient_id', 'number'],
      ['report_type', 'report_type', 'text'],
      ['title', 'title', 'text'],
      ['description', 'description', 'text'],
      ['file_url', 'file_url', 'text'],
      ['uploaded_by_id', 'uploaded_by_doctor_id', 'number'],
      ['created_at', 'created_at', 'datetime'],
    ],
  },
];

// ─── Guards ──────────────────────────────────────────────────────────────────

function assertIsCopy(sqlitePath) {
  const resolved = realpathSync(sqlitePath);
  // No local Django checkout (e.g. a fresh clone): there's no original to protect.
  if (!existsSync(DJANGO_DB)) return resolved;
  const original = realpathSync(DJANGO_DB);
  const a = statSync(resolved);
  const b = statSync(original);
  // Same path, a symlink to it, or a hard link (same inode) all count as "the original".
  if (resolved === original || (a.dev === b.dev && a.ino === b.ino)) {
    throw new Error(
      'Refusing to read legacy_django_backend/db.sqlite3 directly: copy it to .parity-work/snapshots/ first',
    );
  }
  if (resolved.startsWith(path.dirname(original) + path.sep)) {
    throw new Error('Refusing to read a SQLite file inside legacy_django_backend/: copy it out first');
  }
  return resolved;
}

async function assertTargetReady() {
  for (const table of TARGET_TABLES) {
    const { rows } = await query('SELECT to_regclass($1) AS oid', [`public.${table}`]);
    if (rows[0].oid === null) throw new Error(`Table ${table} does not exist: run db:migrate first`);
    // Table names come from the hard-coded list above, never from input.
    const { rows: count } = await query(`SELECT count(*) AS n FROM ${table}`);
    if (count[0].n > 0)
      throw new Error(`Table ${table} is not empty (${count[0].n} rows): the ETL only loads into an empty schema`);
  }
}

// ─── Load ────────────────────────────────────────────────────────────────────

async function insertUser(client, row, role, where) {
  const { rows } = await query(
    `INSERT INTO users (role, name, email, password, phone, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      role,
      row.name,
      row.email,
      row.password,
      row.phone,
      toBool(row.is_active, where),
      toTimestamptz(row.created_at, where),
      toTimestamptz(row.updated_at, where),
    ],
    client,
  );
  return rows[0].id;
}

async function load(sqlite, client) {
  const all = (table) => sqlite.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();

  for (const d of all('Doctor_doctor')) {
    const where = `Doctor_doctor id=${d.id}`;
    const userId = await insertUser(client, d, 'doctor', where);
    await query(
      'INSERT INTO doctors (id, user_id, specialty, license_number) VALUES ($1, $2, $3, $4)',
      [d.id, userId, d.specialty, d.license_number],
      client,
    );
  }

  for (const p of all('Patients_patient')) {
    const where = `Patients_patient id=${p.id}`;
    const userId = await insertUser(client, p, 'patient', where);
    await query(
      `INSERT INTO patients (id, user_id, age, gender, address, info, assigned_doctor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [p.id, userId, p.age, p.gender, p.address, p.info, p.assigned_doctor_id],
      client,
    );
  }

  const { rows: types } = await query('SELECT code FROM exercise_types', [], client);
  const knownTypes = new Set(types.map((t) => t.code));
  for (const e of all('Patients_exercisesession')) {
    const where = `Patients_exercisesession id=${e.id}`;
    // completed_reps is a generated column now; prove the source agrees with the formula.
    if (e.completed_reps !== e.good_reps + e.partial_reps) {
      throw new Error(`${where}: completed_reps != good_reps + partial_reps`);
    }
    if (!knownTypes.has(e.exercise_type)) throw new Error(`${where}: unknown exercise_type "${e.exercise_type}"`);
    await query(
      `INSERT INTO exercise_sessions (id, patient_id, exercise_type, start_time, end_time, target_reps,
                                      excellent_reps, good_reps, partial_reps, accuracy_score, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        e.id,
        e.patient_id,
        e.exercise_type,
        toTimestamptz(e.start_time, where),
        toTimestamptz(e.end_time, where),
        e.target_reps,
        e.excellent_reps,
        e.good_reps,
        e.partial_reps,
        e.accuracy_score,
        e.notes,
      ],
      client,
    );
  }

  for (const c of all('Patients_chatmessage')) {
    const where = `Patients_chatmessage id=${c.id}`;
    await query(
      `INSERT INTO chat_messages (id, patient_id, sender, message, language, seriousness_score, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.id, c.patient_id, c.sender, c.message, c.language, c.seriousness_score, toTimestamptz(c.timestamp, where)],
      client,
    );
  }

  for (const r of all('Patients_patientreport')) {
    const where = `Patients_patientreport id=${r.id}`;
    await query(
      `INSERT INTO patient_reports (id, patient_id, report_type, title, description, file_url, uploaded_by_doctor_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        r.id,
        r.patient_id,
        r.report_type,
        r.title,
        r.description,
        r.file_url,
        r.uploaded_by_id,
        toTimestamptz(r.created_at, where),
      ],
      client,
    );
  }

  await resetIdentitySequences(client);
}

// ─── Verify ──────────────────────────────────────────────────────────────────

function sameValue(kind, source, target, where) {
  if (source === null || target === null) return source === target;
  if (kind === 'bool') return toBool(source, where) === target;
  if (kind === 'datetime') return epochMicros(source) === epochMicros(target);
  return source === target;
}

async function verify(sqlite) {
  const lines = [];
  const countOf = (table) => sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;

  lines.push('| Django table | Rows (SQLite) | Postgres table | Rows (Postgres) | Match |', '|---|---|---|---|---|');
  let allCountsMatch = true;
  for (const m of MAPPINGS) {
    const src = countOf(m.source);
    const { rows } = await query(`SELECT count(*) AS n FROM ${m.target}`);
    const ok = src === rows[0].n;
    allCountsMatch &&= ok;
    lines.push(`| \`${m.source}\` | ${src} | \`${m.target}\` | ${rows[0].n} | ${ok ? 'yes' : '**NO**'} |`);
  }
  const { rows: users } = await query(`SELECT role, count(*) AS n FROM users GROUP BY role ORDER BY role`);
  const userCounts = Object.fromEntries(users.map((r) => [r.role, r.n]));
  const usersOk =
    (userCounts.doctor ?? 0) === countOf('Doctor_doctor') && (userCounts.patient ?? 0) === countOf('Patients_patient');
  allCountsMatch &&= usersOk;
  lines.push(
    `| (doctors + patients) | ${countOf('Doctor_doctor') + countOf('Patients_patient')} | \`users\` | ${(userCounts.doctor ?? 0) + (userCounts.patient ?? 0)} | ${usersOk ? 'yes' : '**NO**'} |`,
  );

  lines.push('', `| Table | Rows sampled | Fields compared | Mismatches |`, '|---|---|---|---|');
  let mismatchTotal = 0;
  const mismatchDetails = [];
  for (const m of MAPPINGS) {
    const sample = sqlite.prepare(`SELECT * FROM "${m.source}" ORDER BY random() LIMIT ${SAMPLE_SIZE}`).all();
    const { rows } = await query(m.targetSelect, [sample.map((r) => r.id)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    let compared = 0;
    let mismatches = 0;
    for (const s of sample) {
      const t = byId.get(s.id);
      if (!t) {
        mismatches += 1;
        mismatchDetails.push(`${m.target} id=${s.id}: row missing`);
        continue;
      }
      if (m.expectedRole && t.role !== m.expectedRole) {
        mismatches += 1;
        mismatchDetails.push(`${m.target} id=${s.id}: users.role is ${t.role}`);
      }
      for (const [sourceCol, targetCol, kind] of m.fields) {
        compared += 1;
        if (!sameValue(kind, s[sourceCol], t[targetCol], `${m.source} id=${s.id}`)) {
          mismatches += 1;
          mismatchDetails.push(`${m.target} id=${s.id}: ${targetCol} differs`);
        }
      }
    }
    mismatchTotal += mismatches;
    lines.push(`| \`${m.target}\` | ${sample.length} | ${compared} | ${mismatches} |`);
  }

  // Postgres enforces these foreign keys, so the counts must be 0; the checks
  // prove it and also cover "every user has exactly one profile", which no
  // single constraint enforces.
  const integrity = [
    [
      'patients.user_id → users (role patient)',
      `SELECT count(*) AS n FROM patients p LEFT JOIN users u ON u.id = p.user_id AND u.role = 'patient' WHERE u.id IS NULL`,
    ],
    [
      'doctors.user_id → users (role doctor)',
      `SELECT count(*) AS n FROM doctors d LEFT JOIN users u ON u.id = d.user_id AND u.role = 'doctor' WHERE u.id IS NULL`,
    ],
    [
      'patients.assigned_doctor_id → doctors',
      `SELECT count(*) AS n FROM patients p LEFT JOIN doctors d ON d.id = p.assigned_doctor_id WHERE p.assigned_doctor_id IS NOT NULL AND d.id IS NULL`,
    ],
    [
      'exercise_sessions.patient_id → patients',
      `SELECT count(*) AS n FROM exercise_sessions e LEFT JOIN patients p ON p.id = e.patient_id WHERE p.id IS NULL`,
    ],
    [
      'chat_messages.patient_id → patients',
      `SELECT count(*) AS n FROM chat_messages c LEFT JOIN patients p ON p.id = c.patient_id WHERE p.id IS NULL`,
    ],
    [
      'patient_reports.patient_id → patients',
      `SELECT count(*) AS n FROM patient_reports r LEFT JOIN patients p ON p.id = r.patient_id WHERE p.id IS NULL`,
    ],
    [
      'patient_reports.uploaded_by_doctor_id → doctors',
      `SELECT count(*) AS n FROM patient_reports r LEFT JOIN doctors d ON d.id = r.uploaded_by_doctor_id WHERE r.uploaded_by_doctor_id IS NOT NULL AND d.id IS NULL`,
    ],
    [
      'users without a profile row',
      `SELECT count(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.user_id = u.id) AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.user_id = u.id)`,
    ],
  ];
  lines.push('', '| Integrity check | Violations |', '|---|---|');
  let integrityTotal = 0;
  for (const [label, sql] of integrity) {
    const { rows } = await query(sql);
    integrityTotal += rows[0].n;
    lines.push(`| ${label} | ${rows[0].n} |`);
  }

  const { rows: seq } = await query(
    `SELECT 'patients' AS t, pg_sequence_last_value(pg_get_serial_sequence('patients', 'id')) AS last, (SELECT max(id) FROM patients) AS max
     UNION ALL
     SELECT 'users', pg_sequence_last_value(pg_get_serial_sequence('users', 'id')), (SELECT max(id) FROM users)`,
  );
  lines.push('', '| Sequence | last_value | max(id) |', '|---|---|---|');
  for (const r of seq) lines.push(`| ${r.t} | ${r.last ?? '(unused)'} | ${r.max ?? '(empty)'} |`);

  if (mismatchDetails.length > 0) lines.push('', 'Mismatches:', ...mismatchDetails.map((d) => `- ${d}`));
  const ok = allCountsMatch && mismatchTotal === 0 && integrityTotal === 0;
  lines.push('', `Result: ${ok ? 'PASS' : 'FAIL'}`);
  return { ok, report: lines.join('\n') };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { values: args, positionals } = parseArgs({
    allowPositionals: true,
    options: { database: { type: 'string', default: 'DATABASE_URL' } },
  });
  if (positionals.length !== 1) {
    throw new Error('Usage: node scripts/etl-from-django.js <path-to-sqlite-copy> [--database DATABASE_URL]');
  }
  const sqlitePath = assertIsCopy(positionals[0]);
  const target = resolveDatabase(args.database);
  initPool({ connectionString: target.url, applicationName: 'revivecare-etl' });

  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    await assertTargetReady();
    await withTransaction((client) => load(sqlite, client));
    const { ok, report } = await verify(sqlite);
    console.log(`ETL ${path.basename(sqlitePath)} → ${target.dbName}\n\n${report}`);
    if (!ok) process.exitCode = 1;
  } finally {
    sqlite.close();
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

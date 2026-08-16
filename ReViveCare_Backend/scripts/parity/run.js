// Parity runner: proves the Node backend answers like Django.
//
//   npm run parity                         reset both sides, then run every scenario
//   node scripts/parity/run.js [--only auth] [--keep-reference-log]
//
// It starts the reference Django from .parity-work/django_ref (parity-tools/
// start-reference.sh, port 8001) and the Node app in-process against
// PARITY_DATABASE_URL, replays each scenario in tests/parity/scenarios/*.json
// against both with one cookie jar per backend, compares the results and
// writes tests/parity/report.md. Exit code 1 if anything differs that isn't a
// logged, approved difference. Format and rules:.

import 'dotenv/config';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { closePool, initPool, query } from '../../src/db/pool.js';
import { createLogger } from '../../src/utils/logger.js';
import { resolveDatabase } from '../lib/target.js';
import { startMockGroq } from './mockGroq.js';

const NODE_ROOT = path.join(import.meta.dirname, '..', '..');
const PROJECT_ROOT = path.join(NODE_ROOT, '..');
const PARITY_DIR = path.join(NODE_ROOT, 'tests', 'parity');
const DJANGO_DB = path.join(PROJECT_ROOT, '.parity-work', 'django_ref', 'db.sqlite3');
const REFERENCE_LOG = path.join(PROJECT_ROOT, '.parity-work', 'reference.log');
const DJANGO_PORT = 8001;
// The reference copy's .env points langchain_groq here (parity-tools/make-reference-copy.sh).
const DJANGO_MOCK_GROQ_PORT = 8002;
const PARITY_GROQ_KEY = 'parity-not-a-real-key';

// Cookies never compared: Django's `messages` cookie only feeds the dropped
// HTML templates.
const IGNORED_COOKIES = new Set(['messages']);

// ─── HTTP client (node:http: full control over Host/Origin, no redirects followed) ──

function send(baseUrl, step, jar) {
  const url = new URL(step.path, baseUrl);
  const headers = {};
  for (const [name, value] of Object.entries(step.headers ?? {})) {
    headers[name] = value.replaceAll('{origin}', url.origin);
  }
  let body;
  if (step.form !== undefined) {
    body = new URLSearchParams(step.form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (step.json !== undefined) {
    body = JSON.stringify(step.json);
    headers['Content-Type'] = 'application/json';
  } else if (step.body !== undefined) {
    body = step.body;
  } else if (step.body_hex !== undefined) {
    body = Buffer.from(step.body_hex, 'hex'); // bytes that aren't UTF-8 text (e.g. a UTF-16 body)
  }
  // Browsers send Content-Length; without it node:http uses chunked encoding,
  // which Django's runserver can't read (it sees an empty body).
  // ("chunked": true leaves it out on purpose, to test a body without one.)
  if (body !== undefined && !step.chunked) headers['Content-Length'] = Buffer.byteLength(body);
  if (jar.size > 0) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (step.csrf && jar.has('csrftoken')) headers['X-CSRFToken'] = decodeURIComponent(jar.get('csrftoken'));

  return new Promise((resolve, reject) => {
    // The path goes out exactly as written: `new URL()` would resolve dot
    // segments (also %2e%2e) and hide what a raw client can send.
    // agent:false = a fresh connection per request: Django's runserver leaves the
    // unread bytes of a chunked body on a kept-alive socket and parses them as the next request.
    const target = {
      hostname: url.hostname,
      port: url.port,
      path: step.path,
      method: step.method,
      headers,
      agent: false,
    };
    const req = http.request(target, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Text bodies are compared as text; anything else (e.g. the static videos) by
// size and SHA-256, so the report stays readable.
function bodyOf(res) {
  const type = res.headers['content-type'] ?? 'text/';
  if (/^(text\/|application\/json)/.test(type)) return res.raw.toString('utf8');
  return `${res.raw.length} bytes, sha256 ${createHash('sha256').update(res.raw).digest('hex')}`;
}

function parseSetCookie(header, dateHeader) {
  const [pair, ...attrs] = header.split(';').map((p) => p.trim());
  const eq = pair.indexOf('=');
  const cookie = { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs: {} };
  for (const a of attrs) {
    const [k, ...rest] = a.split('=');
    cookie.attrs[k.toLowerCase()] = rest.length ? rest.join('=') : true;
  }
  // Lifetime in seconds, from Max-Age or Expires (relative to the response Date).
  const now = dateHeader ? Date.parse(dateHeader) : Date.now();
  if (cookie.attrs['max-age'] !== undefined) cookie.lifetime = Number(cookie.attrs['max-age']);
  else if (cookie.attrs.expires) cookie.lifetime = Math.round((Date.parse(cookie.attrs.expires) - now) / 1000);
  else cookie.lifetime = null; // browser-session cookie
  return cookie;
}

function updateJar(jar, cookies) {
  for (const c of cookies) {
    if (c.lifetime !== null && c.lifetime <= 0) jar.delete(c.name);
    else jar.set(c.name, c.value);
  }
}

// ─── Session decoding ────────────────────────────────────────────────────────

// Django 6 stores signing.dumps(data, compress=True): "<payload>:<timestamp>:<signature>",
// payload = urlsafe base64 JSON, zlib-compressed when it starts with '.'.
function djangoSession(sessionKey) {
  if (!sessionKey) return null;
  const db = new Database(DJANGO_DB, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare("SELECT session_data FROM django_session WHERE session_key = ? AND expire_date > datetime('now')")
      .get(sessionKey);
    if (!row) return null;
    let payload = row.session_data.split(':')[0];
    const compressed = payload.startsWith('.');
    if (compressed) payload = payload.slice(1);
    let bytes = Buffer.from(payload, 'base64url');
    if (compressed) bytes = inflateSync(bytes);
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    db.close();
  }
}

async function nodeSession(cookieValue) {
  if (!cookieValue) return null;
  const decoded = decodeURIComponent(cookieValue);
  const sid = decoded.slice(2, decoded.lastIndexOf('.')); // "s:<sid>.<signature>"
  const { rows } = await query('SELECT sess FROM sessions WHERE sid = $1 AND expire > now()', [sid]);
  if (rows.length === 0) return null;
  const { cookie: _cookieSettings, ...data } = rows[0].sess; // express-session bookkeeping
  return data;
}

// ─── Data actions (change both sides the same way between HTTP steps) ─────────

// { "action": "delete_patient", "email": ... }: the patient row disappears
// after login, as if deleted through the Django admin. The Django side writes
// only to the throwaway copy's database (.parity-work/django_ref).
async function deletePatient(email) {
  const db = new Database(DJANGO_DB, { fileMustExist: true });
  try {
    const { changes } = db.prepare('DELETE FROM "Patients_patient" WHERE email = ?').run(email);
    if (changes !== 1) throw new Error(`delete_patient: ${email} not found in the Django copy`);
  } finally {
    db.close();
  }
  // users → patients is ON DELETE CASCADE (0002_patients_doctors.sql).
  const { rowCount } = await query("DELETE FROM users WHERE email = $1 AND role = 'patient'", [email]);
  if (rowCount !== 1) throw new Error(`delete_patient: ${email} not found in Postgres`);
}

const ACTIONS = { delete_patient: (step) => deletePatient(step.email) };

// ─── Stored rows (write scenarios: "compare_patients": true) ───────────────────

// Every patient's business columns, in id order, as Django stored them.
function djangoPatients() {
  const db = new Database(DJANGO_DB, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        `SELECT id, name, email, info, password, phone, age, gender, address, assigned_doctor_id, is_active
           FROM "Patients_patient" ORDER BY id`,
      )
      .all()
      .map((row) => ({ ...row, is_active: row.is_active === 1 }));
  } finally {
    db.close();
  }
}

// A readable, privacy-safe summary for the report: which ids/columns differ.
// Values are shown only for synthetic patients (emails ending in .test); the
// snapshot also holds real patients, whose data must not reach report.md.
function rowDiff(djangoRows, nodeRows) {
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const d = byId(djangoRows);
  const n = byId(nodeRows);
  const out = { django: [], node: [] };
  for (const id of new Set([...d.keys(), ...n.keys()])) {
    const a = d.get(id);
    const b = n.get(id);
    const columns = Object.keys(a ?? b).filter((c) => stable(a?.[c]) !== stable(b?.[c]));
    if (!columns.length) continue;
    const show = (row) => {
      if (!row) return { id, row: 'missing' };
      if (!String(row.email).endsWith('.test')) return { id, row: `columns differ: ${columns.join(', ')}` };
      return { id, ...Object.fromEntries(columns.map((c) => [c, row[c]])) };
    };
    out.django.push(show(a));
    out.node.push(show(b));
  }
  return out;
}

async function nodePatients() {
  const { rows } = await query(
    `SELECT p.id, u.name, u.email, p.info, u.password, u.phone, p.age, p.gender, p.address,
            p.assigned_doctor_id, u.is_active
       FROM patients p JOIN users u ON u.id = p.user_id ORDER BY p.id`,
  );
  return rows;
}

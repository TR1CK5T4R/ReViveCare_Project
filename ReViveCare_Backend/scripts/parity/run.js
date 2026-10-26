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
// logged, approved difference.

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

// ─── Comparison ──────────────────────────────────────────────────────────────

const LIST_HEADERS = new Set(['access-control-allow-methods', 'access-control-allow-headers', 'vary']);

function normalizeHeader(name, value) {
  if (value === undefined) return undefined;
  if (LIST_HEADERS.has(name)) {
    return value
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .sort()
      .join(',');
  }
  return value;
}

function deleteJsonPath(obj, jsonPath) {
  // Supports $.a.b and $.items[*].x
  const parts = jsonPath.replace(/^\$\.?/, '').split('.');
  const walk = (node, i) => {
    if (node === null || typeof node !== 'object') return;
    const part = parts[i];
    const star = part.endsWith('[*]');
    const key = star ? part.slice(0, -3) : part;
    if (i === parts.length - 1 && !star) return void delete node[key];
    const next = node[key];
    if (star && Array.isArray(next)) next.forEach((item) => walk(item, i + 1));
    else walk(next, i + 1);
  };
  walk(obj, 0);
}

function stable(value) {
  return JSON.stringify(value, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v,
  );
}

function compareStep(step, scenario, d, n) {
  const diffs = [];
  const add = (kind, django, node) => diffs.push({ kind, django, node });

  if (d.status !== n.status) add('status', d.status, n.status);

  for (const name of ['location', 'content-type', ...(step.compare_headers ?? [])]) {
    const dv = normalizeHeader(name, d.headers[name]);
    const nv = normalizeHeader(name, n.headers[name]);
    // HTML error pages: only the status is compared, so skip their content type.
    if (name === 'content-type' && d.status >= 400 && (dv ?? '').startsWith('text/html')) continue;
    if (dv !== nv) add(`header:${name}`, dv, nv);
  }

  const cookieMap = (res) =>
    new Map(
      (res.headers['set-cookie'] ?? [])
        .map((h) => parseSetCookie(h, res.headers.date))
        .filter((c) => !IGNORED_COOKIES.has(c.name))
        .map((c) => [c.name, c]),
    );
  const dc = cookieMap(d);
  const nc = cookieMap(n);
  for (const name of new Set([...dc.keys(), ...nc.keys()])) {
    const describe = (c) =>
      c
        ? {
            httponly: c.attrs.httponly === true,
            secure: c.attrs.secure === true,
            samesite: String(c.attrs.samesite ?? '').toLowerCase(),
            path: c.attrs.path ?? null,
            // Values are random on both sides; lifetimes compared to the minute.
            lifetime: c.lifetime === null ? 'session' : c.lifetime <= 0 ? 'deleted' : Math.round(c.lifetime / 60) * 60,
          }
        : 'not set';
    const a = describe(dc.get(name));
    const b = describe(nc.get(name));
    if (stable(a) !== stable(b)) add(`cookie:${name}`, a, b);
  }

  d = { ...d, body: bodyOf(d) };
  n = { ...n, body: bodyOf(n) };
  const isJson = (r) => (r.headers['content-type'] ?? '').startsWith('application/json');
  // HEAD responses have a JSON content type but no body: compare those as text.
  if (isJson(d) && isJson(n) && d.body !== '' && n.body !== '') {
    const parse = (text) => {
      const value = JSON.parse(text);
      for (const p of scenario.ignore ?? []) deleteJsonPath(value, p);
      return value;
    };
    const dj = parse(d.body);
    const nj = parse(n.body);
    if (stable(dj) !== stable(nj)) add('body', dj, nj);
  } else if (!(d.status >= 400 && (d.headers['content-type'] ?? '').startsWith('text/html')) || step.compare_body) {
    if (d.body !== n.body) add('body', d.body.slice(0, 300), n.body.slice(0, 300));
  }
  return diffs;
}

// ─── Servers ─────────────────────────────────────────────────────────────────

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await send(url, { method: 'GET', path: '/csrf/' }, new Map());
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Reference Django did not start within ${timeoutMs / 1000}s (see ${REFERENCE_LOG})`);
}

function startReference() {
  const log = createWriteStream(REFERENCE_LOG);
  const child = spawn('bash', [path.join(PROJECT_ROOT, 'parity-tools', 'start-reference.sh'), String(DJANGO_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

async function startNode(groqBaseURL) {
  const target = resolveDatabase('PARITY_DATABASE_URL');
  // Fixed parity-only settings that mirror the reference copy's .env, so the
  // comparison doesn't depend on a developer's own .env.
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: target.url,
    SESSION_SECRET: 'parity-session-secret-not-a-real-secret',
    CSRF_SECRET: 'parity-csrf-secret-not-a-real-secret-xx',
    ALLOWED_HOSTS: 'localhost,127.0.0.1',
    LOG_LEVEL: 'silent',
    LOGIN_RATE_LIMIT_MAX: '100000', // scenarios log in many times from one IP
    CHAT_RATE_LIMIT_MAX: '100000', // Django has no chat limit; scenarios chat a lot
    // Chat: a local mock instead of Groq. Alert settings stay unset, as in the
    // reference's .env (empty values there; see alertSettings for the difference).
    GROQ_API_KEY: PARITY_GROQ_KEY,
    GROQ_BASE_URL: groqBaseURL,
  });
  initPool({ ...config.db, applicationName: 'revivecare-parity' });
  const app = createApp({ config, logger: createLogger(config.log) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { app, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

async function loadScenarios(only) {
  const dir = path.join(PARITY_DIR, 'scenarios');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`)).sort();
  const actors = JSON.parse(await readFile(path.join(PARITY_DIR, 'fixtures', 'actors.json'), 'utf8'));
  const scenarios = [];
  for (const file of files) {
    for (const s of JSON.parse(await readFile(path.join(dir, file), 'utf8'))) {
      const steps = [...s.steps];
      if (s.actor) {
        if (!actors[s.actor]) throw new Error(`${file}: unknown actor "${s.actor}"`);
        steps.unshift({
          label: `log in as ${s.actor}`,
          method: 'POST',
          path: '/login/',
          form: { email: actors[s.actor].email },
        });
      }
      scenarios.push({ ...s, file, steps });
    }
  }
  return scenarios;
}

async function runScenario(scenario, djangoUrl, nodeUrl, mocks) {
  const jars = { django: new Map(), node: new Map() };
  const results = [];
  for (const [index, step] of scenario.steps.entries()) {
    if (step.action) {
      if (!ACTIONS[step.action]) throw new Error(`${scenario.file}: unknown action "${step.action}"`);
      await ACTIONS[step.action](step);
      results.push({ index, label: step.label ?? `${step.action} ${step.email ?? ''}`.trim(), diffs: [] });
      continue;
    }
    const llmBefore = { django: mocks.django.requests.length, node: mocks.node.requests.length };
    const d = await send(djangoUrl, step, jars.django);
    const n = await send(nodeUrl, step, jars.node);
    let diffs = compareStep(step, scenario, d, n);
    // What each backend sent to the model during this step (every attempt, so retries count).
    if (step.compare_llm_request) {
      const sent = (side) => mocks[side].requests.slice(llmBefore[side]);
      if (stable(sent('django')) !== stable(sent('node'))) {
        diffs.push({ kind: 'llm_request', django: sent('django'), node: sent('node') });
      }
    }
    updateJar(
      jars.django,
      (d.headers['set-cookie'] ?? []).map((h) => parseSetCookie(h, d.headers.date)),
    );
    updateJar(
      jars.node,
      (n.headers['set-cookie'] ?? []).map((h) => parseSetCookie(h, n.headers.date)),
    );
    if (step.compare_patients) {
      const dp = djangoPatients();
      const np = await nodePatients();
      if (stable(dp) !== stable(np)) diffs.push({ kind: 'rows', ...rowDiff(dp, np) });
    }
    if (step.compare_session) {
      const ds = djangoSession(jars.django.get('sessionid'));
      const ns = await nodeSession(jars.node.get('sessionid'));
      if (stable(ds) !== stable(ns)) diffs.push({ kind: 'session', django: ds, node: ns });
    }
    // Differences this scenario documents as approved (with a decision id).
    diffs = diffs.map((diff) => {
      const known = (scenario.expected_differences ?? []).find((e) => e.step === index && e.kind === diff.kind);
      return known ? { ...diff, approved: known.decision, reason: known.reason } : diff;
    });
    results.push({ index, label: step.label ?? `${step.method} ${step.path}`, diffs });
  }
  const unexpected = results.flatMap((r) => r.diffs).filter((d) => !d.approved);
  const approved = results.flatMap((r) => r.diffs).filter((d) => d.approved);
  return {
    scenario,
    results,
    status: unexpected.length ? 'FAIL' : approved.length ? 'PASS (logged differences)' : 'PASS',
  };
}

function report(outcomes) {
  const lines = [
    '# Parity report',
    '',
    `Generated by \`scripts/parity/run.js\` on ${new Date().toISOString()}. Django reference: \`.parity-work/django_ref\` (DEBUG=True, SQLite \`parity.sqlite3\`); Node: in-process app on \`revivecare_parity\` (ETL of the same snapshot).`,
    '',
    'Compared per step: status, `Location`, `Content-Type`, listed headers, cookie attributes and lifetime (values are random on both sides), JSON bodies, non-error bodies, and the decoded server-side session when the step asks for it. Django HTML error pages: status only.',
    '',
    '| Scenario | File | Steps | Result |',
    '|---|---|---|---|',
    ...outcomes.map((o) => `| ${o.scenario.name} | ${o.scenario.file} | ${o.results.length} | ${o.status} |`),
    '',
  ];
  for (const o of outcomes) {
    const withDiffs = o.results.filter((r) => r.diffs.length);
    if (!withDiffs.length) continue;
    lines.push(`## ${o.scenario.name} — ${o.status}`, '');
    for (const r of withDiffs) {
      for (const d of r.diffs) {
        const tag = d.approved ? `logged difference (${d.approved}): ${d.reason}` : '**UNEXPECTED**';
        lines.push(`- step ${r.index} \`${r.label}\` — ${d.kind} — ${tag}`);
        lines.push(`  - Django: \`${JSON.stringify(d.django)}\``, `  - Node: \`${JSON.stringify(d.node)}\``);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const { values: args } = parseArgs({ options: { only: { type: 'string' } } });
  const scenarios = await loadScenarios(args.only);
  const replies = JSON.parse(await readFile(path.join(PARITY_DIR, 'fixtures', 'llm_replies.json'), 'utf8'));
  const mocks = { django: await startMockGroq(replies, DJANGO_MOCK_GROQ_PORT), node: await startMockGroq(replies, 0) };
  const reference = startReference();
  let node;
  try {
    const djangoUrl = `http://127.0.0.1:${DJANGO_PORT}`;
    await waitFor(djangoUrl, 90_000);
    node = await startNode(`http://127.0.0.1:${mocks.node.port}`);
    const outcomes = [];
    for (const scenario of scenarios) {
      const outcome = await runScenario(scenario, djangoUrl, node.baseUrl, mocks);
      outcomes.push(outcome);
      console.log(`${outcome.status.padEnd(26)} ${scenario.name}`);
    }
    await writeFile(path.join(PARITY_DIR, 'report.md'), `${report(outcomes)}\n`);
    const failed = outcomes.filter((o) => o.status === 'FAIL').length;
    console.log(`\n${outcomes.length - failed}/${outcomes.length} scenarios pass. Report: tests/parity/report.md`);
    if (failed) process.exitCode = 1;
  } finally {
    reference.kill('SIGTERM');
    await Promise.all([mocks.django.close(), mocks.node.close()]);
    if (node) {
      await new Promise((r) => node.server.close(r));
      node.app.locals.sessionStore.close();
    }
    await closePool();
  }
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}

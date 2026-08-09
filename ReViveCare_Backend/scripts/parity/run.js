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

}

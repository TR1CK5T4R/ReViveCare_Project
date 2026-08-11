// Writes tests/fixtures/node_password_hashes.json: hashes made by
// src/utils/djangoPassword.js with fixed salts, for Django to check
// (`parity-tools/golden.sh verify-node` adds Django's verdict to each entry).
// Fixed salts make the output reproducible, so the unit test can also prove
// the fixture still matches what makePassword produces today.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makePassword, PBKDF2_ITERATIONS } from '../../src/utils/djangoPassword.js';

const PASSWORDS = [
  '',
  'password',
  'pässwörd',
  'パスワード',
  '🔑🔒',
  ' spaced ',
  'नमस्ते',
  'quote"apos\'back\\slash',
  'a'.repeat(200),
];

const entries = [];
for (const [i, password] of PASSWORDS.entries()) {
  // Two at the real iteration count; the rest low, to keep tests fast.
  const iterations = i < 2 ? PBKDF2_ITERATIONS : 1000 + i;
  const salt = `nodeFixtureSalt${String(i).padStart(7, '0')}`; // 22 chars, [a-zA-Z0-9]
  entries.push({ password, salt, iterations, encoded: await makePassword(password, { salt, iterations }) });
}
const out = path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'node_password_hashes.json');
await writeFile(out, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`wrote ${entries.length} hashes to ${out}`);

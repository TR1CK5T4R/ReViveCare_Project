// Django-compatible password hashing (django.contrib.auth.hashers, Django 6.0.2).
// Hashes look like 'pbkdf2_sha256$1200000$<22-char salt>$<base64 sha256>' and
// are interchangeable with Django's: verified both ways by golden tests
// (tests/fixtures/django_password_vectors.json, node_password_hashes.json).
// No view in this project checks passwords yet; the seed uses makePassword.

import { pbkdf2, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

// Django 6.0.2 PBKDF2PasswordHasher.iterations (hashers.py:327). New hashes use it.
export const PBKDF2_ITERATIONS = 1_200_000;

// The hashers in Django's default PASSWORD_HASHERS that use PBKDF2. Argon2,
// bcrypt and scrypt are also in that list but need extra libraries and no
// such hashes exist in the data, so they verify as false.
const PBKDF2_DIGESTS = {
  pbkdf2_sha256: { digest: 'sha256', length: 32 },
  pbkdf2_sha1: { digest: 'sha1', length: 20 },
};

// Django: UNUSABLE_PASSWORD_PREFIX, set by make_password(None) / set_unusable_password().
const UNUSABLE_PASSWORD_PREFIX = '!';
const SALT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Random salt like Django's: 22 characters from [a-zA-Z0-9] (≈128 bits).
 *
 * @returns {string}
 */
export function makeSalt() {
  let salt = '';
  for (let i = 0; i < 22; i += 1) salt += SALT_CHARS[randomInt(SALT_CHARS.length)];
  return salt;
}

async function encode(password, salt, iterations, algorithm = 'pbkdf2_sha256') {
  const { digest, length } = PBKDF2_DIGESTS[algorithm];
  const hash = (await pbkdf2Async(password, salt, iterations, length, digest)).toString('base64');
  return `${algorithm}$${iterations}$${salt}$${hash}`;
}

/**
 * Hash a password like Django's make_password() with the default hasher.
 *
 * @param {string} password
 * @param {{ salt?: string, iterations?: number }} [options] fixed salt/iterations are for tests
 * @returns {Promise<string>}
 */
export async function makePassword(password, { salt = makeSalt(), iterations = PBKDF2_ITERATIONS } = {}) {
  if (typeof password !== 'string') throw new TypeError('password must be a string');
  if (salt.includes('$')) throw new Error('salt must not contain "$"');
  return encode(password, salt, iterations);
}

/**
 * Check a password against a stored hash, like Django's check_password().
 * Runs in constant time with respect to the hash contents, and, like Django,
 * spends the time of a real hash when the stored value is unusable or
 * unknown, so response timing doesn't reveal which case it was.
 *
 * Difference: for a malformed pbkdf2 hash (wrong number of '$' parts) Django
 * raises ValueError; this returns false (logged).
 *
 * @param {string} password
 * @param {string | null | undefined} encoded
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const [algorithm, iterationsText, salt, hash] = parts;
  const usable =
    typeof password === 'string' &&
    typeof encoded === 'string' &&
    !encoded.startsWith(UNUSABLE_PASSWORD_PREFIX) &&
    parts.length === 4 &&
    Object.hasOwn(PBKDF2_DIGESTS, algorithm) &&
    /^\d+$/.test(iterationsText) &&
    hash !== '';

  if (!usable) {
    // Django parity: hashers.verify_password "fake_runtime" branch.
    await makePassword(makeSalt());
    return false;
  }

  const recomputed = await encode(password, salt, Number(iterationsText), algorithm);
  const a = Buffer.from(recomputed);
  const b = Buffer.from(encoded);
  return a.length === b.length && timingSafeEqual(a, b);
}

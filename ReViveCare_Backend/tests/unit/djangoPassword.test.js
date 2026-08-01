import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makePassword, makeSalt, PBKDF2_ITERATIONS, verifyPassword } from '../../src/utils/djangoPassword.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
// Made by Django's make_password / hashers (parity-tools/golden/password_vectors.py generate)
const djangoVectors = fixture('django_password_vectors.json');
// Made by makePassword, then checked by Django's check_password (golden.sh verify-node)
const nodeHashes = fixture('node_password_hashes.json');

describe('verifyPassword against hashes made by Django', () => {
  it('agrees with Django check_password() on every golden vector', async () => {
    const results = await Promise.all(djangoVectors.map((v) => verifyPassword(v.password, v.encoded)));
    djangoVectors.forEach((v, i) => {
      // Django raises ValueError for a malformed pbkdf2 hash; Node returns false.
      const expected = v.django_check_password === true;
      expect({ password: v.password, encoded: v.encoded, result: results[i] }).toEqual({
        password: v.password,
        encoded: v.encoded,
        result: expected,
      });
    });
  });

  it('covers the default iteration count, the sha1 hasher and the rejection cases', () => {
    expect(djangoVectors.some((v) => v.encoded.startsWith(`pbkdf2_sha256$${PBKDF2_ITERATIONS}$`))).toBe(true);
    expect(djangoVectors.some((v) => v.encoded.startsWith('pbkdf2_sha1$'))).toBe(true);
    expect(djangoVectors.filter((v) => v.django_check_password !== true).length).toBeGreaterThanOrEqual(5);
  });

});

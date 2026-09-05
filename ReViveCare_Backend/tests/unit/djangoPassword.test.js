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

  it('returns false for null, undefined and non-string inputs', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', undefined)).toBe(false);
    expect(await verifyPassword(undefined, djangoVectors[0].encoded)).toBe(false);
  });
});

describe('makePassword (hashes Django can check)', () => {
  it('still produces exactly the fixture hashes that Django verified', async () => {
    expect(nodeHashes.every((h) => h.django_check_password === true)).toBe(true);
    const regenerated = await Promise.all(
      nodeHashes.map((h) => makePassword(h.password, { salt: h.salt, iterations: h.iterations })),
    );
    expect(regenerated).toEqual(nodeHashes.map((h) => h.encoded));
  });

  it('uses Django defaults: pbkdf2_sha256, 1,200,000 iterations, 22-char alphanumeric salt', async () => {
    const encoded = await makePassword('secret');
    const [algorithm, iterations, salt, hash] = encoded.split('$');
    expect(algorithm).toBe('pbkdf2_sha256');
    expect(Number(iterations)).toBe(1_200_000);
    expect(salt).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(Buffer.from(hash, 'base64')).toHaveLength(32);
    expect(await verifyPassword('secret', encoded)).toBe(true);
    expect(await verifyPassword('Secret', encoded)).toBe(false);
  });

  it('makes a different salt each time', () => {
    expect(makeSalt()).not.toBe(makeSalt());
  });

  it('rejects a salt containing "$"', async () => {
    await expect(makePassword('x', { salt: 'a$b' })).rejects.toThrow();
  });
});

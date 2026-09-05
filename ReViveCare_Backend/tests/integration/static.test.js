// E22 /static/Patients/videos/*.mp4: served like Django's production WhiteNoise.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { makeApp } from '../helpers/app.js';

const VIDEOS = path.join(import.meta.dirname, '..', '..', 'static', 'Patients', 'videos');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

let app;
beforeAll(() => {
  ({ app } = makeApp());
});

// Collects the binary body (supertest only buffers text types by default).
const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('GET /static/Patients/videos/<file> (E22)', () => {
  // The four files React links to (ExerciseWorkout.jsx:16-21).
  it.each(['bc.mp4', 'sl.mp4', 'jj.mp4', 'ar.mp4'])('serves %s byte for byte as video/mp4', async (name) => {
    const file = path.join(VIDEOS, name);
    const res = await request(app).get(`/static/Patients/videos/${name}`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(Number(res.headers['content-length'])).toBe(statSync(file).size);
    expect(sha256(res.body)).toBe(sha256(readFileSync(file)));
    expect(res.headers['last-modified']).toBe(statSync(file).mtime.toUTCString());
  });

  it("sends WhiteNoise's caching and CORS headers, and the security headers", async () => {
    const res = await request(app).head('/static/Patients/videos/bc.mp4');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined(); // React loads it cross-origin
  });

  it('answers HEAD with the headers only', async () => {
    const res = await request(app).head('/static/Patients/videos/ar.mp4');
    expect(res.status).toBe(200);
    expect(Number(res.headers['content-length'])).toBe(statSync(path.join(VIDEOS, 'ar.mp4')).size);
    expect(res.text).toBeUndefined();
  });

  it('supports Range requests (how <video> seeks), like WhiteNoise', async () => {
    const res = await request(app)
      .get('/static/Patients/videos/bc.mp4')
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-99/${statSync(path.join(VIDEOS, 'bc.mp4')).size}`);
    expect(res.body).toEqual(readFileSync(path.join(VIDEOS, 'bc.mp4')).subarray(0, 100));
  });

  it('answers 304 to a matching If-Modified-Since or If-None-Match', async () => {
    const first = await request(app).head('/static/Patients/videos/bc.mp4');
    const byDate = await request(app)
      .get('/static/Patients/videos/bc.mp4')
      .set('If-Modified-Since', first.headers['last-modified']);
    expect(byDate.status).toBe(304);
    const byEtag = await request(app).get('/static/Patients/videos/bc.mp4').set('If-None-Match', first.headers.etag);
    expect(byEtag.status).toBe(304);
  });

  it('decodes percent-encoded paths, like WSGI PATH_INFO', async () => {
    expect((await request(app).head('/static/Patients/videos/b%63.mp4')).status).toBe(200);
  });

  describe('Range and preconditions, as WhiteNoise handles them', () => {
    const size = () => statSync(path.join(VIDEOS, 'bc.mp4')).size;

    it.each(['bytes=99999999-', 'bytes=500-100', 'bytes=-99999999'])(
      'unsatisfiable %s → 416 with only Content-Range, no body (not a 500)',
      async (range) => {
        const res = await request(app).get('/static/Patients/videos/bc.mp4').set('Range', range);
        expect(res.status).toBe(416);
        expect(res.headers['content-range']).toBe(`bytes */${size()}`);
        for (const name of ['content-type', 'etag', 'last-modified', 'cache-control', 'accept-ranges']) {
          expect(res.headers[name]).toBeUndefined();
        }
        expect(res.text).toBe('');
      },
    );

    it('a one-byte range is served (206); WhiteNoise answered 416 there', async () => {
      const res = await request(app).get('/static/Patients/videos/bc.mp4').set('Range', 'bytes=0-0');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 0-0/${size()}`);
    });

    it.each([
      ['If-Match', '"no-such-etag"'],
      ['If-Unmodified-Since', 'Thu, 01 Jan 1970 00:00:00 GMT'],
    ])('ignores %s (WhiteNoise never reads it): 200', async (name, value) => {
      const res = await request(app).head('/static/Patients/videos/bc.mp4').set(name, value);
      expect(res.status).toBe(200);
    });

    it('ignores a stale If-Range and still answers the Range with 206', async () => {
      const res = await request(app)
        .get('/static/Patients/videos/bc.mp4')
        .set('Range', 'bytes=0-9')
        .set('If-Range', '"stale-etag"');
      expect(res.status).toBe(206);
    });
  });

  it.each(['post', 'put', 'patch', 'delete', 'options'])(
    '%s on a static file → 405 Allow: GET, HEAD (WhiteNoise)',
    async (method) => {
      const res = await request(app)[method]('/static/Patients/videos/bc.mp4');
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
      expect(res.headers['content-type']).toBeUndefined();
      expect(res.text).toBe('');
    },
  );

  it.each([
    '/static/Patients/videos/missing.mp4',
    '/static/Patients/videos/',
    '/static/Patients/videos',
    '/static/',
    '/static',
    '/static/patients/videos/bc.mp4', // case-sensitive, even on a case-insensitive disk
    '/static/Patients/videos/BC.MP4',
    '/STATIC/Patients/videos/bc.mp4',
    '/static/Patients/videos/../videos/bc.mp4',
    '/static/Patients/videos/%2e%2e/%2e%2e/%2e%2e/package.json',
    '/static/Patients/videos/%E0%A4%A.mp4', // malformed percent-encoding
  ])("%s → Django's 404 page", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('never reads the session table (served before the session middleware)', async () => {
    // A session cookie for a store that would fail: the static response still works.
    await query('ALTER TABLE sessions RENAME TO sessions_renamed');
    try {
      const res = await request(app).head('/static/Patients/videos/bc.mp4').set('Cookie', 'sessionid=s%3Aabc.def');
      expect(res.status).toBe(200);
    } finally {
      await query('ALTER TABLE sessions_renamed RENAME TO sessions');
    }
  });

  it('is served whatever the Host header, like WhiteNoise (before ALLOWED_HOSTS)', async () => {
    expect((await request(app).head('/static/Patients/videos/bc.mp4').set('Host', 'evil.example')).status).toBe(200);
  });
});

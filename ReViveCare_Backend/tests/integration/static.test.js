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

});

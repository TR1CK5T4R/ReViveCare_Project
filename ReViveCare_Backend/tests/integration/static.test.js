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

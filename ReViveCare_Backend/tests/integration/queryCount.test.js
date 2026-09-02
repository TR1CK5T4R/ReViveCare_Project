// The dev-only per-request query counter (app.js 3b): no endpoint runs a query per row (no N+1).
import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { testConfig } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';

/** The real app with an in-memory pino logger that records every "queries per request" line. */
function appWithCounts() {
  const counts = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      const line = JSON.parse(chunk);
      if (line.msg === 'queries per request') counts.push(line.queries);
      done();
    },
  });
  return { app: createApp({ config: testConfig(), logger: pino({ level: 'debug' }, sink) }), counts };
}

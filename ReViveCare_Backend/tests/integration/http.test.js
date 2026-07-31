// Cross-cutting HTTP behaviour: 404s, APPEND_SLASH, headers, CORS, hosts, health.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePool, initPool } from '../../src/db/pool.js';
import { NOT_FOUND } from '../helpers/djangoPages.js';
import { makeApp } from '../helpers/app.js';

let app;
beforeAll(() => {
  ({ app } = makeApp());
});

describe('404 and APPEND_SLASH (Django DEBUG=False)', () => {
  it("answers an unknown path with Django's exact 404 page", async () => {
    const res = await request(app).get('/no/such/page/');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.text).toBe(NOT_FOUND);
  });

  it.each(['get', 'post', 'put', 'delete'])(
    '301-redirects %s /csrf to /csrf/, keeping the query string',
    async (method) => {
      const res = await request(app)[method]('/csrf?a=1&b=2');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/csrf/?a=1&b=2');
      expect(res.text).toBe('');
    },
  );

});

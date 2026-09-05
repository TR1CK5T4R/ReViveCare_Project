import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { allowedHosts } from '../../src/middleware/allowedHosts.js';
import { requirePatient, sessionPatientId } from '../../src/middleware/auth.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { validate } from '../../src/middleware/validate.js';
import { AppError, forbidden, notFound } from '../../src/utils/httpErrors.js';
import { createLogger } from '../../src/utils/logger.js';

const logger = createLogger({ level: 'silent', pretty: false });

function appWith(...handlers) {
  const app = express();
  app.use(...handlers);
  app.use(errorHandler(logger));
  return app;
}

describe('errorHandler', () => {
  it('sends an AppError JSON body unchanged with Django JsonResponse content type', async () => {
    const res = await request(
      appWith(() => {
        throw new AppError(401, { error: 'Not authenticated' });
      }),
    ).get('/');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.body).toEqual({ error: 'Not authenticated' });
  });

  it('sends an AppError string body as a Django HTML page', async () => {
    const res = await request(
      appWith(() => {
        throw forbidden();
      }),
    ).get('/');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.text).toContain('<h1>403 Forbidden</h1>');
  });

  it('turns unknown errors into the Django production 500 page without a stack trace', async () => {
    const res = await request(
      appWith(() => {
        throw new Error('secret internals at /some/file.js:12');
      }),
    ).get('/');
    expect(res.status).toBe(500);
    expect(res.text).toBe(
      '\n<!doctype html>\n<html lang="en">\n<head>\n  <title>Server Error (500)</title>\n</head>\n<body>\n  <h1>Server Error (500)</h1><p></p>\n</body>\n</html>\n',
    );
    expect(res.text).not.toContain('secret internals');
  });

  it('turns async rejections into the same 500 (Express 5 forwards them)', async () => {
    const res = await request(
      appWith(async () => {
        throw new Error('boom');
      }),
    ).get('/');
    expect(res.status).toBe(500);
  });

  it('answers an over-limit form body with 400, like Django RequestDataTooBig', async () => {
    const app = appWith(express.urlencoded({ extended: false, limit: 10 }), (req, res) => res.end('ok'));
    const res = await request(app)
      .post('/')
      .type('form')
      .send('email=' + 'a'.repeat(50));
    expect(res.status).toBe(400);
    expect(res.text).toContain('<h1>Bad Request (400)</h1>');
  });

  it('passes custom headers from AppError', async () => {
    const res = await request(
      appWith(() => {
        throw new AppError(405, '', { headers: { Allow: 'POST' } });
      }),
    ).get('/');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });

  it('builds notFound() with the Django 404 page by default', () => {
    expect(notFound().body).toContain('The requested resource was not found on this server.');
  });
});

describe('validate', () => {
  const schema = { body: z.object({ email: z.string() }) };

  it('stores parsed values on req.validated', async () => {
    const app = appWith(express.json(), validate(schema), (req, res) => res.json(req.validated));
    const res = await request(app).post('/').send({ email: 'a@b.test', extra: 1 });
    expect(res.body).toEqual({ body: { email: 'a@b.test' } });
  });

  it('falls back to a Django form-errors shaped 400', async () => {
    const app = appWith(express.json(), validate(schema), (req, res) => res.end());
    const res = await request(app).post('/').send({});
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['email']);
  });

  it('lets the route reproduce its own Django failure response', async () => {
    const onInvalid = (error, req, res) => res.status(200).json({ success: false, error: 'Server error' });
    const app = appWith(express.json(), validate(schema, { onInvalid }), (req, res) => res.end());
    const res = await request(app).post('/').send({ email: 5 });
    expect(res.body).toEqual({ success: false, error: 'Server error' });
  });
});

describe('auth guard', () => {
  const guarded = (session) =>
    appWith(
      (req, res, next) => {
        req.session = session;
        next();
      },
      requirePatient((req, res) => res.status(401).json({ error: 'Not authenticated' }), 'sessionid'),
      (req, res) => res.json({ id: sessionPatientId(req) }),
    );

  it('passes when the session has a patient_id', async () => {
    expect((await request(guarded({ patient_id: 7 })).get('/')).body).toEqual({ id: 7 });
  });

  it.each([[undefined], [{}], [{ patient_id: null }], [{ patient_id: 0 }]])(
    'uses the endpoint response when there is no truthy patient_id (%j)',
    async (session) => {
      const res = await request(guarded(session)).get('/');
      expect(res.status).toBe(401);
    },
  );
});

describe('allowedHosts (Django ALLOWED_HOSTS)', () => {
  const app = appWith(allowedHosts(['localhost', '127.0.0.1', '.example.test']), (req, res) => res.end('ok'));

  it.each([
    'localhost',
    'localhost:3000',
    '127.0.0.1:8000',
    'LOCALHOST',
    'example.test',
    'api.example.test',
    'localhost.',
  ])('allows %s', async (host) => {
    expect((await request(app).get('/').set('Host', host)).status).toBe(200);
  });

  it.each(['evil.test', 'localhost.evil.test', 'example.test.evil', 'bad host', 'local_host'])(
    'rejects %s with 400',
    async (host) => {
      const res = await request(app).get('/').set('Host', host);
      expect(res.status).toBe(400);
      expect(res.text).toContain('<h1>Bad Request (400)</h1>');
    },
  );
});

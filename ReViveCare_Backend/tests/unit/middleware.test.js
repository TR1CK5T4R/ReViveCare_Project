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

});

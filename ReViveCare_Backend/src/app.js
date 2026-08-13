// createApp(): builds the Express app (no listen), so tests can drive it with
// supertest and server.js can serve it. Middleware order matters; each step
// says why it sits where it does.

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { pinoHttp } from 'pino-http';
import { getPool, requestQueries } from './db/pool.js';
import { createAuthController } from './controllers/auth.controller.js';
import { createChatController } from './controllers/chat.controller.js';
import { createDoctorController } from './controllers/doctor.controller.js';
import { createExerciseController } from './controllers/exercise.controller.js';
import { createHomeController } from './controllers/home.controller.js';
import { createPatientController } from './controllers/patient.controller.js';
import { health } from './controllers/health.controller.js';
import { allowedHosts } from './middleware/allowedHosts.js';
import { corsLikeDjango } from './middleware/cors.js';
import { createCsrf } from './middleware/csrf.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { chatRateLimit, loginRateLimit } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { createSession } from './middleware/session.js';
import { staticFiles } from './middleware/staticFiles.js';
import { createRouter } from './routes/index.js';

// Django's STATICFILES_DIRS (Patients/static), copied into the Node project.
const STATIC_ROOT = path.join(import.meta.dirname, '..', 'static');

/**
 * @param {{ config: object, logger: import('pino').Logger }} deps
 * @returns {import('express').Express} app; app.locals.sessionStore must be closed on shutdown
 */
export function createApp({ config, logger }) {
  const app = express();
  app.disable('x-powered-by');
  // Django URL matching is exact: '/login' is not '/login/' and '/Login/' is not '/login/'.
  app.set('strict routing', true);
  app.set('case sensitive routing', true);

  // 1. Trust proxy first: req.ip, req.protocol and secure cookies all depend on
  //    it, and later middleware reads them.
  app.set('trust proxy', config.trustProxy);

  // 2. Request id before logging, so every log line of the request carries it.
  app.use(requestId);

}

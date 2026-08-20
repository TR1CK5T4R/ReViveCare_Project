// Phase 4c: the Django-rendered pages dropped answer with Django's
// 404 page on Node. React never calls them.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../helpers/app.js';
import { setCookies } from '../helpers/cookies.js';

let app;
beforeAll(() => {
  ({ app } = makeApp());
});

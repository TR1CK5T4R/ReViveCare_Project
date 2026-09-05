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

describe('dropped Django pages', () => {
  it.each([
    ['E01', '/admin/'],
    ['E01', '/admin/login/'],
    ['E02', '/'],
    ['E04', '/doc_port/'],
    ['E05', '/doc_info_page/'],
    ['E10', '/patient/chatbot/'],
    ['E12', '/exercise'],
    ['E13', '/bc'],
    ['E14', '/jj'],
    ['E15', '/ar'],
    ['E16', '/sr'],
    ['E17', '/srtwo'],
  ])('%s GET %s → 404 page, no cookies', async (_id, path) => {
    const res = await request(app).get(path).set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.text).toContain('<h1>Not Found</h1>');
    expect(setCookies(res)).toEqual({});
  });

  it('/admin (no slash) is 404 too: there is no /admin/ route for APPEND_SLASH to redirect to', async () => {
    expect((await request(app).get('/admin')).status).toBe(404);
  });
});

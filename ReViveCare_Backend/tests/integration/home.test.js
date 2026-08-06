// Django `Home` app: E02 `/` (dropped) and E03 `/csrf/`.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { NOT_FOUND } from '../helpers/djangoPages.js';
import { makeApp } from '../helpers/app.js';
import { setCookies } from '../helpers/cookies.js';

let app;
beforeAll(() => {
  ({ app } = makeApp());
});

/** GET /csrf/ and return the token value the frontend would read from document.cookie. */
async function csrfToken(agent) {
  const res = await agent.get('/csrf/');
  return decodeURIComponent(setCookies(res).csrftoken.value);
}

describe('E02 / (Django landing page, dropped)', () => {
  it.each(['get', 'post', 'put', 'delete', 'patch'])('%s / answers with the Django 404 page', async (method) => {
    const res = await request(app)[method]('/');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.text).toBe(NOT_FOUND);
    expect(setCookies(res).csrftoken).toBeUndefined();
  });

  it('HEAD / and a plain OPTIONS / (not a preflight) are 404 too', async () => {
    expect((await request(app).head('/')).status).toBe(404);
    const options = await request(app).options('/');
    expect(options.status).toBe(404);
    expect(options.headers.allow).toBeUndefined();
  });

  it('stays the redirect target of a failed login and of logout', async () => {
    const login = await request(app).post('/login/').type('form').send({ email: 'nobody@example.test' });
    expect(login.headers.location).toBe('/');
    expect((await request(app).get('/patient/logout/')).headers.location).toBe('/');
  });
});

describe('E03 /csrf/', () => {
  it("returns Django's body and sets a readable csrftoken cookie", async () => {
    const res = await request(app).get('/csrf/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.body).toEqual({ success: 'CSRF cookie set' });
    const cookie = setCookies(res).csrftoken;
    expect(cookie.attributes).toMatchObject({ 'max-age': '31449600', path: '/', samesite: 'Lax' });
    expect(cookie.attributes.httponly).toBeUndefined(); // React reads it from JS
    expect(cookie.attributes.secure).toBeUndefined();
    expect(res.headers.vary).toMatch(/Cookie/);
  });

});

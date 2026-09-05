// Every route, at Django's exact path (ReviveCare/urls.py), including the
// trailing slash. The router is strict and case-sensitive, like Django's URL
// matching. ROUTE_PATHS (derived from the table) drives APPEND_SLASH in
// middleware/notFound.js, so nothing has to be listed twice.

import express from 'express';
import { requirePatient } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { exerciseSessionSchema } from '../validators/exercise.validators.js';
import { NOT_FOUND_PAGE, sendHtml } from '../utils/djangoResponses.js';

// Django reads form posts into request.POST. Parsers are attached per route,
// not globally, so a view that reads the raw body (Phase 4+) still sees it.
// Limit = Django's DATA_UPLOAD_MAX_MEMORY_SIZE (2.5 MB); 1000 fields =
// DATA_UPLOAD_MAX_NUMBER_FIELDS. Both overflows become 400, like Django.
const notFoundPage = (req, res) => sendHtml(res, 404, NOT_FOUND_PAGE);
// Django's @require_POST / @require_http_methods(["POST"]): HttpResponseNotAllowed, empty body.
const postOnly = (req, res) => {
  res.setHeader('Allow', 'POST');
  sendHtml(res, 405, '');
};

const formBody = express.urlencoded({ extended: false, limit: 2_621_440, parameterLimit: 1000 });
// The raw bytes, for views that do json.loads(request.body) whatever the
// Content-Type. inflate:false: Django never decompresses a request body.
const parseRaw = express.raw({ type: () => true, limit: 2_621_440, inflate: false });
// Django reads exactly CONTENT_LENGTH bytes, and none at all without the header
// (django/core/handlers/wsgi.py: content_length = 0), so a chunked body reads as b''.
const rawBody = (req, res, next) => (req.headers['content-length'] === undefined ? next() : parseRaw(req, res, next));
// JSON for the new E23 endpoint (React sends application/json); a body that
// isn't valid JSON gets the endpoint's own 400 answer.
const parseJson = express.json({ limit: '10kb' });
const jsonBody = (onInvalid) => (req, res, next) =>
  parseJson(req, res, (err) => (err ? onInvalid(null, req, res) : next()));

// The same, for a view that reads request.body inside its own try block
// (chatbot_send): a too-large or compressed body becomes the view's error
// ("Server error"), not the parser's 400.
const rawBodyForView = (req, res, next) =>
  rawBody(req, res, (err) => {
    if (err) req.bodyError = err;
    next();
  });

/**
 * @param {object} deps
 * @returns {{ method: string, path: string, handlers: import('express').RequestHandler[], note: string }[]}
 */
function routeTable(deps) {
  const { home, auth, patient, doctor, chat, exercise, health, csrfProtect, loginLimiter, chatLimiter } = deps;
  const loggedIn = (onUnauthenticated) => requirePatient(onUnauthenticated, deps.sessionCookieName);
  return [
    // ── Home app ──
    // E02 urls.py: path('', home) renders index.html → dropped: no route, so 404.
    // E03 urls.py: path('csrf/', get_csrf_token). Any method; unsafe ones need CSRF.
    { method: 'all', path: '/csrf/', handlers: [csrfProtect, home.csrf], note: 'E03' },
    // ── Doctor app ──
    // E04 doc_port/ and E05 doc_info_page/ render dropped HTML pages: no route, so 404.
    // E06 urls.py: path('doctor_info', doctor_info). No trailing slash. @csrf_exempt + @require_POST.
    { method: 'post', path: '/doctor_info', handlers: [rawBody, doctor.doctorInfo], note: 'E06' },
    { method: 'all', path: '/doctor_info', handlers: [postOnly], note: 'E06 non-POST → 405' },
    // ── Patients app (auth) ──
    // E07 urls.py: path('login/', login). @csrf_exempt. GET (HTML form) dropped.
    { method: 'post', path: '/login/', handlers: [loginLimiter, formBody, auth.login], note: 'E07' },
    // Every other method on /login/ rendered the dropped HTML form → 404. Declared
    // explicitly so Express doesn't answer a plain OPTIONS with its automatic "Allow: POST".
    { method: 'all', path: '/login/', handlers: [notFoundPage], note: 'E07 non-POST' },
    // E09 urls.py: path('patient/logout/', patient_logout). Any method; not CSRF-exempt.
    { method: 'all', path: '/patient/logout/', handlers: [csrfProtect, auth.logout], note: 'E09' },
    // ── Patients app (portal) ──
    // E08 urls.py: path('patient/dashboard/', patient_dashboard). @csrf_exempt, any method,
    // body never read (so no parser). JSON mode for React; HTML mode keeps only its redirects.
    {
      method: 'all',
      path: '/patient/dashboard/',
      handlers: [loggedIn(patient.dashboardNotAuthenticated), patient.dashboard],
      note: 'E08',
    },
    // E10 urls.py: path('patient/chatbot/', chatbot) renders a dropped HTML page: 404.
    // E11 urls.py: path('patient/chatbot/send/', chatbot_send). @csrf_exempt + @require_http_methods(["POST"]).
    {
      method: 'post',
      path: '/patient/chatbot/send/',
      handlers: [loggedIn(chat.notAuthenticated), chatLimiter, rawBodyForView, chat.send],
      note: 'E11',
    },
    { method: 'all', path: '/patient/chatbot/send/', handlers: [postOnly], note: 'E11 non-POST → 405' },
    // ── Exercise ──
    // E12-E17 (HTML pages) are dropped. E18 video_feed and E19-E21 start/status/reset
    // are replaced by browser tracking: no routes, so 404. E23 stores one set.
    {
      method: 'post',
      path: '/exercise/sessions/',
      handlers: [
        csrfProtect,
        loggedIn(exercise.notAuthenticated),
        jsonBody(exercise.invalid),
        validate({ body: exerciseSessionSchema() }, { onInvalid: exercise.invalid }),
        exercise.saveSession,
      ],
      note: 'E23 (new)',
    },
    { method: 'all', path: '/exercise/sessions/', handlers: [postOnly], note: 'E23 non-POST → 405' },
    // Approved addition.
    { method: 'get', path: '/api/health', handlers: [health], note: 'health' },
  ];
}

/**
 * @param {object} deps controllers and per-route middleware
 * @returns {{ router: import('express').Router, routePaths: string[] }}
 */
export function createRouter(deps) {
  const router = express.Router({ strict: true, caseSensitive: true });
  const table = routeTable(deps);
  for (const { method, path, handlers } of table) router[method](path, ...handlers);
  return { router, routePaths: table.map((r) => r.path) };
}

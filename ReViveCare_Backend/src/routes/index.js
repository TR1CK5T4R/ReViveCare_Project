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

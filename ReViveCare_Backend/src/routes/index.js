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

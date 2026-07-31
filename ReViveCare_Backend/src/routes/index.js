// Every route, at Django's exact path (ReviveCare/urls.py), including the
// trailing slash. The router is strict and case-sensitive, like Django's URL
// matching. ROUTE_PATHS (derived from the table) drives APPEND_SLASH in
// middleware/notFound.js, so nothing has to be listed twice.

import express from 'express';
import { requirePatient } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { exerciseSessionSchema } from '../validators/exercise.validators.js';
import { NOT_FOUND_PAGE, sendHtml } from '../utils/djangoResponses.js';

// GET /api/health (approved addition; Django has no health endpoint).
// For uptime checks: 200 when the database answers, 503 when it doesn't.

import { query } from '../db/pool.js';
import { sendJson } from '../utils/djangoResponses.js';

/** @type {import('express').RequestHandler} */
export async function health(req, res) {
  try {
    await query('SELECT 1');
    sendJson(res, 200, { status: 'ok', db: 'ok' });
  } catch (err) {
    req.log.error({ err }, 'health check: database unreachable');
    sendJson(res, 503, { status: 'error', db: 'error' });
  }
}

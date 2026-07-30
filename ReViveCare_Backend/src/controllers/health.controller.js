// GET /api/health (approved addition; Django has no health endpoint).
// For uptime checks: 200 when the database answers, 503 when it doesn't.

import { query } from '../db/pool.js';
import { sendJson } from '../utils/djangoResponses.js';

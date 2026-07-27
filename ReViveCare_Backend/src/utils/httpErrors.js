// AppError: an error that already knows the exact HTTP response Django would
// send. Services and middleware throw it; Express 5 forwards it to
// middleware/errorHandler.js, which writes `status` and `body` unchanged.

import { FORBIDDEN_PAGE, NOT_FOUND_PAGE } from './djangoResponses.js';

export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string | object} body a string is sent as text/html (Django error
   *   pages), anything else as application/json (JsonResponse)
   * @param {{ headers?: Record<string, string> }} [options]
   */
  constructor(status, body, { headers = {} } = {}) {
    super(typeof body === 'string' ? `HTTP ${status}` : `HTTP ${status}: ${JSON.stringify(body)}`);
    this.name = 'AppError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

/** 403. Default body: Django's "403 Forbidden" page. */
export const forbidden = (body = FORBIDDEN_PAGE) => new AppError(403, body);

/** 404. Default body: Django's "Not Found" page. */
export const notFound = (body = NOT_FOUND_PAGE) => new AppError(404, body);

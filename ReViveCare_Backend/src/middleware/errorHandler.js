// The last middleware: turns any error into the response Django would send.
// - AppError → its exact status/body (JSON or Django HTML page);
// - request body too large / too many form fields → 400, like Django's
//   RequestDataTooBig / TooManyFieldsSent;
// - anything else → Django's production 500 page. The stack trace goes to the
//   log, never to the client.

import { AppError } from '../utils/httpErrors.js';
import { BAD_REQUEST_PAGE, SERVER_ERROR_PAGE, sendHtml, sendJson } from '../utils/djangoResponses.js';

/**
 * @param {import('pino').Logger} logger fallback when the request has no req.log
 * @returns {import('express').ErrorRequestHandler}
 */
export function errorHandler(logger) {
  // Express recognises error middleware by its four parameters, so `next` stays.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const log = req.log ?? logger;
    if (res.headersSent) {
      // Too late to send an error page; end the response so the client isn't left hanging.
      log.error({ err }, 'error after response started');
      return res.end();
    }

    if (err instanceof AppError) {
      for (const [name, value] of Object.entries(err.headers)) res.setHeader(name, value);
      return typeof err.body === 'string' ? sendHtml(res, err.status, err.body) : sendJson(res, err.status, err.body);
    }

    // Errors from express.urlencoded / express.text carry a `type` and a 4xx status.
    if (typeof err.type === 'string' && err.status >= 400 && err.status < 500) {
      log.warn({ type: err.type }, 'rejected request body');
      return sendHtml(res, 400, BAD_REQUEST_PAGE);
    }

    log.error({ err }, 'unhandled error');
    sendHtml(res, 500, SERVER_ERROR_PAGE);
  };
}

// CORS exactly as django-cors-headers 4.6 does it (corsheaders/middleware.py):
// - every preflight (OPTIONS with Access-Control-Request-Method) is answered
//   here with an empty 200, whatever the origin;
// - CORS headers are added only when the Origin is in CORS_ALLOWED_ORIGINS;
//   other origins get none at all (the browser then blocks the response).
// The `cors` package writes the headers; this wrapper decides when.

import cors from 'cors';

/**
 * @param {string[]} allowedOrigins config.cors.allowedOrigins
 * @returns {import('express').RequestHandler}
 */
export function corsLikeDjango(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  const addHeaders = cors({
    origin: true, // reflect the request Origin; only called for allowed origins
    credentials: true, // CORS_ALLOW_CREDENTIALS = True: the session cookie must flow
    // corsheaders defaults (corsheaders/defaults.py)
    methods: ['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    allowedHeaders: ['accept', 'authorization', 'content-type', 'user-agent', 'x-csrftoken', 'x-requested-with'],
    maxAge: 86400,
    preflightContinue: true, // we answer preflights ourselves, below
  });

  return (req, res, next) => {
    const isPreflight = req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined;
    const finish = (err) => {
      if (err) return next(err);
      if (!isPreflight) return next();
      // Django parity: check_preflight → HttpResponse(headers={"content-length": "0"})
      res.status(200);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', '0');
      res.end();
    };
    res.vary('Origin');
    const origin = req.headers.origin;
    if (origin === undefined || !allowed.has(origin)) return finish();
    addHeaders(req, res, finish);
  };
}

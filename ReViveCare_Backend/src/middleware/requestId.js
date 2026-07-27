// Gives every request an id (req.id, X-Request-Id response header) so all log
// lines of one request can be found together. Reuses a well-formed incoming
// X-Request-Id (set by a proxy) instead of minting a new one.

import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** @type {import('express').RequestHandler} */
export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

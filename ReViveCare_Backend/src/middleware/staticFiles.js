// E22 /static/*: the exercise demo videos React plays (ExerciseWorkout.jsx:40).
// Mirrors how production Django served them: WhiteNoise (settings.py MIDDLEWARE,
// right after SecurityMiddleware, before CORS, sessions and host checks).
// express.static does the file serving (ETag, Last-Modified, 304, Range); this
// wrapper adds WhiteNoise's rules around it.

import express from 'express';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Every servable file path below `root` ('/Patients/videos/bc.mp4'), scanned
 * once at startup like WhiteNoise without autorefresh (its production
 * default). Dot-files are skipped, as Django's collectstatic ignores them.
 *
 * @param {string} root folder on disk
 * @returns {Set<string>}
 */
function listFiles(root) {
  const paths = new Set();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep);
    if (relative.some((part) => part.startsWith('.'))) continue;
    paths.add(`/${relative.join('/')}`);
  }
  return paths;
}

/**
 * Mount at '/static' (app.js), so req.path is relative to it.
 *
 * @param {{ root: string }} options
 * @returns {import('express').RequestHandler}
 */
export function staticFiles({ root }) {
  const files = listFiles(root);
  const serve = express.static(root, {
    index: false, // no directory indexes (Django: "Directory indexes are not allowed here.")
    redirect: false, // no /dir → /dir/ redirect; a directory isn't a file → 404
    dotfiles: 'ignore',
    fallthrough: true,
    maxAge: 60_000, // WhiteNoise's production Cache-Control: max-age=60, public
    setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'), // WHITENOISE_ALLOW_ALL_ORIGINS default
  });

  return (req, res, next) => {
    // WhiteNoise looks the decoded path up in its file table: exact and
    // case-sensitive. Anything else falls through to Django's 404.
    let filePath;
    try {
      filePath = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (!files.has(filePath)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Django parity: whitenoise/responders.py NOT_ALLOWED_RESPONSE (no body, no Content-Type).
      res.status(405).setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    // WhiteNoise never reads these. `send` would answer 412 or ignore the
    // Range for them (whitenoise/responders.py get_response, is_not_modified).
    delete req.headers['if-match'];
    delete req.headers['if-unmodified-since'];
    delete req.headers['if-range'];
    serve(req, res, (err) => {
      // An unsatisfiable Range comes back from `send` as an error. Answer it
      // like WhiteNoise: 416, only Content-Range (send already set it), no body.
      // Django parity: whitenoise/responders.py get_range_not_satisfiable_response
      if (err?.status === 416 && !res.headersSent) {
        for (const name of res.getHeaderNames()) {
          if (FILE_HEADERS.has(name)) res.removeHeader(name);
        }
        res.status(416);
        return res.end();
      }
      next(err);
    });
  };
}

// Headers `send` sets for the file before it checks the Range.
const FILE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'last-modified',
  'etag',
  'content-type',
  'content-length',
  'access-control-allow-origin',
]);

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

}

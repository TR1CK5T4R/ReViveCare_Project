// Responses shaped exactly like the ones Django sends: JSON from JsonResponse,
// redirects from django.shortcuts.redirect, and the DEBUG=False error pages
//. Controllers and the error handler use these instead of res.json /
// res.redirect, which add a charset or a "Found. Redirecting…" body that
// Django doesn't send.

import { pyJsonDumps } from './pythonJson.js';

// Django parity: django/views/defaults.py ERROR_PAGE_TEMPLATE (Django 6.0.2),
// including its leading newline. Also used for the pages Node adds (429).
export function errorPage(title, details) {
  return `
<!doctype html>
<html lang="en">
<head>
  <title>${title}</title>
</head>
<body>
  <h1>${title}</h1><p>${details}</p>
</body>
</html>
`;
}

export const NOT_FOUND_PAGE = errorPage('Not Found', 'The requested resource was not found on this server.');
export const BAD_REQUEST_PAGE = errorPage('Bad Request (400)', '');
export const FORBIDDEN_PAGE = errorPage('403 Forbidden', '');
export const SERVER_ERROR_PAGE = errorPage('Server Error (500)', '');

// Django parity: django/views/csrf.py csrf_failure with DEBUG=False, rendering
// the built-in csrf_403.html fallback. The two extra paragraphs only appear
// when the reason is a missing CSRF cookie.
export function csrfFailurePage({ noCookie }) {
  const cookieHelp = noCookie
    ? `
  <p>You are seeing this message because this site requires a CSRF cookie when submitting forms. This cookie is required for security reasons, to ensure that your browser is not being hijacked by third parties.</p>
  <p>If you have configured your browser to disable cookies, please re-enable them, at least for this site, or for “same-origin” requests.</p>
`
    : '\n';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="content-type" content="text/html; charset=utf-8">
  <meta name="robots" content="NONE,NOARCHIVE">
  <title>403 Forbidden</title>
  <style>
    html * { padding:0; margin:0; }
    body * { padding:10px 20px; }
    body * * { padding:0; }
    body { font-family: sans-serif; background:#eee; color:#000; }
    body>div { border-bottom:1px solid #ddd; }
    h1 { font-weight:normal; margin-bottom:.4em; }
    h1 span { font-size:60%; color:#666; font-weight:normal; }
    #info { background:#f6f6f6; }
    #info ul { margin: 0.5em 4em; }
    #info p, #summary p { padding-top:10px; }
    #summary { background: #ffc; }
    #explanation { background:#eee; border-bottom: 0px none; }
  </style>
</head>
<body>
<div id="summary">
  <h1>Forbidden <span>(403)</span></h1>
  <p>CSRF verification failed. Request aborted.</p>
${cookieHelp}</div>

<div id="explanation">
  <p><small>More information is available with DEBUG=True.</small></p>
</div>

</body>
</html>
`;
}

/**
 * Send an HTML body with Django's HttpResponse content type.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} html
 */
export function sendHtml(res, status, html) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

/**
 * Like Django's JsonResponse: Content-Type exactly "application/json".
 * (Python writes `{"a": 1.0}` with spaces and ASCII escapes; JS writes
 * `{"a":1}`. The parsed values are identical.)
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Like JsonResponse, byte for byte: Python's json.dumps output (spaces after
 * ':' and ',', \uXXXX escapes, 1.0 written as 1.0). For responses that can
 * carry model output (E11), where JS formatting would differ.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendPythonJson(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  res.end(pyJsonDumps(body));
}

/**
 * Like django.shortcuts.redirect(): empty body, relative Location.
 *
 * @param {import('express').Response} res
 * @param {string} location
 * @param {301 | 302} [status] 302 = HttpResponseRedirect, 301 = permanent (APPEND_SLASH)
 */
export function sendRedirect(res, location, status = 302) {
  res.status(status);
  res.setHeader('Location', location);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end();
}

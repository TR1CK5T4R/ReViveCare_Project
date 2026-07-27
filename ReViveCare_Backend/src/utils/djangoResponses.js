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

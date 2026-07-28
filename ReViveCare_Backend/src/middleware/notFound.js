// What Django does when no URL pattern matches (DEBUG=False):
// - APPEND_SLASH: if the path lacks a trailing slash and the slashed path is
//   a real route, 301 to it (any method, query string kept);
// - otherwise the plain "Not Found" page.

import { NOT_FOUND_PAGE, sendHtml, sendRedirect } from '../utils/djangoResponses.js';

/**
 * @param {string[]} routePaths every path registered in routes/index.js
 * @returns {import('express').RequestHandler}
 */
export function notFound(routePaths) {
  const known = new Set(routePaths);
  return (req, res) => {
    // Django parity: CommonMiddleware.should_redirect_with_slash / get_full_path_with_slash.
    const [path, query] = req.originalUrl.split(/\?(.*)/s);
    if (!path.endsWith('/') && known.has(`${path}/`)) {
      return sendRedirect(res, `${path}/${query !== undefined ? `?${query}` : ''}`, 301);
    }
    sendHtml(res, 404, NOT_FOUND_PAGE);
  };
}

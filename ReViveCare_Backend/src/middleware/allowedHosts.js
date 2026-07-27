// Host header validation, as Django does for every request (CommonMiddleware
// calls request.get_host(), which raises DisallowedHost → 400). Protects
// against Host-header attacks; ALLOWED_HOSTS uses Django's syntax.

import { BAD_REQUEST_PAGE, sendHtml } from '../utils/djangoResponses.js';

// Django parity: django/http/request.py host_validation_re + split_domain_port.
const HOST_PATTERN = /^([a-z0-9.-]+|\[[a-f0-9]*:[a-f0-9.:]+\])(?::([0-9]+))?$/;

function domainOf(host) {
  const match = HOST_PATTERN.exec(host.toLowerCase());
  return match ? match[1].replace(/\.$/, '') : '';
}

// Django parity: django/utils/http.py is_same_domain + request.validate_host.
// '*' matches anything; '.example.com' matches example.com and its subdomains.
function hostAllowed(domain, allowedHosts) {
  return allowedHosts.some((pattern) => {
    if (pattern === '*') return true;
    if (!pattern) return false;
    const p = pattern.toLowerCase();
    return (p.startsWith('.') && (domain.endsWith(p) || domain === p.slice(1))) || p === domain;
  });
}

/**
 * @param {string[]} allowedHosts config.allowedHosts
 * @returns {import('express').RequestHandler}
 */
export function allowedHosts(allowedHosts) {
  return (req, res, next) => {
    // The raw Host header, as Django reads HTTP_HOST (USE_X_FORWARDED_HOST is off).
    const domain = domainOf(req.headers.host ?? '');
    if (domain && hostAllowed(domain, allowedHosts)) return next();
    req.log?.warn('rejected request with a disallowed Host header');
    sendHtml(res, 400, BAD_REQUEST_PAGE);
  };
}

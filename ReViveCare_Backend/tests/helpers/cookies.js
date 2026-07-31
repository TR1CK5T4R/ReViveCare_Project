// Parse Set-Cookie headers from a supertest response.

/**
 * @param {import('supertest').Response} res
 * @returns {Record<string, { value: string, attributes: Record<string, string | true> }>}
 */
export function setCookies(res) {
  const cookies = {};
  for (const header of res.headers['set-cookie'] ?? []) {
    const [pair, ...attributeParts] = header.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    const attributes = {};
    for (const part of attributeParts) {
      const [key, ...rest] = part.split('=');
      attributes[key.toLowerCase()] = rest.length > 0 ? rest.join('=') : true;
    }
    cookies[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attributes };
  }
  return cookies;
}

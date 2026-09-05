// Django's exact DEBUG=False 404 page, written out by hand (not imported from src/),
// so the tests check Node's page against Django's real text.

export const NOT_FOUND =
  '\n<!doctype html>\n<html lang="en">\n<head>\n  <title>Not Found</title>\n</head>\n<body>\n  <h1>Not Found</h1><p>The requested resource was not found on this server.</p>\n</body>\n</html>\n';

// HTTP side of the Django `Home` app. E03 GET /csrf/ is the only Home view
// Node serves; E02 `/` (the HTML landing page) is dropped and falls
// through to the Django-style 404.

import { sendJson } from '../utils/djangoResponses.js';

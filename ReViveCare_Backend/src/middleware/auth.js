// Auth guards. Django has no auth decorators or roles in this project: each
// view checks `request.session.get('patient_id')` itself and answers in its
// own way (E08: 401 JSON; E11: 200 {"success": false, ...}). So the guard
// takes the endpoint's own "not logged in" response. There is no requireRole:
// Django has no doctor login and no role checks.

import { clearDeadSessionCookie } from './session.js';

-- 0006_sessions: the express-session store used by connect-pg-simple.
-- Created here (the app runs with createTableIfMissing: false) so the schema
-- is fully owned by migrations and the app role never needs CREATE rights.

CREATE TABLE sessions (
  sid     VARCHAR     PRIMARY KEY,
  sess    JSON        NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE sessions IS
  'Server-side login sessions (replaces django_session). The cookie (sessionid) holds only the signed sid.';
COMMENT ON COLUMN sessions.sess IS
  'Session data: patient_id, patient_email, patient_name, chat_history (max 20 items), plus the cookie settings. JSON, not JSONB: the store reads and writes it whole and never queries inside it.';
COMMENT ON COLUMN sessions.expire IS
  'TIMESTAMPTZ instead of the library''s default TIMESTAMP: the store compares it with to_timestamp(), which is timestamptz, so this keeps the comparison independent of the session time zone.';

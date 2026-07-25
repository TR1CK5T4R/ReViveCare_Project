-- 0007_indexes: secondary indexes, kept in their own migration so the
-- benchmark can run with and without them (scripts/bench-queries.js).
--
-- Every live query is already served by an index that a constraint created:
--   users_email_role_key (email, role)  login and doctor_info lookups
--   patients_pkey (id)                  dashboard and chat patient fetch
--   patients_user_id_key (user_id)      patients -> users join
--   users_pkey (id)                     patients -> users join
--   sessions_pkey (sid)                 session load / save on every request
--
-- Deliberately not added, because no endpoint queries them yet:
-- exercise_sessions(patient_id, start_time DESC), chat_messages(patient_id, sent_at),
-- patient_reports(patient_id, created_at DESC), patients(assigned_doctor_id).
-- Each one gets added in a new migration together with the query that needs it.

-- connect-pg-simple prunes expired sessions every 15 minutes:
--   DELETE FROM sessions WHERE expire < to_timestamp($1)
-- Only the few rows that expired since the last prune match, so an index
-- range scan avoids reading the whole table.
CREATE INDEX idx_sessions_expire ON sessions (expire);

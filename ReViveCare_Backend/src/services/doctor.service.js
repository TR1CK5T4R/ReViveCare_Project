// Doctor-side rules: the "add or update a patient" upsert behind
// POST /doctor_info. Plain functions: no req/res, no SQL.

import { withSavepoint, withTransaction } from '../db/tx.js';
import {
  findPatientForUpdateByEmail,
  insertPatient,
  updatePatientNameAndInfo,
} from '../repositories/patient.repository.js';
import { PythonError, pyStr } from '../utils/pythonJson.js';

const FIELDS = ['email', 'name', 'info'];

/**
 * The three values Django stores, from the parsed request body.
 * `data['email']`, `data['name']`, `data['info']` are read in that order (the
 * view's dict literal); the model fields then turn non-strings into Python
 * str() (CharField/TextField.to_python). No trimming, lower-casing or length
 * check.
 *
 * Django parity: Doctor/views.py:doctor_info (R-DOC-01)
 *
 * @param {unknown} data result of pyJsonLoads(request body)
 * @returns {{ email: string, name: string, info: string }}
 * @throws {PythonError} TypeError (body isn't a JSON object), KeyError (missing
 *   key), IntegrityError (a null value hits a NOT NULL column). All are 500s.
 */
export function readDoctorInfoFields(data) {
  if (!(data instanceof Map)) throw new PythonError('TypeError', 'request body is not a JSON object');
  const values = FIELDS.map((field) => {
    if (!data.has(field)) throw new PythonError('KeyError', field);
    return data.get(field);
  });
  // Django looks up / saves the row and the NOT NULL constraint fails, inside
  // the transaction, so nothing is written either way.
  if (values.includes(null)) throw new PythonError('IntegrityError', 'NOT NULL constraint failed');
  const [email, name, info] = values.map(pyStr);
  return { email, name, info };
}

/**
 * Postgres can't store a lone UTF-16 surrogate. psycopg (Django's Postgres
 * driver) raises UnicodeEncodeError for one; node-postgres would silently
 * store U+FFFD instead, so reject it explicitly. (U+0000 and over-long values
 * already fail in Postgres itself, as they did for Django:.)
 *
 * @param {{ email: string, name: string, info: string }} fields
 */
function assertStorable(fields) {
  for (const value of Object.values(fields)) {
    if (!value.isWellFormed()) throw new PythonError('UnicodeEncodeError', 'surrogates not allowed');
  }
}

const UNIQUE_VIOLATION = '23505';

/**
 * Django's `Patient.objects.update_or_create(email=..., defaults={name, info})`:
 * in one transaction, lock the row with that exact email; update name and
 * info if it exists, otherwise insert it. If a concurrent request inserted
 * the same email between our SELECT and INSERT, Django's get_or_create
 * catches the IntegrityError, re-reads the row and updates it; so does this
 * (the INSERT runs in a savepoint so the transaction survives the error).
 *
 * Django parity: Doctor/views.py:doctor_info, django/db/models/query.py:update_or_create
 *
 * @param {{ email: string, name: string, info: string }} fields from readDoctorInfoFields
 * @returns {Promise<{ created: boolean, patientId: number }>}
 */
export async function upsertPatient(fields) {
  assertStorable(fields);
  return withTransaction(async (client) => {
    let existing = await findPatientForUpdateByEmail(fields.email, client);
    if (!existing) {
      try {
        const patientId = await withSavepoint(client, () => insertPatient(fields, client));
        return { created: true, patientId };
      } catch (err) {
        if (err.code !== UNIQUE_VIOLATION) throw err;
        existing = await findPatientForUpdateByEmail(fields.email, client);
        if (!existing) throw err;
      }
    }
    await updatePatientNameAndInfo({ ...existing, name: fields.name, info: fields.info }, client);
    return { created: false, patientId: existing.patientId };
  });
}

// Request validation with zod. Parsed values go to req.validated.{body,query,params}
// because Express 5 makes req.query a read-only getter.
//
// This project's Django views use no forms or serializers: each view handles
// bad input in its own way (often a 500, sometimes a JSON error with HTTP 200).
// So every route passes `onInvalid` to reproduce its Django outcome exactly,
// and schemas must accept exactly what the Django view accepts. The default
// (400 with Django form-errors shape {"field": ["message"]}) is only a fallback.

import { AppError } from '../utils/httpErrors.js';

function formErrors(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '__all__';
    (fields[key] ??= []).push(issue.message);
  }
  return new AppError(400, fields);
}

/**
 * @param {{ body?: import('zod').ZodType, query?: import('zod').ZodType, params?: import('zod').ZodType }} schemas
 * @param {{ onInvalid?: (error: import('zod').ZodError, req, res, next) => void }} [options]
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas, { onInvalid } = {}) {
  return (req, res, next) => {
    const validated = {};
    for (const part of ['body', 'query', 'params']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part]);
      if (!result.success) {
        return onInvalid ? onInvalid(result.error, req, res, next) : next(formErrors(result.error));
      }
      validated[part] = result.data;
    }
    req.validated = validated;
    next();
  };
}

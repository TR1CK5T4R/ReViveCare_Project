// Environment configuration: the only place in src/ that reads process.env.
// loadConfig() validates every variable with zod and returns a deep-frozen
// config object; server.js calls it once at startup, tests call it with their
// own values. Names shared with Django keep Django's spelling.

import { z } from 'zod';
import { deepFreeze } from '../utils/deepFreeze.js';

// Django splits these lists with str.split(',') and no trimming
// (settings.py:31,52-60), so " http://x" with a space would not match. Same here.
const commaList = (fallback) =>
  z
    .string()
    .default(fallback)
    .transform((value) => value.split(','));

const integerString = (fallback, { min = 0 } = {}) => z.coerce.number().int().min(min).default(fallback);

// An origin is scheme://host[:port] with nothing after it. django-cors-headers
// refuses to start with a malformed entry (system check corsheaders.E013).
const ORIGIN = /^https?:\/\/[^/?#\s]+$/;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: integerString(3000, { min: 0 }),
  // Express "trust proxy": false, true, a hop count, or a comma list of
  // addresses/subnets. Needed behind a hosting proxy for req.ip and secure cookies.
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      if (/^\d+$/.test(value)) return Number(value);
      return value;
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Human-readable logs (pino-pretty, a dev dependency). Defaults to on in development only.
  LOG_PRETTY: z.enum(['true', 'false']).optional(),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DB_POOL_MAX: integerString(10, { min: 1 }),
  DB_IDLE_TIMEOUT_MS: integerString(30_000),
  DB_CONNECTION_TIMEOUT_MS: integerString(5_000),
  DB_STATEMENT_TIMEOUT_MS: integerString(15_000),

});

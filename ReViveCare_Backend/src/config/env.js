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

  // Signs the session cookie (express-session). Django's equivalent is SECRET_KEY.
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Django: SESSION_COOKIE_SECURE = not DEBUG. Defaults to true only in production.
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  // Signs CSRF tokens (csrf-csrf). Separate from SESSION_SECRET so either can rotate alone.
  CSRF_SECRET: z.string().min(32, 'must be at least 32 characters'),

  // Django defaults (settings.py:31,52-60).
  ALLOWED_HOSTS: commaList('localhost,127.0.0.1'),
  CORS_ALLOWED_ORIGINS: commaList('http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173'),
  CSRF_TRUSTED_ORIGINS: commaList('http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173'),

  // Approved addition: failed POST /login/ attempts per IP per window.
  LOGIN_RATE_LIMIT_MAX: integerString(10, { min: 1 }),
  LOGIN_RATE_LIMIT_WINDOW_MS: integerString(15 * 60 * 1000, { min: 1000 }),
  // Approved addition: chat messages per patient per window (each one is a paid LLM call).
  CHAT_RATE_LIMIT_MAX: integerString(20, { min: 1 }),
  CHAT_RATE_LIMIT_WINDOW_MS: integerString(60 * 1000, { min: 1000 }),

  // Chat (E11). GROQ_BASE_URL points the SDK at a local mock server in parity
  // runs (Django side: GROQ_API_BASE, read by langchain_groq). Unset = Groq's API.
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Alert settings: validated loosely here; see alertSettings() for Django's
  // empty-vs-missing rules.
  SMTP_SERVER: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  EMAIL_SENDER: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  DOCTOR_EMAIL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TO_NUMBER: z.string().optional(),
});

/** Thrown by loadConfig; `issues` lists one "NAME: problem" line per bad variable. */
export class ConfigError extends Error {
  constructor(issues) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * The alert settings exactly as Django sees them. Patients/views.py:43-44 runs
 * os.environ.setdefault for SMTP_SERVER ("smtp.gmail.com") and SMTP_PORT
 * ("587"), so only a *missing* variable gets the default; an empty one stays
 * empty (an empty SMTP_PORT makes int('') fail, which skips the whole alert).
 * Django's sender/password/doctor defaults are deliberately not copied:
 * missing means "email not configured". Raw strings, no trimming, like os.getenv.
 *
 * @param {Record<string, string | undefined>} source
 */
export function alertSettings(source) {
  const raw = (name, fallback) => (source[name] === undefined ? fallback : source[name]);
  return {
    smtpServer: raw('SMTP_SERVER', 'smtp.gmail.com'),
    smtpPort: raw('SMTP_PORT', '587'),
    emailSender: raw('EMAIL_SENDER'),
    emailPassword: raw('EMAIL_PASSWORD'),
    doctorEmail: raw('DOCTOR_EMAIL'),
    twilioAccountSid: raw('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: raw('TWILIO_AUTH_TOKEN'),
    twilioPhoneNumber: raw('TWILIO_PHONE_NUMBER'),
    toNumber: raw('TO_NUMBER'),
  };
}

/**
 * Validate environment variables and build the app config.
 *
 * @param {Record<string, string | undefined>} source usually process.env
 * @returns {Readonly<object>} deep-frozen config
 * @throws {ConfigError} listing every missing or invalid variable by name
 */
export function loadConfig(source) {
  // Treat empty strings as "not set", so `FOO=` in .env falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = schema.safeParse(cleaned);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((i) => {
        const name = i.path.join('.');
        return `${name}: ${cleaned[name] === undefined ? 'is required but not set' : i.message}`;
      });

  if (parsed.success) {
    const e = parsed.data;
    for (const [name, list] of [
      ['CORS_ALLOWED_ORIGINS', e.CORS_ALLOWED_ORIGINS],
      ['CSRF_TRUSTED_ORIGINS', e.CSRF_TRUSTED_ORIGINS],
    ]) {
      for (const origin of list) {
        if (!ORIGIN.test(origin)) issues.push(`${name}: "${origin}" is not an origin like http://host:port`);
      }
    }
  }
  if (issues.length > 0) throw new ConfigError(issues);

  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  return deepFreeze({
    env: e.NODE_ENV,
    isProduction,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    trustProxy: e.TRUST_PROXY,
    log: {
      level: e.LOG_LEVEL,
      pretty: e.LOG_PRETTY === undefined ? e.NODE_ENV === 'development' : e.LOG_PRETTY === 'true',
    },
    db: {
      connectionString: e.DATABASE_URL,
      max: e.DB_POOL_MAX,
      idleTimeoutMillis: e.DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: e.DB_CONNECTION_TIMEOUT_MS,
      statementTimeoutMillis: e.DB_STATEMENT_TIMEOUT_MS,
    },
    session: {
      secret: e.SESSION_SECRET,
      cookieName: 'sessionid', // Django SESSION_COOKIE_NAME default
      maxAgeSeconds: 86400, // Django SESSION_COOKIE_AGE (settings.py:172)
      cookieSecure: e.SESSION_COOKIE_SECURE === undefined ? isProduction : e.SESSION_COOKIE_SECURE === 'true',
      // connect-pg-simple prunes expired rows on a timer; off in tests so the
      // timer doesn't keep the test process alive.
      pruneIntervalSeconds: e.NODE_ENV === 'test' ? false : 15 * 60,
    },
    csrf: {
      secret: e.CSRF_SECRET,
      cookieName: 'csrftoken', // Django CSRF_COOKIE_NAME default; React reads it (djangoApi.js:9-23)
      headerName: 'x-csrftoken', // Django CSRF_HEADER_NAME default (HTTP_X_CSRFTOKEN)
      cookieMaxAgeSeconds: 31449600, // Django CSRF_COOKIE_AGE default (one year)
      trustedOrigins: e.CSRF_TRUSTED_ORIGINS,
    },
    cors: { allowedOrigins: e.CORS_ALLOWED_ORIGINS },
    allowedHosts: e.ALLOWED_HOSTS,
    loginRateLimit: { max: e.LOGIN_RATE_LIMIT_MAX, windowMs: e.LOGIN_RATE_LIMIT_WINDOW_MS },
    chatRateLimit: { max: e.CHAT_RATE_LIMIT_MAX, windowMs: e.CHAT_RATE_LIMIT_WINDOW_MS },
    groq: { apiKey: e.GROQ_API_KEY, baseURL: e.GROQ_BASE_URL },
    alerts: alertSettings(source),
  });
}

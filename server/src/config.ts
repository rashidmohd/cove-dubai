/**
 * 12-factor configuration.
 *
 * Every environment-specific value is read from the environment exactly once,
 * here, at startup — and validated. If a required variable is missing or
 * malformed the process exits immediately with a readable message, rather than
 * failing later in a request handler with a confusing error.
 *
 * Nothing about Railway, AWS, a hostname, or a credential is hardcoded anywhere
 * else in this service. That is what makes the Railway -> AWS move a config
 * change rather than a rewrite (see the `deployment` skill).
 */
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().positive().default(4000),

  databaseUrl: z.string().min(1, 'DATABASE_URL is required'),

  /** Browser origins permitted to call this API with credentials. */
  corsAllowedOrigins: z
    .string()
    .min(1, 'CORS_ALLOWED_ORIGINS is required')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  sessionSecret: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  sessionIdleTimeoutMinutes: z.coerce.number().int().positive().default(30),
  sessionCookieSameSite: z.enum(['lax', 'strict', 'none']).default('lax'),
  sessionCookieSecure: booleanFromString.default('false'),

  /** Empty in local dev -> the console email transport is used instead. */
  emailApiKey: z.string().optional(),
  emailFrom: z.string().min(1, 'EMAIL_FROM is required'),
  emailHotelNotificationAddress: z
    .string()
    .email('EMAIL_HOTEL_NOTIFICATION_ADDRESS must be a valid email address'),

  webBaseUrl: z.string().url('WEB_BASE_URL must be a valid URL'),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    databaseUrl: process.env.DATABASE_URL,
    corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
    sessionSecret: process.env.SESSION_SECRET,
    sessionIdleTimeoutMinutes: process.env.SESSION_IDLE_TIMEOUT_MINUTES,
    sessionCookieSameSite: process.env.SESSION_COOKIE_SAMESITE,
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE,
    emailApiKey: process.env.EMAIL_API_KEY || undefined,
    emailFrom: process.env.EMAIL_FROM,
    emailHotelNotificationAddress: process.env.EMAIL_HOTEL_NOTIFICATION_ADDRESS,
    webBaseUrl: process.env.WEB_BASE_URL,
  });

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Fail fast and loudly. A half-configured booking API is worse than none.
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'See server/.env.example for the full list of required variables.',
    );
  }

  const config = result.data;

  // A cross-origin cookie is only sent by browsers when it is also Secure.
  // On Railway `web` and `server` sit on different domains, so this pairing
  // matters — catch the mismatch at boot rather than at admin login.
  if (config.sessionCookieSameSite === 'none' && !config.sessionCookieSecure) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  - SESSION_COOKIE_SAMESITE="none" requires SESSION_COOKIE_SECURE="true".\n' +
        '    Browsers silently drop SameSite=None cookies that are not Secure.',
    );
  }

  return config;
}

export const config = loadConfig();

/** True when transactional email should really be sent rather than logged. */
export const emailSendingEnabled = Boolean(config.emailApiKey);

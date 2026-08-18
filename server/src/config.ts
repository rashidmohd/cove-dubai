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

  /**
   * Object storage for room photography.
   *
   * Spelt as a generic S3-compatible endpoint rather than anything named after
   * a vendor. Cloudflare R2 is what this points at today; AWS S3 behind
   * CloudFront is what it will point at after the production move. Same client,
   * same code — only these five values change (`deployment`).
   *
   * All optional as a group: with none of them set, uploads are disabled and
   * room types fall back to the CSS gradient `imageKey`, which is exactly the
   * state local development should be able to run in without a bucket. A
   * *partial* set is rejected below, because half-configured storage fails at
   * the first upload rather than at boot.
   */
  mediaEndpoint: z.string().url('MEDIA_ENDPOINT must be a valid URL').optional(),
  mediaBucket: z.string().min(1).optional(),
  mediaAccessKeyId: z.string().min(1).optional(),
  mediaSecretAccessKey: z.string().min(1).optional(),
  /**
   * Public origin the stored objects are served from — an R2 public bucket
   * domain, or a CDN in front of it.
   *
   * The database stores object **keys**, never absolute URLs, and this is
   * prefixed at read time. That is the whole portability trick: moving the
   * bucket or putting a CDN in front of it is this one variable, not a
   * data migration over every image row.
   */
  mediaPublicBaseUrl: z
    .string()
    .url('MEDIA_PUBLIC_BASE_URL must be a valid URL')
    .optional(),
  /** R2 ignores the region but the S3 protocol requires one. */
  mediaRegion: z.string().min(1).default('auto'),
  /** Cap on a single upload. Room photography, not video. */
  mediaMaxUploadBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
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
    mediaEndpoint: process.env.MEDIA_ENDPOINT || undefined,
    mediaBucket: process.env.MEDIA_BUCKET || undefined,
    mediaAccessKeyId: process.env.MEDIA_ACCESS_KEY_ID || undefined,
    mediaSecretAccessKey: process.env.MEDIA_SECRET_ACCESS_KEY || undefined,
    mediaPublicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL || undefined,
    mediaRegion: process.env.MEDIA_REGION,
    mediaMaxUploadBytes: process.env.MEDIA_MAX_UPLOAD_BYTES,
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

  // Object storage is all-or-nothing. A partial set boots happily and then
  // fails at the first upload — by which point someone is standing in the admin
  // panel with a photograph and no idea why.
  const mediaValues = {
    MEDIA_ENDPOINT: config.mediaEndpoint,
    MEDIA_BUCKET: config.mediaBucket,
    MEDIA_ACCESS_KEY_ID: config.mediaAccessKeyId,
    MEDIA_SECRET_ACCESS_KEY: config.mediaSecretAccessKey,
    MEDIA_PUBLIC_BASE_URL: config.mediaPublicBaseUrl,
  };
  const missing = Object.entries(mediaValues)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0 && missing.length < Object.keys(mediaValues).length) {
    throw new Error(
      'Invalid environment configuration:\n' +
        `  - Object storage is partly configured. Missing: ${missing.join(', ')}.\n` +
        '    Set all five to enable image uploads, or none to run without them.',
    );
  }

  return config;
}

export const config = loadConfig();

/** True when transactional email should really be sent rather than logged. */
export const emailSendingEnabled = Boolean(config.emailApiKey);

/**
 * True when image uploads are available.
 *
 * False is a legitimate state, not a broken one: the panel hides the upload
 * controls and room types keep rendering their CSS gradient, which is what the
 * site does today anyway while the client's photography is outstanding.
 */
export const mediaUploadsEnabled = Boolean(
  config.mediaEndpoint &&
    config.mediaBucket &&
    config.mediaAccessKeyId &&
    config.mediaSecretAccessKey &&
    config.mediaPublicBaseUrl,
);

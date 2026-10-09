/**
 * Request validation for guest accounts.
 *
 * Its own file, apart from both the booking and the admin schemas, for the same
 * reason those two are apart: three audiences, three contracts, and no field
 * from one can leak into another by sharing a schema.
 */
import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(160);

/**
 * Length is the rule that matters, and the only one. Composition rules push
 * people towards predictable substitutions; a long passphrase is stronger than
 * a short string with a digit in it.
 */
const newPassword = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Use at most 200 characters.');

/** The emailed secret: 32 bytes, base64url. Bounded so junk never reaches a hash. */
const token = z.string().trim().min(20).max(100);

const name = z.string().trim().min(1).max(80);

export const registerSchema = z.object({
  email,
  password: newPassword,
  firstName: name,
  lastName: name,
  locale: z.enum(['en', 'ar']).default('en'),
});

export const loginSchema = z.object({
  email,
  // Not length-checked beyond a bound: rejecting a sign-in for its format
  // would tell the caller what the rules are.
  password: z.string().min(1).max(200),
});

export const verifySchema = z.object({ token });

export const requestResetSchema = z.object({
  email,
  locale: z.enum(['en', 'ar']).optional(),
});

export const resetPasswordSchema = z.object({ token, password: newPassword });

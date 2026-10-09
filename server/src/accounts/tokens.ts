/**
 * Secrets that arrive by email or sit in a cookie.
 *
 * Every one is 32 random bytes, handed out once in plaintext and stored only
 * as a SHA-256 hash. SHA-256 rather than scrypt is deliberate: these are not
 * passwords a person chose, they are 256 bits of randomness, so there is
 * nothing for a slow hash to protect against — and every request has to look
 * a session up by its hash.
 */
import { createHash, randomBytes } from 'node:crypto';

/** A fresh secret, URL-safe so it survives a link and a cookie unencoded. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

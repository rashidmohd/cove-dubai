/**
 * Password hashing for admin accounts.
 *
 * Uses Node's built-in scrypt — a deliberate choice over bcrypt or argon2,
 * which are native modules that need a compiler at install time. Railway builds
 * with Nixpacks and there is no container image we control, so avoiding native
 * addons keeps deploys from breaking on a toolchain we do not manage. scrypt is
 * memory-hard and a sound choice for this.
 *
 * Stored format: `scrypt$N$r$p$<salt-hex>$<hash-hex>`. The parameters travel
 * with the hash, so they can be raised later without invalidating existing
 * passwords — an old hash still verifies against the parameters it was made
 * with.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// `scrypt` is overloaded and promisify resolves to the overload without an
// options argument, so the cost parameters below would be silently dropped.
// Naming the signature keeps them.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** OWASP-recommended minimum for scrypt at the time of writing. */
const PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH, {
    ...PARAMS,
    // scrypt needs enough memory to satisfy 128 * N * r; Node's default cap is
    // lower than our N, so raise it explicitly or the call throws.
    maxmem: 256 * PARAMS.N * PARAMS.r,
  })) as Buffer;

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const hashHex = parts[5];

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  const derived = (await scryptAsync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  })) as Buffer;

  // Constant-time comparison — a length check first, since timingSafeEqual
  // throws on mismatched lengths.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

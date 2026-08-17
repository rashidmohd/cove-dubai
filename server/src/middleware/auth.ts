/**
 * Admin authentication and authorisation.
 *
 * The session cookie proves only *which* session this is. Who that session
 * belongs to, whether they still work here, and what they are allowed to do
 * are re-read from the database on every request. That costs one indexed
 * lookup and buys immediate revocation: disabling an account or demoting
 * someone takes effect on their next request rather than at their next login.
 */
import type { NextFunction, Request, Response } from 'express';
import type { AdminRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { HttpError } from './errors.js';

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AuthenticatedAdmin;
    }
  }
}

/**
 * Reject anything without a live session belonging to an active admin.
 *
 * Returns 401 rather than 403 for every failure here — the caller is not
 * authenticated, as opposed to authenticated and not permitted.
 */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const adminUserId = req.session?.adminUserId;

    if (!adminUserId) {
      throw new HttpError(
        401,
        'UNAUTHENTICATED',
        'Sign in to use the admin panel.',
      );
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: adminUserId },
    });

    // The account was deleted or disabled while the session was still alive.
    // Tear the session down rather than leaving a cookie that keeps failing.
    if (!admin || !admin.isActive) {
      req.session.destroy(() => undefined);
      throw new HttpError(
        401,
        'UNAUTHENTICATED',
        'This account is no longer active.',
      );
    }

    req.admin = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Restrict a route to particular roles. Must run after `requireAdmin`.
 *
 * STAFF handle day-to-day reservations; ADMIN additionally manages pricing,
 * settings, and other admin accounts.
 */
export function requireRole(...roles: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next(
        new HttpError(401, 'UNAUTHENTICATED', 'Sign in to use the admin panel.'),
      );
      return;
    }

    if (!roles.includes(req.admin.role)) {
      next(
        new HttpError(
          403,
          'FORBIDDEN',
          'Your role does not permit this action.',
        ),
      );
      return;
    }

    next();
  };
}

/** The admin on the request, for handlers that run behind `requireAdmin`. */
export function currentAdmin(req: Request): AuthenticatedAdmin {
  if (!req.admin) {
    // Reaching here means a route was mounted without `requireAdmin`, which is
    // a wiring bug rather than a request the client got wrong.
    throw new Error('currentAdmin() called on a route without requireAdmin');
  }
  return req.admin;
}

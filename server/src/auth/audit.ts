/**
 * The audit log.
 *
 * CLAUDE.md's non-negotiable baseline requires an entry for every
 * administrative action. The table is append-only: nothing in this codebase
 * updates or deletes a row, because an audit trail that can be edited is not
 * an audit trail.
 *
 * Writing an entry must never be the reason a legitimate action fails. If the
 * log write throws, the action stands and the failure is reported loudly to
 * the server log — losing one audit row is bad, but refusing a cancellation
 * the front desk needs is worse. The exception is `recordAuditIn`, which joins
 * an existing transaction: there the entry and the change succeed or fail
 * together by design.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';

import { prisma } from '../db/prisma.js';

/**
 * Actions worth recording, named `entity.verb`.
 *
 * A closed union rather than free text so the log stays queryable — a report
 * over "who cancelled bookings last month" only works if everyone spells the
 * action the same way.
 */
export type AuditAction =
  | 'admin.login'
  | 'admin.login_failed'
  | 'admin.logout'
  /** Written by the `admin:password` script, never by a request. */
  | 'admin.password_set'
  | 'reservation.create'
  | 'reservation.modify'
  | 'reservation.cancel'
  | 'reservation.check_in'
  | 'reservation.check_out'
  | 'room_type.update'
  | 'room_type.set_amenities'
  | 'room_type.add_image'
  | 'room_type.remove_image'
  | 'room_type.reorder_images'
  | 'amenity.create'
  | 'amenity.update'
  | 'amenity.delete'
  | 'rate_plan.create'
  | 'rate_plan.update'
  | 'rate_plan.delete'
  | 'inventory.update'
  | 'setting.update'
  | 'voucher.create'
  | 'voucher.update'
  | 'voucher.delete';

export interface AuditEntry {
  /** Null for actions with no signed-in admin — a failed login, say. */
  adminUserId?: string | null;
  action: AuditAction;
  entityType: string;
  /** The public identifier: a booking reference or room-type code, never a row id. */
  entityId: string;
  /**
   * Before/after values, or whatever context makes the entry meaningful.
   *
   * A plain record rather than Prisma's `InputJsonValue` so callers can hand
   * over domain objects directly. It is serialized on the way in, which also
   * guarantees the stored value is genuinely JSON rather than something with
   * methods on it.
   */
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Write an audit entry inside an existing transaction.
 *
 * Use this when the entry must be atomic with the change it describes, so a
 * rolled-back write cannot leave a log line claiming it happened.
 */
export function recordAuditIn(db: Db, entry: AuditEntry): Promise<unknown> {
  return db.auditLog.create({
    data: {
      adminUserId: entry.adminUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ...(entry.details === undefined
        ? {}
        : {
            details: JSON.parse(
              JSON.stringify(entry.details),
            ) as Prisma.InputJsonValue,
          }),
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

/** Write an audit entry on its own, never throwing. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await recordAuditIn(prisma, entry);
  } catch (error) {
    console.error('[cove-dubai/server] failed to write audit entry:', {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      error,
    });
  }
}

/**
 * Build the audit fields that come from the request itself.
 *
 * `req.ip` is trustworthy because the app sets `trust proxy` — without it,
 * every entry would record Railway's proxy address instead of the admin's.
 */
export function auditContextOf(req: Request): {
  adminUserId: string | null;
  ipAddress: string | null;
} {
  return {
    adminUserId: req.admin?.id ?? null,
    ipAddress: req.ip ?? null,
  };
}

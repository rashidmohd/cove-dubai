/**
 * A Postgres-backed session store for `express-session`.
 *
 * Written here rather than pulled in as a dependency so sessions live in the
 * same schema and the same migration flow as everything else, and so the table
 * is visible in `schema.prisma` instead of being created behind our back by a
 * library.
 *
 * The default `MemoryStore` is unusable for this project: Railway restarts
 * containers on every deploy, which would sign every admin out, and it cannot
 * work across more than one instance. It also leaks — the library itself warns
 * against production use.
 */
import { Store, type SessionData } from 'express-session';
import type { PrismaClient } from '@prisma/client';

/** How often expired rows are swept, in milliseconds. */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

type Callback = (err?: unknown) => void;

export class PrismaSessionStore extends Store {
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient) {
    super();

    this.sweepTimer = setInterval(() => {
      void this.sweepExpired();
    }, SWEEP_INTERVAL_MS);

    // Session cleanup must never be the reason a container stays alive.
    this.sweepTimer.unref();
  }

  /**
   * Work out when a session row should expire.
   *
   * `cookie.expires` is maintained by express-session and, because the cookie
   * is rolling, moves forward on every request — which is precisely the idle
   * timeout. Falling back to `maxAge` covers a session written before the
   * cookie has been given an absolute expiry.
   */
  private expiryOf(session: SessionData): Date {
    const expires = session.cookie?.expires;
    if (expires) return new Date(expires);

    const maxAge = session.cookie?.maxAge ?? 0;
    return new Date(Date.now() + maxAge);
  }

  get(
    sid: string,
    callback: (err: unknown, session?: SessionData | null) => void,
  ): void {
    this.prisma.adminSession
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row) {
          callback(null, null);
          return;
        }

        // A row can outlive its expiry between sweeps. Treat it as absent, so
        // an idle-timed-out session cannot be resurrected by the sweep simply
        // not having run yet.
        if (row.expiresAt.getTime() <= Date.now()) {
          callback(null, null);
          return;
        }

        callback(null, JSON.parse(row.data) as SessionData);
      })
      .catch((error: unknown) => {
        // A malformed payload is not worth failing the request over — the
        // session is unreadable either way, so treat it as no session.
        if (error instanceof SyntaxError) {
          callback(null, null);
          return;
        }
        callback(error);
      });
  }

  set(sid: string, session: SessionData, callback?: Callback): void {
    const data = JSON.stringify(session);
    const expiresAt = this.expiryOf(session);

    this.prisma.adminSession
      .upsert({
        where: { sid },
        create: { sid, data, expiresAt },
        update: { data, expiresAt },
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: Callback): void {
    this.prisma.adminSession
      .deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  /**
   * Push the expiry forward without rewriting the payload.
   *
   * express-session calls this on every request of a rolling session. Doing it
   * as a narrow update keeps the per-request cost to one small write rather
   * than re-serializing and rewriting the whole session.
   */
  override touch(sid: string, session: SessionData, callback?: Callback): void {
    this.prisma.adminSession
      .updateMany({
        where: { sid },
        data: { expiresAt: this.expiryOf(session) },
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  /** Delete every session belonging to one admin. Used when disabling them. */
  async destroyAllForAdmin(adminUserId: string): Promise<number> {
    const rows = await this.prisma.adminSession.findMany();

    const doomed = rows
      .filter((row) => {
        try {
          const parsed = JSON.parse(row.data) as SessionData;
          return parsed.adminUserId === adminUserId;
        } catch {
          return false;
        }
      })
      .map((row) => row.sid);

    if (doomed.length === 0) return 0;

    const { count } = await this.prisma.adminSession.deleteMany({
      where: { sid: { in: doomed } },
    });
    return count;
  }

  private async sweepExpired(): Promise<void> {
    try {
      await this.prisma.adminSession.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
    } catch (error) {
      // A failed sweep is not fatal: `get` already rejects expired rows, so
      // this only costs disk until the next run.
      console.error('[cove-dubai/server] session sweep failed:', error);
    }
  }
}

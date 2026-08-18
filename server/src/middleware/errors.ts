/**
 * Error handling for the API.
 *
 * Domain failures are mapped to HTTP status codes in exactly one place, so
 * routes never construct error responses themselves and cannot drift apart in
 * how they report the same condition.
 *
 * Every response uses the same envelope — `{ error: { code, message, details } }`
 * — so the front-end can branch on `code` rather than parse prose. That matters
 * most for `NO_AVAILABILITY`, which the booking flow has to present as a
 * specific, translated message rather than a generic failure.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { config } from '../config.js';
import { BookingError, type BookingErrorCode } from '../booking/types.js';

const STATUS_BY_CODE: Record<BookingErrorCode, number> = {
  NO_AVAILABILITY: 409,
  ROOM_TYPE_NOT_FOUND: 404,
  RESERVATION_NOT_FOUND: 404,
  INVALID_STAY: 400,
  OCCUPANCY_EXCEEDED: 400,
  MINIMUM_STAY_NOT_MET: 400,
  ALREADY_CANCELLED: 409,
  CANCELLATION_NOT_PERMITTED: 409,
  // 403 rather than 404: the booking exists, the link just is not valid for it.
  INVALID_CANCELLATION_TOKEN: 403,
  // 409: the request is well-formed, it just conflicts with rooms already sold.
  INVENTORY_BELOW_BOOKED: 409,
  SETTING_NOT_FOUND: 404,
  INVALID_STATUS_TRANSITION: 409,
  AMENITY_NOT_FOUND: 404,
  AMENITY_CODE_IN_USE: 409,
  VOUCHER_NOT_FOUND: 404,
  // 409 rather than 400: the code is well-formed, it just cannot be used now.
  VOUCHER_EXPIRED: 409,
  VOUCHER_EXHAUSTED: 409,
  VOUCHER_NOT_APPLICABLE: 409,
  VOUCHER_CODE_IN_USE: 409,
  MEDIA_NOT_FOUND: 404,
  // 409: the request is well-formed, it just no longer describes the gallery.
  MEDIA_ORDER_MISMATCH: 409,
  // 503, not 500: the service is fine, this one capability is switched off by
  // configuration. Retrying will not help until someone sets the variables.
  MEDIA_NOT_CONFIGURED: 503,
};

/** Raised by routes for non-domain failures such as a bad session. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'No such endpoint.' },
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  // Express identifies an error handler by its four-parameter shape, so `next`
  // must stay even though it is unused.
  _next: NextFunction,
): void {
  if (error instanceof BookingError) {
    res.status(STATUS_BY_CODE[error.code]).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request body or query is invalid.',
        details: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }

  // Anything reaching here is a bug rather than a handled condition. Log it in
  // full, but never leak internals — a stack trace or a database error string
  // can disclose schema details.
  console.error('[cove-dubai/server] unhandled error:', error);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      ...(config.nodeEnv === 'development' && error instanceof Error
        ? { details: { message: error.message } }
        : {}),
    },
  });
}

/**
 * Wrap an async route so a rejected promise reaches the error handler.
 *
 * Express 4 does not catch rejections from async handlers; without this an
 * unavailable-room error would hang the request instead of returning 409.
 */
export function asyncRoute<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

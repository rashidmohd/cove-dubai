'use client';

/**
 * The pieces that know about the hotel.
 *
 * Everything here understands a reservation, a locale or an API error. The
 * purely presentational layer — buttons, cards, fields, badges — is in `ui.tsx`
 * and is re-exported at the bottom so a screen has one place to import from.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { ApiError } from '@/lib/api/client';
import type { ReservationStatus } from '@/lib/api/types';
import { Alert, Badge } from './ui';
import styles from './Admin.module.css';

/**
 * A number, date, reference, or price, isolated from the surrounding text.
 *
 * A Latin-digit run inside Arabic gets rearranged by the bidi algorithm — a
 * range of "2 – 6" renders as "6 – 2", which is wrong information rather than
 * wrong styling. `<bdi>` isolates the run so that cannot happen.
 *
 * Direction is left to `<bdi>`'s own `auto`, deliberately **not** forced to
 * `ltr`. Forcing it looks right for a booking reference and is wrong for a
 * date: `formatStayDate` returns "15 أغسطس 2026" on /ar, and pinning that to
 * LTR reorders it to "15 2026 أغسطس". Auto reads the first strong character —
 * Latin in a reference, Arabic in an Arabic date, neither in a bare number
 * (which then falls back to LTR) — and gets all three right.
 */
export function Num({ children }: { children: ReactNode }) {
  return <bdi className={styles.isolate}>{children}</bdi>;
}

/**
 * How each reservation status is coloured.
 *
 * "Checked in" is the solid gold one on purpose — it is the status that means a
 * guest is physically in the building, which is what the front desk scans a
 * list for. Everything else recedes into the soft tints.
 */
const STATUS_TONES: Record<
  ReservationStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'accent'
> = {
  confirmed: 'success',
  'checked-in': 'accent',
  'checked-out': 'neutral',
  cancelled: 'danger',
  held: 'warning',
};

/**
 * A reservation's status.
 *
 * The label always states the status in words — colour and the dot only
 * reinforce it, so the meaning survives for anyone who cannot distinguish the
 * tints.
 */
export function StatusPill({ status }: { status: ReservationStatus }) {
  const t = useTranslations('admin');

  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {t(`status.${statusKey(status)}`)}
    </Badge>
  );
}

function statusKey(status: ReservationStatus): string {
  return status === 'checked-in'
    ? 'checkedIn'
    : status === 'checked-out'
      ? 'checkedOut'
      : status;
}

/** A failed request, announced. Renders nothing when there is no message. */
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <Alert tone="error" role="alert">
      <bdi>{message}</bdi>
    </Alert>
  );
}

/** A completed action, announced politely rather than interrupting. */
export function SavedNote({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <Alert tone="success" role="status">
      <bdi>{message}</bdi>
    </Alert>
  );
}

/**
 * Turn a failed call into a message the user can act on.
 *
 * Branches on the error `code` rather than the server's prose, so the same
 * condition reads correctly in both languages and a permissions problem does
 * not look like a network problem.
 */
export function useApiErrorMessage() {
  const t = useTranslations('admin');
  const tErrors = useTranslations('errors');

  return (caught: unknown): string => {
    if (!(caught instanceof ApiError)) return tErrors('unknown');

    if (caught.code === 'NETWORK_ERROR') return tErrors('network');
    if (caught.status === 401) return t('errors.signedOut');
    if (caught.code === 'FORBIDDEN') return t('errors.forbidden');
    if (caught.code === 'INVENTORY_BELOW_BOOKED') {
      return t('errors.inventoryBelowBooked');
    }
    if (caught.code === 'INVALID_STATUS_TRANSITION') {
      return t('errors.invalidTransition');
    }
    if (caught.code === 'AMENITY_CODE_IN_USE') return t('errors.amenityInUse');
    if (caught.code === 'VOUCHER_NOT_FOUND') return t('errors.voucherNotFound');
    if (caught.code === 'VOUCHER_EXPIRED') return t('errors.voucherExpired');
    if (caught.code === 'VOUCHER_EXHAUSTED') return t('errors.voucherExhausted');
    if (caught.code === 'VOUCHER_NOT_APPLICABLE') {
      return t('errors.voucherNotApplicable');
    }
    if (caught.code === 'VOUCHER_CODE_IN_USE') return t('errors.voucherInUse');
    if (caught.code === 'CSRF_TOKEN_INVALID') return t('errors.signedOut');

    return caught.message;
  };
}

/**
 * The presentational layer, re-exported.
 *
 * Screens import from here so a component moving between the two files does not
 * ripple through six import lists.
 */
export {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  cx,
  Empty,
  Field,
  Input,
  Loading,
  Pagination,
  Select,
  Skeleton,
  Stat,
  StatGridSkeleton,
  Textarea,
} from './ui';

'use client';

/**
 * The cancellation flow.
 *
 * Shows the booking, asks for confirmation, then cancels. The confirmation step
 * is not ceremony: the link arrives in an email, and mail clients and security
 * scanners follow links in the background. Cancelling on page load would let a
 * scanner cancel a guest's stay before they ever clicked.
 *
 * The token is read from the query string and sent in the request body rather
 * than kept in component state beyond that — it is single-use, and once spent
 * the same link is dead, which the API enforces.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { ApiError, bookingApi } from '@/lib/api/client';
import type { Locale, Reservation } from '@/lib/api/types';
import { formatMoney, formatStayDate } from '@/lib/format';
import styles from './Cancel.module.css';

type Phase = 'loading' | 'confirming' | 'cancelled' | 'failed';

export function CancelFlow({ locale }: { locale: Locale }) {
  const t = useTranslations('cancel');
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');

  const params = useSearchParams();
  const reference = params.get('reference');
  const token = params.get('token');

  const [phase, setPhase] = useState<Phase>('loading');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const describe = useCallback(
    (caught: unknown): string => {
      if (caught instanceof ApiError) {
        if (caught.code === 'NETWORK_ERROR') return tErrors('network');
        if (caught.code === 'ALREADY_CANCELLED') return t('alreadyCancelled');
        if (
          caught.code === 'INVALID_CANCELLATION_TOKEN' ||
          caught.code === 'RESERVATION_NOT_FOUND'
        ) {
          return t('invalidLink');
        }
        return caught.message;
      }
      return tErrors('unknown');
    },
    [t, tErrors],
  );

  useEffect(() => {
    if (!reference || !token) {
      setError(t('invalidLink'));
      setPhase('failed');
      return;
    }

    let cancelled = false;

    // Read-only: shows the guest what they are about to cancel. The reference
    // alone is enough to look up, but not to cancel.
    bookingApi
      .getReservation(reference)
      .then((found) => {
        if (cancelled) return;
        setReservation(found);
        setPhase(found.status === 'cancelled' ? 'cancelled' : 'confirming');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(describe(caught));
        setPhase('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [reference, token, describe, t]);

  async function confirm(): Promise<void> {
    if (!reference || !token) return;

    setError(null);
    try {
      setReservation(await bookingApi.cancelReservation(reference, token));
      setPhase('cancelled');
    } catch (caught) {
      setError(describe(caught));
      setPhase('failed');
    }
  }

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('title')}</h1>

        {phase === 'loading' ? (
          <p className={styles.status} role="status">
            {tCommon('loading')}
          </p>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {reservation ? (
          <dl className={styles.summary}>
            <Row
              label={t('reference')}
              value={<bdi>{reservation.reference}</bdi>}
            />
            <Row
              label={t('room')}
              value={<bdi>{reservation.roomType.name[locale]}</bdi>}
            />
            <Row
              label={t('stay')}
              value={
                <bdi>
                  {formatStayDate(reservation.stay.checkIn, locale)} –{' '}
                  {formatStayDate(reservation.stay.checkOut, locale)}
                </bdi>
              }
            />
            <Row
              label={t('total')}
              value={
                <bdi>
                  {formatMoney(
                    reservation.price.grandTotal,
                    reservation.price.currency,
                    locale,
                  )}
                </bdi>
              }
            />
          </dl>
        ) : null}

        {phase === 'confirming' ? (
          <>
            <p className={styles.body}>{t('confirmBody')}</p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.confirm}
                onClick={() => void confirm()}
              >
                {t('confirm')}
              </button>
              <a className={styles.keep} href={`/${locale}`}>
                {t('keepBooking')}
              </a>
            </div>
          </>
        ) : null}

        {phase === 'cancelled' ? (
          <>
            <p className={styles.done} role="status">
              {t('cancelled')}
            </p>
            <p className={styles.body}>{t('cancelledBody')}</p>
            <div className={styles.actions}>
              <a className={styles.keep} href={`/${locale}`}>
                {t('backHome')}
              </a>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowLabel}>{label}</dt>
      <dd className={styles.rowValue}>{value}</dd>
    </div>
  );
}

'use client';

/**
 * Step 4 — confirmation.
 *
 * Two things the guest must leave with, both required by `booking-engine`:
 * the booking reference, which is the only handle they have on the reservation
 * (internal ids are never exposed), and an unambiguous statement that no money
 * has been taken and payment happens at check-in.
 */
import { useTranslations } from 'next-intl';

import { formatMoney, formatStayDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import type { Locale, Reservation } from '@/lib/api/types';
import styles from './Reserve.module.css';

interface ConfirmationProps {
  locale: Locale;
  reservation: Reservation;
}

export function Confirmation({ locale, reservation }: ConfirmationProps) {
  const t = useTranslations('reserve.success');
  const tSummary = useTranslations('reserve.summary');
  const tCommon = useTranslations('common');

  return (
    <div className={styles.page}>
      <div className={styles.formSide}>
        {/* `status` announces the outcome to screen readers on arrival without
            stealing focus. */}
        <div className={styles.success} role="status">
          <h1 className={styles.successTitle}>{t('title')}</h1>

          <p className={styles.reference}>
            <span className={styles.referenceLabel}>{t('reference')}</span>
            <span className={styles.referenceValue}>
              {reservation.reference}
            </span>
          </p>

          <p>{t('emailSent', { email: reservation.guest.email })}</p>
          <p>{t('payAtCheckIn')}</p>

          <Link href="/" className={styles.btnPrimary}>
            {tCommon('backHome')}
          </Link>
        </div>
      </div>

      <aside className={styles.side} aria-label={tSummary('title')}>
        <div className={styles.sideInner}>
          <h2 className={styles.sideHead}>{tSummary('title')}</h2>

          <dl className={styles.sideRows}>
            <Row
              label={tSummary('room')}
              value={reservation.roomType.name[locale]}
            />
            <Row
              label={tSummary('checkIn')}
              value={formatStayDate(reservation.stay.checkIn, locale)}
            />
            <Row
              label={tSummary('checkOut')}
              value={formatStayDate(reservation.stay.checkOut, locale)}
            />
            <Row
              label={tSummary('roomTotal')}
              value={formatMoney(
                reservation.price.roomTotal,
                reservation.price.currency,
                locale,
              )}
            />
            <Row
              label={tSummary('tourismDirham')}
              value={formatMoney(
                reservation.price.tourismDirham.total,
                reservation.price.currency,
                locale,
              )}
            />
            <Row
              label={tSummary('vat', {
                rate: reservation.price.vat.ratePercent,
              })}
              value={formatMoney(
                reservation.price.vat.total,
                reservation.price.currency,
                locale,
              )}
            />
          </dl>

          <div className={styles.sideTotal}>
            <span className={styles.sideTotalLabel}>{tSummary('total')}</span>
            <span className={styles.sideTotalAmount}>
              {formatMoney(
                reservation.price.grandTotal,
                reservation.price.currency,
                locale,
              )}
            </span>
            <p className={styles.sideTotalNote}>{tSummary('payAtCheckIn')}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.sideRow}>
      <dt className={styles.sideKey}>{label}</dt>
      <dd className={styles.sideValue}>{value}</dd>
    </div>
  );
}

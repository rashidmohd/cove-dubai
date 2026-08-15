'use client';

/**
 * The stay summary sidebar.
 *
 * This is the one place in the flow that departs from the mockups by adding
 * content rather than restyling it. The mockup summary shows a single
 * `AED <total>`; the `booking-engine` skill requires the guest see the room
 * total, the Tourism Dirham and the 5% VAT itemised before they commit. Both
 * fees are government-set and shown-not-charged, so hiding them inside one
 * figure would misrepresent what the guest owes at check-in.
 *
 * Every number here comes from the API's price breakdown. Nothing is computed
 * in the browser — pricing belongs to the booking layer so a future PMS can own
 * it (`pms-readiness`), and a total calculated twice is a total that can
 * disagree with itself.
 */
import { useTranslations } from 'next-intl';

import { Glow, Weave } from '@/components/BrandEffects';
import { formatMoney, formatStayDate } from '@/lib/format';
import type { AvailableRoomType, Locale, PriceBreakdown } from '@/lib/api/types';
import styles from './Reserve.module.css';

interface StaySummaryProps {
  locale: Locale;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  room: AvailableRoomType | null;
  price: PriceBreakdown | null;
}

export function StaySummary({
  locale,
  checkIn,
  checkOut,
  adults,
  children,
  room,
  price,
}: StaySummaryProps) {
  const t = useTranslations('reserve.summary');
  const tCommon = useTranslations('common');

  const guestCount = adults + children;

  return (
    <aside className={styles.side} aria-label={t('title')}>
      <Weave opacity={0.05} gap={22} />
      <Glow width={320} height={320} strength={0.07} />

      <div className={styles.sideInner}>
        <h2 className={styles.sideHead}>{t('title')}</h2>

        {!room || !price ? (
          <p className={styles.sideEmpty}>{t('payAtCheckIn')}</p>
        ) : (
          <>
            <dl className={styles.sideRows}>
              <Row label={t('room')} value={room.name[locale]} />
              <Row
                label={t('checkIn')}
                value={checkIn ? formatStayDate(checkIn, locale) : '—'}
              />
              <Row
                label={t('checkOut')}
                value={checkOut ? formatStayDate(checkOut, locale) : '—'}
              />
              <Row
                label={t('nights')}
                value={`${price.nights} ${
                  price.nights === 1 ? tCommon('night') : tCommon('nights')
                }`}
              />
              <Row
                label={t('guests')}
                value={`${guestCount} ${
                  guestCount === 1 ? tCommon('adult') : tCommon('adults')
                }`}
              />

              {/* The three lines the mockup does not have. */}
              <Row
                label={t('roomTotal')}
                value={formatMoney(price.roomTotal, price.currency, locale)}
              />
              <Row
                label={t('tourismDirham')}
                note={t('tourismDirhamNote')}
                value={formatMoney(
                  price.tourismDirham.total,
                  price.currency,
                  locale,
                )}
              />
              <Row
                label={t('vat', { rate: price.vat.ratePercent })}
                value={formatMoney(price.vat.total, price.currency, locale)}
              />
            </dl>

            <div className={styles.sideTotal}>
              <span className={styles.sideTotalLabel}>{t('total')}</span>
              <span className={styles.sideTotalAmount}>
                {formatMoney(price.grandTotal, price.currency, locale)}
              </span>
              {/* The pay-at-check-in model must be explicit before the guest
                  commits — they are confirming a booking that takes no money. */}
              <p className={styles.sideTotalNote}>{t('payAtCheckIn')}</p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function Row({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className={styles.sideRow}>
      <dt className={styles.sideKey}>
        {label}
        {note ? <span className={styles.sideNote}>{note}</span> : null}
      </dt>
      <dd className={styles.sideValue}>{value}</dd>
    </div>
  );
}

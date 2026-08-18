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
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Glow, Weave } from '@/components/BrandEffects';
import { formatMoney, formatStayDate } from '@/lib/format';
import type {
  AvailableRoomType,
  Locale,
  PriceBreakdown,
  VoucherPreview,
} from '@/lib/api/types';
import styles from './Reserve.module.css';

interface StaySummaryProps {
  locale: Locale;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  room: AvailableRoomType | null;
  price: PriceBreakdown | null;
  /** The applied discount, if the guest has entered a valid code. */
  voucher: VoucherPreview | null;
  /** Resolves to an error message to show inline, or null on success. */
  onApplyVoucher: (code: string) => Promise<string | null>;
  onRemoveVoucher: () => void;
}

export function StaySummary({
  locale,
  checkIn,
  checkOut,
  adults,
  children,
  room,
  price,
  voucher,
  onApplyVoucher,
  onRemoveVoucher,
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
              {/* Between the room total and the fees, because that is the
                  order the money moves in: the discount comes off the
                  accommodation charge, and the VAT line below is already
                  calculated on what remains. */}
              {price.discount ? (
                <Row
                  label={price.discount.name[locale]}
                  value={`−${formatMoney(
                    price.discount.amount,
                    price.currency,
                    locale,
                  )}`}
                />
              ) : null}

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

            <VoucherField
              voucher={voucher}
              onApply={onApplyVoucher}
              onRemove={onRemoveVoucher}
            />
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * The discount code entry.
 *
 * Below the total on purpose: it is optional, most guests do not have one, and
 * putting it above the price invites the feeling that a discount is expected.
 *
 * Its own small form rather than part of the guest-details step, because
 * applying a code is a request to the API that reprices the stay — it is not a
 * field submitted with the booking, and pressing Enter here must not submit
 * anything else.
 */
function VoucherField({
  voucher,
  onApply,
  onRemove,
}: {
  voucher: VoucherPreview | null;
  onApply: (code: string) => Promise<string | null>;
  onRemove: () => void;
}) {
  const t = useTranslations('reserve');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (voucher) {
    return (
      <div className={styles.voucherApplied}>
        <p className={styles.voucherAppliedText}>
          {t('voucherApplied', { name: voucher.name.en })}
        </p>
        <button
          type="button"
          className={styles.voucherRemove}
          onClick={() => {
            onRemove();
            setCode('');
            setError(null);
          }}
        >
          {t('voucherRemove')}
        </button>
      </div>
    );
  }

  async function apply() {
    if (!code.trim()) return;
    setBusy(true);
    setError(await onApply(code.trim()));
    setBusy(false);
  }

  return (
    <div className={styles.voucher}>
      <label className={styles.voucherLabel} htmlFor="voucher-code">
        {t('voucherLabel')}
      </label>

      <div className={styles.voucherRow}>
        <input
          id="voucher-code"
          className={styles.voucherInput}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          // Enter applies the code rather than submitting the booking form
          // this sidebar sits beside.
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void apply();
            }
          }}
          placeholder={t('voucherPlaceholder')}
          autoComplete="off"
          // Codes are Latin characters and digits in both locales.
          dir="ltr"
        />
        <button
          type="button"
          className={styles.voucherApply}
          onClick={() => void apply()}
          disabled={busy || !code.trim()}
        >
          {t('voucherApply')}
        </button>
      </div>

      {error ? (
        <p className={styles.voucherError} role="alert">
          <bdi>{error}</bdi>
        </p>
      ) : null}
    </div>
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

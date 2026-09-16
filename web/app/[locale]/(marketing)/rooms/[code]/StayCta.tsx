'use client';

/**
 * The price and reserve action on a room page.
 *
 * Two exports for one piece of UI, because this page is static and its price
 * is not:
 *
 *   - `StayCtaFallback` knows only the room's "from" rate. It needs nothing
 *     from the request, so it renders during prerendering and is what ends up
 *     in the static HTML — and what a searcher and the first paint get.
 *   - `StayCta` reads the stay out of the query string, which no build can
 *     know, and replaces the above in the browser with the real total for those
 *     nights.
 *
 * A guest who arrives from the Rooms listing has no dates and sees the first
 * one, unchanged. A guest who arrives from step 2 of the booking flow brought
 * their dates with them and sees what those nights actually cost — the point of
 * clicking through from a priced list to a page that priced it differently
 * would be lost otherwise.
 *
 * **The price is never computed here.** It is quoted by the API, like every
 * other figure in the flow, so a future PMS owns pricing without this component
 * changing (`pms-readiness`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { bookingApi } from '@/lib/api/client';
import type { Locale, PriceBreakdown } from '@/lib/api/types';
import { countNights, formatMoney } from '@/lib/format';
import { readStayQuery, todayInDubai } from '@/lib/stay-dates';
import styles from './page.module.css';

interface Props {
  roomCode: string;
  baseRate: number;
  locale: Locale;
}

export function StayCtaFallback({ roomCode, baseRate, locale }: Props) {
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');

  return (
    // `data-mode` is what the e2e suite reads to tell "from a nightly rate"
    // apart from "the total for these nights". The two differ only in their
    // wording, and the suite addresses nothing by text — Arabic mirrors English
    // until the client's copy lands, so a text selector would pass today and
    // break exactly when real translations arrive.
    <div className={styles.stayCta} data-mode="from" data-testid="stay-cta">
      <p className={styles.stayPrice}>
        <span className={styles.stayLabel}>{t('from')}</span>
        <span className={styles.stayAmount}>
          {formatMoney(baseRate, tCommon('currency'), locale)}
        </span>
        <span className={styles.stayPer}>{tCommon('perNight')}</span>
      </p>

      <Link
        href={{ pathname: '/reserve', query: { room: roomCode } }}
        className={styles.stayAction}
        data-testid="reserve-this-room"
      >
        {t('detail.reserveThisRoom')}
      </Link>
    </div>
  );
}

export function StayCta({ roomCode, baseRate, locale }: Props) {
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');
  const searchParams = useSearchParams();

  const stay = useMemo(
    () =>
      readStayQuery(
        new URLSearchParams(searchParams.toString()),
        todayInDubai(),
      ),
    [searchParams],
  );

  const { checkIn, checkOut, adults } = stay;

  /**
   * The quote, tagged with the stay it was asked for.
   *
   * Tagged rather than cleared when the stay changes: clearing would mean a
   * `setState` in the effect body, and a second render whose only purpose is to
   * blank a figure. Holding the key alongside the price lets the stale case be
   * *derived* below — an old total is simply not the total for this stay, and
   * never renders as one.
   */
  const [quote, setQuote] = useState<{
    key: string;
    price: PriceBreakdown;
  } | null>(null);

  const stayKey = `${roomCode}|${checkIn}|${checkOut}`;

  useEffect(() => {
    if (!checkIn || !checkOut) return;

    let cancelled = false;

    bookingApi
      .getRate({ roomTypeCode: roomCode, checkIn, checkOut })
      .then((quoted) => {
        if (!cancelled) setQuote({ key: stayKey, price: quoted });
      })
      .catch(() => {
        // Deliberately silent. The stay is a hint carried in a URL, not
        // something the guest typed here, and a room that is closed for those
        // nights or an API that is briefly down should leave a room page
        // showing its nightly rate — not an error the guest cannot act on and
        // did not ask for. The booking flow states availability properly.
      });

    return () => {
      cancelled = true;
    };
  }, [stayKey, roomCode, checkIn, checkOut]);

  const price = quote?.key === stayKey ? quote.price : null;

  // No usable stay in the URL, and nothing to add to what the static render
  // already said.
  if (!checkIn || !checkOut) {
    return (
      <StayCtaFallback
        roomCode={roomCode}
        baseRate={baseRate}
        locale={locale}
      />
    );
  }

  const nights = countNights(checkIn, checkOut);

  return (
    <div
      className={styles.stayCta}
      data-mode={price ? 'stay' : 'from'}
      data-testid="stay-cta"
    >
      {price ? (
        <p className={styles.stayPrice}>
          <span className={styles.stayLabel}>{t('detail.forStay')}</span>
          <span className={styles.stayAmount}>
            {formatMoney(price.grandTotal, price.currency, locale)}
          </span>
          <span className={styles.stayPer}>
            {nights} {nights === 1 ? tCommon('night') : tCommon('nights')}
          </span>
        </p>
      ) : (
        // The nightly rate holds the line while the quote is in flight, so the
        // block never collapses and nothing below it moves when the total
        // lands.
        <p className={styles.stayPrice}>
          <span className={styles.stayLabel}>{t('from')}</span>
          <span className={styles.stayAmount}>
            {formatMoney(baseRate, tCommon('currency'), locale)}
          </span>
          <span className={styles.stayPer}>{tCommon('perNight')}</span>
        </p>
      )}

      <Link
        href={{
          pathname: '/reserve',
          query: {
            checkIn,
            checkOut,
            ...(adults === null ? {} : { adults: String(adults) }),
            room: roomCode,
          },
        }}
        className={styles.stayAction}
        data-testid="reserve-this-room"
      >
        {t('detail.reserveThisRoom')}
      </Link>
    </div>
  );
}

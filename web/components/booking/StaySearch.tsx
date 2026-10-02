'use client';

/**
 * The stay search — check in, check out, guests, go.
 *
 * Built for the home page hero, where the guest's first question is "can I
 * stay on my dates" and the answer currently costs them a page load and a
 * second visit to a date picker. This hands the whole stay to `/reserve` in the
 * query string, so the flow opens already filled in (`useBookingState` reads
 * it) and the guest never enters the same dates twice.
 *
 * It deliberately does **not** call the availability API itself. Availability
 * and pricing belong to the booking layer behind the Express seam, and a home
 * page that quotes prices is a home page that has to be rewritten when a PMS
 * takes those over (`pms-readiness`). This is a very good link, nothing more.
 *
 * The month grid is the reserve flow's own `CalendarPopover`, so the days
 * offered here and the days offered there cannot drift apart.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { formatStayDate } from '@/lib/format';
import { completeChildAges, todayInDubai } from '@/lib/stay-dates';
import type { Locale } from '@/lib/api/types';

import { CalendarPopover } from './CalendarPopover';
import { GuestsPopover } from './GuestsPopover';
import styles from './StaySearch.module.css';

/** Which popover is open: a date, or the guests panel. */
type Mode = 'in' | 'out' | 'guests';

export interface StaySearchProps {
  locale: Locale;
  /**
   * Which ground it is sitting on.
   *
   * `dark` is the bar over a photograph — translucent, light text. `light` is
   * the bar on a linen or near-white panel. They are two sets of colours, not
   * two components: the structure, the hit areas and the markup are identical.
   */
  tone?: 'dark' | 'light';
  className?: string;
}

export function StaySearch({
  locale,
  tone = 'dark',
  className,
}: StaySearchProps) {
  const t = useTranslations('reserve.step1');
  const tSummary = useTranslations('reserve.summary');
  const router = useRouter();

  const today = todayInDubai();

  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [adults, setAdults] = useState(2);
  /** One per child, `null` until its age is picked — as the reserve flow holds them. */
  const [childAges, setChildAges] = useState<Array<number | null>>([]);
  /** Set when a search was refused for a missing age, so the panel marks it. */
  const [showMissing, setShowMissing] = useState(false);
  const [open, setOpen] = useState<Mode | null>(null);

  const containerRef = useRef<HTMLFormElement>(null);
  const checkInRef = useRef<HTMLButtonElement>(null);
  const guestsRef = useRef<HTMLButtonElement>(null);

  // Close on an outside click or Escape — expected of any popover, and Escape
  // is the keyboard user's only way out.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Back to the field that opened it, so a keyboard user is not dropped at
      // the top of the page. The calendars have always left focus where the
      // last day button was, which is inside the form either way.
      if (open === 'guests') guestsRef.current?.focus();
      setOpen(null);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(date: string) {
    if (open === 'in') {
      // A new arrival invalidates a departure on or before it.
      setCheckIn(date);
      if (checkOut && checkOut <= date) setCheckOut(null);
      // Straight on to the departure, as the reserve flow does — it saves a
      // click, and an arrival on its own cannot search.
      setOpen('out');
      return;
    }
    if (checkIn && date <= checkIn) return;
    setCheckOut(date);
    setOpen(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    // Nothing to search yet. Opening the calendar says what is missing far
    // better than an error message under an empty field does.
    if (!checkIn || !checkOut) {
      setOpen('in');
      checkInRef.current?.focus();
      return;
    }

    // A child without an age cannot be searched for: the age decides which
    // rooms fit. Reopen the panel with the gap marked rather than guessing.
    const ages = completeChildAges(childAges);
    if (!ages) {
      setShowMissing(true);
      setOpen('guests');
      return;
    }

    const query = new URLSearchParams({
      checkIn,
      checkOut,
      adults: String(adults),
    });
    // Ages, not a count: the flow must search for the same party the guest
    // described here, and a count alone cannot say who needs a cot.
    if (ages.length > 0) query.set('childAges', ages.join(','));
    router.push(`/reserve?${query.toString()}`);
  }

  return (
    // The shell exists to be a container query context. The bar has to lay
    // itself out by how much room it has been given, not by how wide the window
    // is: the same component sits full-width under a hero and in a half-width
    // editorial panel, and on a 1440px screen the second one is 540px wide. A
    // viewport media query gets that case exactly backwards.
    <div className={[styles.shell, className].filter(Boolean).join(' ')}>
      <form
        ref={containerRef}
        className={[styles.bar, styles[tone]].filter(Boolean).join(' ')}
        onSubmit={submit}
        data-testid="stay-search"
      >
        <div className={styles.field}>
          <span className={styles.label} id="stay-search-checkin-label">
            {t('checkIn')}
          </span>
          <button
            type="button"
            ref={checkInRef}
            className={styles.value}
            onClick={() =>
              setOpen((current) => (current === 'in' ? null : 'in'))
            }
            aria-labelledby="stay-search-checkin-label"
            aria-expanded={open === 'in'}
            aria-haspopup="dialog"
            data-testid="stay-search-checkin"
          >
            <span className={checkIn ? undefined : styles.placeholder}>
              {checkIn ? formatStayDate(checkIn, locale) : t('selectDate')}
            </span>
          </button>

          {open === 'in' && (
            <CalendarPopover
              locale={locale}
              label={t('checkIn')}
              today={today}
              checkIn={checkIn}
              checkOut={checkOut}
              anchor={checkIn ?? today}
              minDate={today}
              onPick={pick}
              className={styles.popover}
            />
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.label} id="stay-search-checkout-label">
            {t('checkOut')}
          </span>
          <button
            type="button"
            className={styles.value}
            onClick={() =>
              setOpen((current) => (current === 'out' ? null : 'out'))
            }
            aria-labelledby="stay-search-checkout-label"
            aria-expanded={open === 'out'}
            aria-haspopup="dialog"
            data-testid="stay-search-checkout"
          >
            <span className={checkOut ? undefined : styles.placeholder}>
              {checkOut ? formatStayDate(checkOut, locale) : t('selectDate')}
            </span>
          </button>

          {open === 'out' && (
            <CalendarPopover
              locale={locale}
              label={t('checkOut')}
              today={today}
              checkIn={checkIn}
              checkOut={checkOut}
              anchor={checkIn ?? today}
              // A departure must be at least the night after the arrival.
              minDate={checkIn ?? today}
              minExclusive={Boolean(checkIn)}
              onPick={pick}
              className={styles.popover}
            />
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.label} id="stay-search-guests-label">
            {t('guests')}
          </span>
          {/* A button opening a panel, not the native select it replaced: a
              select can hold one number, and a family is two numbers and an
              age per child. */}
          <button
            type="button"
            ref={guestsRef}
            className={[styles.value, styles.guestsValue].join(' ')}
            onClick={() =>
              setOpen((current) => (current === 'guests' ? null : 'guests'))
            }
            aria-labelledby="stay-search-guests-label stay-search-guests"
            aria-expanded={open === 'guests'}
            aria-haspopup="dialog"
            id="stay-search-guests"
            data-testid="stay-search-guests"
          >
            {tSummary('guestsValue', { adults, children: childAges.length })}
          </button>

          {open === 'guests' && (
            <GuestsPopover
              locale={locale}
              adults={adults}
              childAges={childAges}
              onChange={(party) => {
                setAdults(party.adults);
                setChildAges(party.childAges);
              }}
              showMissing={showMissing}
              onDone={() => {
                setOpen(null);
                guestsRef.current?.focus();
              }}
              className={styles.guestsPopover}
            />
          )}
        </div>

        <button
          type="submit"
          className={styles.submit}
          data-testid="stay-search-submit"
        >
          {t('checkAvailability')}
        </button>
      </form>
    </div>
  );
}

'use client';

/**
 * The month grid a stay is picked from.
 *
 * Lifted out of the reserve flow's `DatePicker` when the home page gained its
 * own search: a hotel with two different calendars is a hotel where one of them
 * is wrong about the earliest bookable day. The reserve flow and the home
 * search now render this same component, and disagree about nothing.
 *
 * What it keeps from the original, because each was a deliberate fix:
 *
 *   - Month and weekday names come from `Intl` in the active locale, so Arabic
 *     shows real Arabic names rather than transliterated English.
 *   - The grid mirrors under RTL for free, being a CSS grid inside a `dir="rtl"`
 *     document. The navigation chevrons do *not* mirror for free, so they are
 *     chosen per direction rather than flipped with a transform (`arabic-rtl`).
 *   - Every day is a real `<button>`, operable from the keyboard and labelled
 *     with its full date, which the mockup's click-only `<div>`s were not.
 *
 * The month cursor lives here rather than in the caller. The popover is mounted
 * only while open, so opening a field seeds the cursor from `anchor` — which is
 * what both callers previously did by hand on every open.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

import { formatMonthYear, formatStayDate, weekdayNames } from '@/lib/format';
import { isoFromParts } from '@/lib/stay-dates';
import type { Locale } from '@/lib/api/types';

import { choosePlacement, type PlacementResult } from './placement';
import styles from './CalendarPopover.module.css';

export interface CalendarPopoverProps {
  locale: Locale;
  /** Names the dialog for screen readers — "Check in" or "Check out". */
  label: string;
  /** Today in Dubai. Passed in so a caller cannot drift from its own floor. */
  today: string;
  checkIn: string | null;
  checkOut: string | null;
  /** The month to open on — usually the chosen check-in, else today. */
  anchor: string;
  /** Earliest selectable day. */
  minDate: string;
  /** When set, `minDate` itself is not selectable — a departure needs a night. */
  minExclusive?: boolean;
  onPick: (date: string) => void;
  /**
   * Extra class on the popover, for a caller that has to reposition it.
   *
   * The popover hangs from the start edge of its field, which is right until
   * the field is narrower than the calendar — then it hangs off the screen.
   * Only the caller knows how wide its field is, so only the caller can say.
   */
  className?: string;
}

export function CalendarPopover({
  locale,
  label,
  today,
  checkIn,
  checkOut,
  anchor,
  minDate,
  minExclusive = false,
  onPick,
  className,
}: CalendarPopoverProps) {
  const t = useTranslations('reserve.step1');
  const isRtl = locale === 'ar';

  const [cursor, setCursor] = useState(() => {
    const [year, month] = anchor.split('-').map(Number) as [number, number];
    return { year, month: month - 1 };
  });

  const popoverRef = useRef<HTMLDivElement>(null);

  // Downwards until measurement says otherwise — the common case, and the state
  // the markup has always rendered in.
  const [fit, setFit] = useState<PlacementResult>({
    placement: 'below',
    maxHeight: null,
  });

  const measure = useCallback(() => {
    const el = popoverRef.current;
    // `offsetParent` is the field: both callers mark theirs `position: relative`
    // precisely so this popover hangs off it.
    const field = el?.offsetParent;
    if (!el || !(field instanceof HTMLElement)) return;

    const rect = field.getBoundingClientRect();
    setFit(
      choosePlacement({
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        viewportHeight: window.innerHeight,
        // `scrollHeight`, not `offsetHeight`: once a previous measurement has
        // capped the height, `offsetHeight` reports the cap and the calendar
        // could never discover it has room to grow back.
        calendarHeight: el.scrollHeight,
      }),
    );
  }, []);

  // Before paint, not after. `useLayoutEffect` lets the flip happen in the same
  // frame the popover appears in, so the guest never sees it open downwards and
  // then jump. The component mounts only on a click, so this never runs on the
  // server.
  useLayoutEffect(measure, [measure]);

  // A resize changes the room available; so does scrolling, and the reserve
  // page can be scrolled with the picker open. Passive listeners, as in
  // `SiteNav`, because neither handler calls `preventDefault`.
  useEffect(() => {
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [measure]);

  const weekdays = weekdayNames(locale);
  const firstOfMonth = new Date(Date.UTC(cursor.year, cursor.month, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(
    Date.UTC(cursor.year, cursor.month + 1, 0),
  ).getUTCDate();

  // Nothing before this month is bookable, so there is nowhere to go back to.
  const atCurrentMonth =
    isoFromParts(cursor.year, cursor.month, 1).slice(0, 7) ===
    today.slice(0, 7);

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }

  return (
    <div
      ref={popoverRef}
      className={[
        styles.calendar,
        fit.placement === 'above' ? styles.above : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      // Set only when the calendar fits on neither side, so in every normal
      // case the height stays entirely the stylesheet's business.
      style={
        fit.maxHeight === null
          ? undefined
          : ({
              '--calendar-max-height': `${fit.maxHeight}px`,
            } as React.CSSProperties)
      }
      role="dialog"
      aria-label={label}
    >
      <div className={styles.calHead}>
        <button
          type="button"
          className={styles.calNav}
          onClick={() => shiftMonth(-1)}
          disabled={atCurrentMonth}
          aria-label={t('previousMonth')}
        >
          {/* "Previous" points towards the start of the line, which is the
              right-hand side in Arabic. */}
          <Chevron direction={isRtl ? 'right' : 'left'} />
        </button>

        {/* Announced when the month changes, so a screen reader user knows
            which month they are now navigating. */}
        <span className={styles.calMonth} aria-live="polite">
          {formatMonthYear(cursor.year, cursor.month, locale)}
        </span>

        <button
          type="button"
          className={styles.calNav}
          onClick={() => shiftMonth(1)}
          data-testid="next-month"
          aria-label={t('nextMonth')}
        >
          <Chevron direction={isRtl ? 'left' : 'right'} />
        </button>
      </div>

      <div className={styles.calWeekdays} aria-hidden="true">
        {weekdays.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className={styles.calDays} role="grid">
        {Array.from({ length: startWeekday }, (_, index) => (
          <span key={`pad-${index}`} className={styles.calDayEmpty} />
        ))}

        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const date = isoFromParts(cursor.year, cursor.month, day);

          const disabled = minExclusive ? date <= minDate : date < minDate;
          const selected = date === checkIn || date === checkOut;
          const inRange =
            Boolean(checkIn && checkOut) &&
            date > (checkIn as string) &&
            date < (checkOut as string);

          return (
            <button
              key={date}
              type="button"
              className={[
                styles.calDay,
                disabled ? styles.calDayPast : null,
                selected ? styles.calDaySelected : null,
                inRange ? styles.calDayInRange : null,
                date === today && !selected ? styles.calDayToday : null,
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={disabled}
              data-testid={`day-${date}`}
              onClick={() => onPick(date)}
              aria-pressed={selected}
              // The visible label is a bare number; screen readers need the
              // full date to make sense of it.
              aria-label={formatStayDate(date, locale)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A chevron pointing left or right.
 *
 * The direction is chosen by the caller per locale rather than mirrored with a
 * CSS transform on a parent, which is the pattern `arabic-rtl` rules out.
 */
function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={direction === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

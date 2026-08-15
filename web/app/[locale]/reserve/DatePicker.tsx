'use client';

/**
 * Check-in / check-out date picker.
 *
 * Ported from the mockup's calendar, with three things the mockup could not do:
 *
 *   - Month and weekday names come from `Intl` in the active locale, so Arabic
 *     shows real Arabic names rather than transliterated English.
 *   - The grid mirrors under RTL for free, because it is a CSS grid inside a
 *     `dir="rtl"` document. The month-navigation chevrons do *not* mirror for
 *     free, so they are chosen per direction below.
 *   - It is operable from the keyboard and announced to screen readers, which
 *     the mockup's click-only `<div>`s were not (WCAG 2.1 AA).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { formatMonthYear, formatStayDate, weekdayNames } from '@/lib/format';
import type { Locale } from '@/lib/api/types';
import styles from './Reserve.module.css';

interface DatePickerProps {
  locale: Locale;
  checkIn: string | null;
  checkOut: string | null;
  onChange: (dates: { checkIn: string | null; checkOut: string | null }) => void;
}

type Mode = 'in' | 'out';

function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today in Dubai — the hotel's day, not the visitor's. */
function todayInDubai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function DatePicker({
  locale,
  checkIn,
  checkOut,
  onChange,
}: DatePickerProps) {
  const t = useTranslations('reserve.step1');
  const [open, setOpen] = useState<Mode | null>(null);
  const today = todayInDubai();

  const [cursor, setCursor] = useState(() => {
    const start = checkIn ?? today;
    const [year, month] = start.split('-').map(Number) as [number, number];
    return { year, month: month - 1 };
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — expected of any popover, and Escape
  // is the keyboard user's only way out.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle(mode: Mode) {
    setOpen((current) => (current === mode ? null : mode));
    const anchor = mode === 'out' ? (checkIn ?? today) : (checkIn ?? today);
    const [year, month] = anchor.split('-').map(Number) as [number, number];
    setCursor({ year, month: month - 1 });
  }

  function pick(date: string) {
    if (open === 'in') {
      // Choosing a new check-in invalidates an earlier check-out.
      const nextOut = checkOut && checkOut <= date ? null : checkOut;
      onChange({ checkIn: date, checkOut: nextOut });
      // Move straight to picking the departure — the mockup's behaviour, and
      // it saves the guest a click.
      setOpen('out');
      return;
    }
    if (checkIn && date <= checkIn) return;
    onChange({ checkIn, checkOut: date });
    setOpen(null);
  }

  const weekdays = weekdayNames(locale);
  const firstOfMonth = new Date(Date.UTC(cursor.year, cursor.month, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(
    Date.UTC(cursor.year, cursor.month + 1, 0),
  ).getUTCDate();

  const atCurrentMonth =
    isoFromParts(cursor.year, cursor.month, 1).slice(0, 7) === today.slice(0, 7);

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }

  return (
    <div className={styles.dateRow} ref={containerRef}>
      <div className={styles.field}>
        <span className={styles.fieldLabel} id="checkin-label">
          {t('checkIn')}
        </span>
        <button
          type="button"
          className={[styles.fbox, open === 'in' ? styles.fboxActive : null]
            .filter(Boolean)
            .join(' ')}
          onClick={() => toggle('in')}
          aria-labelledby="checkin-label"
          data-testid="checkin-field"
          aria-expanded={open === 'in'}
          aria-haspopup="dialog"
        >
          <span className={checkIn ? undefined : styles.placeholder}>
            {checkIn ? formatStayDate(checkIn, locale) : t('selectDate')}
          </span>
          <CalendarIcon />
        </button>

        {open === 'in' && (
          <CalendarPopover
            locale={locale}
            label={t('checkIn')}
            monthLabel={formatMonthYear(cursor.year, cursor.month, locale)}
            weekdays={weekdays}
            startWeekday={startWeekday}
            daysInMonth={daysInMonth}
            year={cursor.year}
            month={cursor.month}
            today={today}
            checkIn={checkIn}
            checkOut={checkOut}
            minDate={today}
            canGoBack={!atCurrentMonth}
            onShift={shiftMonth}
            onPick={pick}
          />
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel} id="checkout-label">
          {t('checkOut')}
        </span>
        <button
          type="button"
          className={[styles.fbox, open === 'out' ? styles.fboxActive : null]
            .filter(Boolean)
            .join(' ')}
          onClick={() => toggle('out')}
          aria-labelledby="checkout-label"
          data-testid="checkout-field"
          aria-expanded={open === 'out'}
          aria-haspopup="dialog"
        >
          <span className={checkOut ? undefined : styles.placeholder}>
            {checkOut ? formatStayDate(checkOut, locale) : t('selectDate')}
          </span>
          <CalendarIcon />
        </button>

        {open === 'out' && (
          <CalendarPopover
            locale={locale}
            label={t('checkOut')}
            monthLabel={formatMonthYear(cursor.year, cursor.month, locale)}
            weekdays={weekdays}
            startWeekday={startWeekday}
            daysInMonth={daysInMonth}
            year={cursor.year}
            month={cursor.month}
            today={today}
            checkIn={checkIn}
            checkOut={checkOut}
            // Departure must be at least the night after arrival.
            minDate={checkIn ?? today}
            minExclusive={Boolean(checkIn)}
            canGoBack={!atCurrentMonth}
            onShift={shiftMonth}
            onPick={pick}
          />
        )}
      </div>
    </div>
  );
}

interface CalendarPopoverProps {
  locale: Locale;
  label: string;
  monthLabel: string;
  weekdays: string[];
  startWeekday: number;
  daysInMonth: number;
  year: number;
  month: number;
  today: string;
  checkIn: string | null;
  checkOut: string | null;
  minDate: string;
  minExclusive?: boolean;
  canGoBack: boolean;
  onShift: (delta: number) => void;
  onPick: (date: string) => void;
}

function CalendarPopover(props: CalendarPopoverProps) {
  const t = useTranslations('reserve.step1');
  const isRtl = props.locale === 'ar';

  return (
    <div className={styles.calendar} role="dialog" aria-label={props.label}>
      <div className={styles.calHead}>
        <button
          type="button"
          className={styles.calNav}
          onClick={() => props.onShift(-1)}
          disabled={!props.canGoBack}
          aria-label={t('previousMonth')}
        >
          {/* Chevrons are the one thing `dir` does not flip. "Previous" points
              towards the start of the line, which is right in Arabic. */}
          <Chevron direction={isRtl ? 'right' : 'left'} />
        </button>

        {/* Announced when the month changes, so a screen reader user knows
            which month they are now navigating. */}
        <span className={styles.calMonth} aria-live="polite">
          {props.monthLabel}
        </span>

        <button
          type="button"
          className={styles.calNav}
          onClick={() => props.onShift(1)}
          data-testid="next-month"
          aria-label={t('nextMonth')}
        >
          <Chevron direction={isRtl ? 'left' : 'right'} />
        </button>
      </div>

      <div className={styles.calWeekdays} aria-hidden="true">
        {props.weekdays.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className={styles.calDays} role="grid">
        {Array.from({ length: props.startWeekday }, (_, index) => (
          <span key={`pad-${index}`} className={styles.calDayEmpty} />
        ))}

        {Array.from({ length: props.daysInMonth }, (_, index) => {
          const day = index + 1;
          const date = isoFromParts(props.year, props.month, day);

          const disabled = props.minExclusive
            ? date <= props.minDate
            : date < props.minDate;
          const selected = date === props.checkIn || date === props.checkOut;
          const inRange =
            Boolean(props.checkIn && props.checkOut) &&
            date > (props.checkIn as string) &&
            date < (props.checkOut as string);

          return (
            <button
              key={date}
              type="button"
              className={[
                styles.calDay,
                disabled ? styles.calDayPast : null,
                selected ? styles.calDaySelected : null,
                inRange ? styles.calDayInRange : null,
                date === props.today && !selected ? styles.calDayToday : null,
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={disabled}
              data-testid={`day-${date}`}
              onClick={() => props.onPick(date)}
              aria-pressed={selected}
              // The visible label is a bare number; screen readers need the
              // full date to make sense of it.
              aria-label={formatStayDate(date, props.locale)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="3" x2="8" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

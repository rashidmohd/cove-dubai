'use client';

/**
 * Check-in / check-out date picker.
 *
 * The two trigger fields, styled as the mockup's reserve-flow boxes. The month
 * grid itself is `components/booking/CalendarPopover` — shared with the home
 * page search, so both offer the same days from the same floor.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { CalendarPopover } from '@/components/booking/CalendarPopover';
import { formatStayDate } from '@/lib/format';
import { todayInDubai } from '@/lib/stay-dates';
import type { Locale } from '@/lib/api/types';
import styles from './Reserve.module.css';

interface DatePickerProps {
  locale: Locale;
  checkIn: string | null;
  checkOut: string | null;
  onChange: (dates: {
    checkIn: string | null;
    checkOut: string | null;
  }) => void;
}

type Mode = 'in' | 'out';

export function DatePicker({
  locale,
  checkIn,
  checkOut,
  onChange,
}: DatePickerProps) {
  const t = useTranslations('reserve.step1');
  const [open, setOpen] = useState<Mode | null>(null);
  const today = todayInDubai();

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
          onClick={() => setOpen((current) => (current === 'in' ? null : 'in'))}
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
            today={today}
            checkIn={checkIn}
            checkOut={checkOut}
            anchor={checkIn ?? today}
            minDate={today}
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
          onClick={() =>
            setOpen((current) => (current === 'out' ? null : 'out'))
          }
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
            today={today}
            checkIn={checkIn}
            checkOut={checkOut}
            anchor={checkIn ?? today}
            // Departure must be at least the night after arrival.
            minDate={checkIn ?? today}
            minExclusive={Boolean(checkIn)}
            onPick={pick}
          />
        )}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1="3"
        y1="10"
        x2="21"
        y2="10"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1="8"
        y1="3"
        x2="8"
        y2="7"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1="16"
        y1="3"
        x2="16"
        y2="7"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

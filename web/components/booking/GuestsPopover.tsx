'use client';

/**
 * Who is staying — adults, children, and each child's age.
 *
 * The home search bar's guest field opens this. It replaced a native select of
 * adults only, which sent every family to the reserve flow as a party of
 * adults: the flow then searched rooms for the wrong party, and a room that
 * could not take their children looked available until they found the
 * children counter themselves.
 *
 * Ages are asked here, not just a count, because a count is not enough to
 * answer "which rooms fit": a baby sleeps in a cot, a teenager takes a bed and
 * counts as an adult. What each age *means* is the API's to decide
 * (`pms-readiness`); this only collects them.
 *
 * A light surface over the dark hero, like the calendar beside it, for the same
 * reason: dense small text clears AA on `--w`, not on glass over a photograph.
 */
import { useTranslations } from 'next-intl';

import { formatNumber } from '@/lib/format';
import { MAX_ADULTS, MAX_CHILDREN, MAX_CHILD_AGE } from '@/lib/stay-dates';
import type { Locale } from '@/lib/api/types';

import { usePopoverPlacement } from './usePopoverPlacement';
import styles from './GuestsPopover.module.css';

export interface GuestsPopoverProps {
  locale: Locale;
  adults: number;
  /** One per child, `null` until that child's age is picked. */
  childAges: Array<number | null>;
  onChange: (party: { adults: number; childAges: Array<number | null> }) => void;
  /** Set after a search was refused for a missing age, to mark which. */
  showMissing: boolean;
  onDone: () => void;
  className?: string;
}

export function GuestsPopover({
  locale,
  adults,
  childAges,
  onChange,
  showMissing,
  onDone,
  className,
}: GuestsPopoverProps) {
  const t = useTranslations('reserve.step1');
  const tErrors = useTranslations('errors');
  const { ref, fit, measure } = usePopoverPlacement<HTMLDivElement>();

  const missing = showMissing && childAges.some((age) => age === null);

  function setChildCount(count: number) {
    // Adding a child adds an unanswered age; removing one takes the last, so
    // ages already picked stay put.
    onChange({
      adults,
      childAges:
        count > childAges.length
          ? [...childAges, null]
          : childAges.slice(0, count),
    });
    // The panel grows or shrinks with each child, and may now fit on the
    // other side of the field.
    requestAnimationFrame(measure);
  }

  return (
    <div
      ref={ref}
      className={[
        styles.popover,
        fit.placement === 'above' ? styles.above : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        fit.maxHeight === null
          ? undefined
          : ({ '--popover-max-height': `${fit.maxHeight}px` } as React.CSSProperties)
      }
      role="dialog"
      aria-label={t('guests')}
      data-testid="stay-search-guests-panel"
    >
      <Row
        id="search-adults"
        label={t('adults')}
        hint={t('adultsHint')}
        value={adults}
        min={1}
        max={MAX_ADULTS}
        locale={locale}
        testId="stay-search-adults"
        onChange={(value) => onChange({ adults: value, childAges })}
      />
      <Row
        id="search-children"
        label={t('children')}
        hint={t('childrenHint', { max: MAX_CHILD_AGE })}
        value={childAges.length}
        min={0}
        max={MAX_CHILDREN}
        locale={locale}
        testId="stay-search-children"
        onChange={setChildCount}
      />

      {childAges.length > 0 ? (
        <fieldset className={styles.ages}>
          <legend className={styles.legend}>{t('childAgesLegend')}</legend>
          <div className={styles.ageGrid}>
            {childAges.map((age, index) => {
              const id = `stay-search-child-age-${index}`;
              return (
                <div className={styles.ageField} key={index}>
                  <label className={styles.ageLabel} htmlFor={id}>
                    {t('childAge', { number: index + 1 })}
                  </label>
                  <select
                    id={id}
                    className={styles.select}
                    value={age ?? ''}
                    aria-invalid={(missing && age === null) || undefined}
                    data-testid={id}
                    onChange={(event) => {
                      const next = [...childAges];
                      next[index] =
                        event.target.value === ''
                          ? null
                          : Number(event.target.value);
                      onChange({ adults, childAges: next });
                    }}
                  >
                    {/* The short prompt: two selects share a 300px panel, and the
                        flow's "Age at check-in" is cut off at that width. The
                        note below says the age is at check-in. */}
                    <option value="">{t('ageChooseShort')}</option>
                    {Array.from({ length: MAX_CHILD_AGE + 1 }, (_, value) => (
                      <option key={value} value={value}>
                        {value === 0
                          ? t('ageUnderOne')
                          : t('ageYears', { age: value })}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {missing ? (
            <p className={styles.error} role="alert">
              {tErrors('childAgesRequired')}
            </p>
          ) : (
            <p className={styles.note}>{t('childAgesNote')}</p>
          )}
        </fieldset>
      ) : null}

      <button
        type="button"
        className={styles.done}
        onClick={onDone}
        data-testid="stay-search-guests-done"
      >
        {t('guestsDone')}
      </button>
    </div>
  );
}

/** One label-and-counter line. Buttons name what they change for a screen reader. */
function Row({
  id,
  label,
  hint,
  value,
  min,
  max,
  locale,
  testId,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  locale: Locale;
  testId: string;
  onChange: (value: number) => void;
}) {
  const t = useTranslations('reserve.step1');
  return (
    <div className={styles.row}>
      <div>
        <span className={styles.rowLabel} id={`${id}-label`}>
          {label}
        </span>
        <span className={styles.rowHint} id={`${id}-hint`}>
          {hint}
        </span>
      </div>
      <div
        className={styles.counter}
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      >
        <button
          type="button"
          className={styles.counterBtn}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={t('decrease', { label })}
          data-testid={`${testId}-decrease`}
        >
          −
        </button>
        <span
          className={styles.counterValue}
          aria-live="polite"
          data-testid={`${testId}-count`}
        >
          {formatNumber(value, locale)}
        </span>
        <button
          type="button"
          className={styles.counterBtn}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={t('increase', { label })}
          data-testid={`${testId}-increase`}
        >
          +
        </button>
      </div>
    </div>
  );
}

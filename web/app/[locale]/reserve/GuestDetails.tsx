'use client';

/**
 * Step 3 — guest details.
 *
 * No payment step, deliberately. The launch model is pay-at-check-in, so the
 * booking completes without taking money and there is no card capture anywhere
 * in this flow (`booking-engine`).
 *
 * Validation here exists for the guest's benefit only. The API validates
 * everything again server-side and is the authority — nothing in this file is
 * trusted by the booking layer.
 */
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import type { GuestForm } from './useBookingState';
import styles from './Reserve.module.css';

interface GuestDetailsProps {
  guest: GuestForm;
  specialRequests: string;
  submitting: boolean;
  onChangeGuest: (patch: Partial<GuestForm>) => void;
  onChangeRequests: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

type FieldErrors = Partial<Record<keyof GuestForm, string>>;

export function GuestDetails({
  guest,
  specialRequests,
  submitting,
  onChangeGuest,
  onChangeRequests,
  onBack,
  onSubmit,
}: GuestDetailsProps) {
  const t = useTranslations('reserve.step3');
  const tReserve = useTranslations('reserve');
  const tErrors = useTranslations('errors');
  const [errors, setErrors] = useState<FieldErrors>({});

  function validate(): boolean {
    const next: FieldErrors = {};

    if (!guest.firstName.trim()) next.firstName = tErrors('required');
    if (!guest.lastName.trim()) next.lastName = tErrors('required');

    if (!guest.email.trim()) {
      next.email = tErrors('required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())) {
      next.email = tErrors('invalidEmail');
    }

    if (!guest.phone.trim()) {
      next.phone = tErrors('required');
    } else if (!/^[+()\d\s-]{6,30}$/.test(guest.phone.trim())) {
      // Deliberately permissive: guests come from everywhere, and an
      // over-strict pattern rejects legitimate international numbers.
      next.phone = tErrors('invalidPhone');
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (validate()) onSubmit();
  }

  return (
    // A real <form>, so Enter submits and browsers offer autofill — both of
    // which the mockup's div-and-button markup loses.
    <form onSubmit={handleSubmit} noValidate>
      <div className={styles.formRow}>
        <Field
          id="firstName"
          label={t('firstName')}
          value={guest.firstName}
          error={errors.firstName}
          autoComplete="given-name"
          onChange={(value) => onChangeGuest({ firstName: value })}
        />
        <Field
          id="lastName"
          label={t('lastName')}
          value={guest.lastName}
          error={errors.lastName}
          autoComplete="family-name"
          onChange={(value) => onChangeGuest({ lastName: value })}
        />
      </div>

      <div className={styles.formRow}>
        <Field
          id="email"
          label={t('email')}
          type="email"
          value={guest.email}
          error={errors.email}
          autoComplete="email"
          // An email address is always LTR, even on an Arabic page.
          dir="ltr"
          onChange={(value) => onChangeGuest({ email: value })}
        />
        <Field
          id="phone"
          label={t('phone')}
          type="tel"
          value={guest.phone}
          error={errors.phone}
          autoComplete="tel"
          dir="ltr"
          onChange={(value) => onChangeGuest({ phone: value })}
        />
      </div>

      <div className={`${styles.formRow} ${styles.formRowFull}`}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="specialRequests">
            {t('specialRequests')}
          </label>
          <textarea
            id="specialRequests"
            className={styles.textarea}
            value={specialRequests}
            maxLength={2000}
            onChange={(event) => onChangeRequests(event.target.value)}
            aria-describedby="specialRequests-hint"
          />
          <p className={styles.hint} id="specialRequests-hint">
            {t('specialRequestsHint')}
          </p>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btnBack} onClick={onBack}>
          {tReserve('back')}
        </button>
        <button
          type="submit"
          className={styles.btnPrimary}
          disabled={submitting}
          data-testid="confirm-reservation"
        >
          {submitting ? t('submitting') : t('confirm')}
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  error?: string | undefined;
  type?: string;
  autoComplete?: string;
  dir?: 'ltr' | 'rtl';
  onChange: (value: string) => void;
}

function Field({
  id,
  label,
  value,
  error,
  type = 'text',
  autoComplete,
  dir,
  onChange,
}: FieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={[styles.input, error ? styles.inputInvalid : null]
          .filter(Boolean)
          .join(' ')}
        value={value}
        data-testid={`guest-${id}`}
        onChange={(event) => onChange(event.target.value)}
        {...(autoComplete ? { autoComplete } : {})}
        {...(dir ? { dir } : {})}
        // Announces the field as invalid and points at the message, rather
        // than relying on the red border alone — colour is not an accessible
        // signal on its own.
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p className={styles.fieldError} id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

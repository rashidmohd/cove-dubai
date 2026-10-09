'use client';

/**
 * The few pieces every account page shares: the card it sits in, a labelled
 * text field, and turning an API error into the guest's language.
 */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { ApiError } from '@/lib/api/client';
import styles from './Account.module.css';

export function AccountCard({
  title,
  wide,
  children,
}: {
  title: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.wrap}>
      <div className={wide ? `${styles.card} ${styles.cardWide}` : styles.card}>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </div>
    </section>
  );
}

/**
 * A labelled input. The hint is a sibling wired by `aria-describedby`, not
 * part of the label, so it is read as a description rather than as the name.
 */
export function TextField({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = useId();
  return (
    <div className={styles.field}>
      <label className={styles.field}>
        <span className={styles.label}>{label}</span>
        <input
          className={styles.input}
          {...(hint ? { 'aria-describedby': hintId } : {})}
          {...input}
        />
      </label>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p className={styles.error} role="alert">
      {message}
    </p>
  ) : null;
}

/** An API failure, in the guest's language. Never the server's English prose. */
export function useAccountErrorMessage() {
  const t = useTranslations('account.errors');
  const tErrors = useTranslations('errors');

  return (caught: unknown): string => {
    if (!(caught instanceof ApiError)) return tErrors('unknown');
    switch (caught.code) {
      case 'NETWORK_ERROR':
        return tErrors('network');
      case 'RATE_LIMITED':
        return tErrors('rateLimited');
      case 'INVALID_CREDENTIALS':
        return t('invalidCredentials');
      case 'INVALID_TOKEN':
        return t('invalidToken');
      case 'UNAUTHENTICATED':
        return t('signedOut');
      case 'CSRF_TOKEN_INVALID':
        return t('signedOut');
      case 'VALIDATION_FAILED':
        return t('checkFields');
      default:
        return tErrors('unknown');
    }
  };
}

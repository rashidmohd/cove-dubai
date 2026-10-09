'use client';

/**
 * Create an account.
 *
 * After submitting, the page always says "check your inbox" — the API answers
 * the same way whether or not the address already has an account, so the form
 * cannot be used to find out who has stayed here. The email that arrives is
 * what differs: a confirmation link, or a note that an account exists.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { accountApi } from '@/lib/api/account-client';
import type { Locale } from '@/lib/api/types';
import { AccountCard, ErrorMessage, TextField, useAccountErrorMessage } from '../pieces';
import styles from '../Account.module.css';

const MIN_PASSWORD = 10;

export function RegisterForm({ locale }: { locale: Locale }) {
  const t = useTranslations('account');
  const describe = useAccountErrorMessage();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        locale,
      });
      setSentTo(email.trim());
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AccountCard title={t('register.sentTitle')}>
        <p className={styles.notice} role="status">
          {t('register.sent', { email: sentTo })}
        </p>
        <p className={styles.body}>{t('register.sentBody')}</p>
        <Link className={styles.link} href="/account">
          {t('register.toSignIn')}
        </Link>
      </AccountCard>
    );
  }

  return (
    <AccountCard title={t('register.title')}>
      <p className={styles.body}>{t('register.intro')}</p>
      <ErrorMessage message={error} />

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.pair}>
          <TextField
            label={t('fields.firstName')}
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            maxLength={80}
            required
          />
          <TextField
            label={t('fields.lastName')}
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            maxLength={80}
            required
          />
        </div>
        <TextField
          label={t('fields.email')}
          hint={t('register.emailHint')}
          type="email"
          autoComplete="email"
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={160}
          required
        />
        <TextField
          label={t('fields.newPassword')}
          hint={t('fields.passwordHint', { count: MIN_PASSWORD })}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={MIN_PASSWORD}
          maxLength={200}
          required
        />
        <div className={styles.actions}>
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? t('register.busy') : t('register.submit')}
          </button>
        </div>
      </form>

      <p className={styles.footnote}>
        {t('register.haveAccount')}{' '}
        <Link className={styles.link} href="/account">
          {t('register.toSignIn')}
        </Link>
      </p>
    </AccountCard>
  );
}

'use client';

/**
 * Password reset, both halves on one page.
 *
 * Without a `token` in the URL, it asks for an email address and sends a link.
 * The answer is the same whether or not the address has an account. With a
 * token — arriving from that email — it sets a new password, which also signs
 * the account out everywhere else.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { Link } from '@/i18n/navigation';
import { accountApi } from '@/lib/api/account-client';
import type { Locale } from '@/lib/api/types';
import { AccountCard, ErrorMessage, TextField, useAccountErrorMessage } from '../pieces';
import styles from '../Account.module.css';

const MIN_PASSWORD = 10;

export function ResetPassword({ locale }: { locale: Locale }) {
  const token = useSearchParams().get('token');
  return token ? <SetPassword token={token} /> : <RequestLink locale={locale} />;
}

function RequestLink({ locale }: { locale: Locale }) {
  const t = useTranslations('account');
  const describe = useAccountErrorMessage();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.requestPasswordReset(email.trim(), locale);
      setSentTo(email.trim());
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountCard title={t('reset.requestTitle')}>
      <ErrorMessage message={error} />
      {sentTo ? (
        <>
          <p className={styles.notice} role="status">
            {t('reset.sent', { email: sentTo })}
          </p>
          <Link className={styles.link} href="/account">
            {t('reset.toSignIn')}
          </Link>
        </>
      ) : (
        <>
          <p className={styles.body}>{t('reset.requestIntro')}</p>
          <form className={styles.form} onSubmit={submit}>
            <TextField
              label={t('fields.email')}
              type="email"
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={160}
              required
            />
            <div className={styles.actions}>
              <button className={styles.primary} type="submit" disabled={busy}>
                {t('reset.requestSubmit')}
              </button>
              <Link className={styles.link} href="/account">
                {t('reset.toSignIn')}
              </Link>
            </div>
          </form>
        </>
      )}
    </AccountCard>
  );
}

function SetPassword({ token }: { token: string }) {
  const t = useTranslations('account');
  const describe = useAccountErrorMessage();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError(t('errors.passwordsDiffer'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await accountApi.resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountCard title={t('reset.setTitle')}>
      <ErrorMessage message={error} />
      {done ? (
        <>
          <p className={styles.notice} role="status">
            {t('reset.done')}
          </p>
          <Link className={styles.link} href="/account">
            {t('reset.toSignIn')}
          </Link>
        </>
      ) : (
        <form className={styles.form} onSubmit={submit}>
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
          <TextField
            label={t('fields.confirmPassword')}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            minLength={MIN_PASSWORD}
            maxLength={200}
            required
          />
          <div className={styles.actions}>
            <button className={styles.primary} type="submit" disabled={busy}>
              {t('reset.setSubmit')}
            </button>
          </div>
        </form>
      )}
    </AccountCard>
  );
}

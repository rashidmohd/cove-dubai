'use client';

/**
 * Confirm an email address, from the link in the verification email.
 *
 * Asks for a click rather than confirming on load, like the cancellation page:
 * mail clients and security scanners fetch links in the background, and the
 * link is single-use.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { Link } from '@/i18n/navigation';
import { accountApi } from '@/lib/api/account-client';
import { AccountCard, ErrorMessage, useAccountErrorMessage } from '../pieces';
import styles from '../Account.module.css';

export function VerifyEmail() {
  const t = useTranslations('account');
  const describe = useAccountErrorMessage();
  const token = useSearchParams().get('token');

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : t('errors.invalidToken'),
  );

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await accountApi.verify(token);
      setDone(true);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountCard title={t('verify.title')}>
      <ErrorMessage message={error} />

      {done ? (
        <>
          <p className={styles.notice} role="status">
            {t('verify.done')}
          </p>
          <Link className={styles.link} href="/account">
            {t('verify.toAccount')}
          </Link>
        </>
      ) : token ? (
        <>
          <p className={styles.body}>{t('verify.body')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void confirm()}
              disabled={busy}
            >
              {t('verify.submit')}
            </button>
          </div>
        </>
      ) : (
        <Link className={styles.link} href="/account">
          {t('verify.toAccount')}
        </Link>
      )}
    </AccountCard>
  );
}

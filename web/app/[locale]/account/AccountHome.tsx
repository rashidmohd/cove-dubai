'use client';

/**
 * /account — sign in, or, once signed in, "my bookings".
 *
 * Bookings appear only for a confirmed address. They are matched to the
 * account by email, so until the guest has proved the inbox is theirs, the
 * page offers to send the confirmation again instead.
 *
 * Nothing here cancels or changes a booking. That still goes through the link
 * in the confirmation email, which carries the single-use cancellation token;
 * the page says so rather than offering a button that would bypass it.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { accountApi, type GuestAccount } from '@/lib/api/account-client';
import { ApiError } from '@/lib/api/client';
import type { Locale, Reservation } from '@/lib/api/types';
import { formatMoney, formatStayDate } from '@/lib/format';
import { AccountCard, ErrorMessage, TextField, useAccountErrorMessage } from './pieces';
import styles from './Account.module.css';

type State =
  | { phase: 'loading' }
  | { phase: 'signedOut' }
  | { phase: 'signedIn'; account: GuestAccount };

export function AccountHome({ locale }: { locale: Locale }) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    accountApi
      .getSession()
      .then((account) => {
        if (live) setState({ phase: 'signedIn', account });
      })
      .catch(() => {
        // A 401 is the ordinary signed-out state; anything else still leaves
        // the guest able to sign in, which is the useful thing to show.
        if (live) setState({ phase: 'signedOut' });
      });
    return () => {
      live = false;
    };
  }, []);

  if (state.phase === 'loading') {
    return (
      <AccountCard title={t('title')}>
        <p className={styles.status} role="status">
          {tCommon('loading')}
        </p>
      </AccountCard>
    );
  }

  if (state.phase === 'signedOut') {
    return (
      <SignIn onSignedIn={(account) => setState({ phase: 'signedIn', account })} />
    );
  }

  return (
    <MyBookings
      account={state.account}
      locale={locale}
      onSignedOut={() => setState({ phase: 'signedOut' })}
    />
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (account: GuestAccount) => void }) {
  const t = useTranslations('account');
  const describe = useAccountErrorMessage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await accountApi.login(email.trim(), password));
    } catch (caught) {
      setError(describe(caught));
      setBusy(false);
    }
  }

  return (
    <AccountCard title={t('signIn.title')}>
      <p className={styles.body}>{t('signIn.intro')}</p>
      <ErrorMessage message={error} />

      <form className={styles.form} onSubmit={submit}>
        <TextField
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <TextField
          label={t('fields.password')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <div className={styles.actions}>
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? t('signIn.busy') : t('signIn.submit')}
          </button>
          <Link className={styles.link} href="/account/reset">
            {t('signIn.forgot')}
          </Link>
        </div>
      </form>

      <p className={styles.footnote}>
        {t('signIn.noAccount')}{' '}
        <Link className={styles.link} href="/account/register">
          {t('signIn.register')}
        </Link>
      </p>
    </AccountCard>
  );
}

function MyBookings({
  account,
  locale,
  onSignedOut,
}: {
  account: GuestAccount;
  locale: Locale;
  onSignedOut: () => void;
}) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const describe = useAccountErrorMessage();

  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account.emailVerified) return;
    let live = true;
    accountApi
      .listReservations()
      .then((next) => {
        if (live) setReservations(next);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        if (caught instanceof ApiError && caught.status === 401) onSignedOut();
        else setError(describe(caught));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.emailVerified]);

  async function signOut() {
    setBusy(true);
    await accountApi.logout().catch(() => undefined);
    onSignedOut();
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await accountApi.resendVerification();
      setResent(true);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountCard
      wide
      title={t('bookings.greeting', { name: account.firstName })}
    >
      <ErrorMessage message={error} />

      {!account.emailVerified ? (
        <>
          <p className={styles.notice}>
            {t('bookings.unverified', { email: account.email })}
          </p>
          {resent ? (
            <p className={styles.body} role="status">
              {t('bookings.resent')}
            </p>
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void resend()}
                disabled={busy}
              >
                {t('bookings.resend')}
              </button>
            </div>
          )}
        </>
      ) : null}

      {account.emailVerified && !reservations && !error ? (
        <p className={styles.status} role="status">
          {tCommon('loading')}
        </p>
      ) : null}

      {reservations && reservations.length === 0 ? (
        <p className={styles.body}>{t('bookings.none')}</p>
      ) : null}

      {reservations && reservations.length > 0 ? (
        <>
          <p className={styles.body}>{t('bookings.intro')}</p>
          <ul className={styles.bookings}>
            {reservations.map((reservation) => (
              <BookingCard
                key={reservation.reference}
                reservation={reservation}
                locale={locale}
              />
            ))}
          </ul>
          <p className={styles.hint}>{t('bookings.howToCancel')}</p>
        </>
      ) : null}

      <div className={`${styles.actions} ${styles.footnote}`}>
        <Link className={styles.link} href="/reserve">
          {t('bookings.bookAnother')}
        </Link>
        <button
          type="button"
          className={styles.link}
          onClick={() => void signOut()}
          disabled={busy}
        >
          {t('bookings.signOut')}
        </button>
      </div>
    </AccountCard>
  );
}

function BookingCard({
  reservation,
  locale,
}: {
  reservation: Reservation;
  locale: Locale;
}) {
  const t = useTranslations('account.bookings');
  const quiet =
    reservation.status === 'cancelled' || reservation.status === 'checked-out';

  return (
    <li className={styles.booking}>
      <div className={styles.bookingTop}>
        <bdi className={styles.room}>{reservation.roomType.name[locale]}</bdi>
        <span className={quiet ? `${styles.badge} ${styles.badgeMuted}` : styles.badge}>
          {t(`status.${reservation.status}`)}
        </span>
      </div>
      <dl className={styles.facts}>
        <Fact label={t('reference')} value={<bdi>{reservation.reference}</bdi>} />
        <Fact
          label={t('stay')}
          value={
            <bdi>
              {formatStayDate(reservation.stay.checkIn, locale)} –{' '}
              {formatStayDate(reservation.stay.checkOut, locale)}
            </bdi>
          }
        />
        <Fact
          label={t('guests')}
          value={t('party', {
            adults: reservation.stay.adults,
            children: reservation.stay.children,
          })}
        />
        <Fact
          label={t('total')}
          value={
            <bdi>
              {formatMoney(
                reservation.price.grandTotal,
                reservation.price.currency,
                locale,
              )}
            </bdi>
          }
        />
      </dl>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}

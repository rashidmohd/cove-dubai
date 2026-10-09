'use client';

/**
 * The spa and table request form.
 *
 * A request, not a booking: nothing is held, and the page says so before and
 * after sending. The team answers by email. The API checks every choice again
 * — the menu's times, the slot not having passed in Dubai, the party size —
 * and is the authority; this form only keeps the guest from asking for
 * something the menu does not offer.
 *
 * A signed-in member has their name, email and phone filled in, as on the room
 * booking form. Only empty fields are filled.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { accountApi } from '@/lib/api/account-client';
import { ApiError, bookingApi } from '@/lib/api/client';
import type { Locale, ServiceKind, ServiceOffering, ServiceRequest } from '@/lib/api/types';
import { formatStayDate, formatTimeOfDay } from '@/lib/format';
import { addDays, timeInDubai, todayInDubai } from '@/lib/stay-dates';
import styles from './ServiceRequest.module.css';

interface Contact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

const EMPTY_CONTACT: Contact = { firstName: '', lastName: '', email: '', phone: '' };

export function ServiceRequestForm({
  kind,
  offerings,
  locale,
}: {
  kind: ServiceKind;
  offerings: ServiceOffering[];
  locale: Locale;
}) {
  const t = useTranslations('requests');
  const tErrors = useTranslations('errors');
  const params = useSearchParams();

  // `?item=` preselects from a "Request" link on the menu above the form.
  const [offeringCode, setOfferingCode] = useState(() => {
    const wanted = params.get('item');
    return offerings.some((o) => o.code === wanted) ? (wanted as string) : (offerings[0]?.code ?? '');
  });
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState(kind === 'dining' ? 2 : 1);
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const [notes, setNotes] = useState('');
  const [memberEmail, setMemberEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ServiceRequest | null>(null);

  const offering = offerings.find((o) => o.code === offeringCode) ?? null;
  const today = todayInDubai();

  // Today's slots that have already gone by are not offered — the API would
  // refuse them, and a guest should not discover that on sending.
  const slots = useMemo(() => {
    if (!offering) return [];
    if (date !== today) return offering.slots;
    const now = timeInDubai();
    return offering.slots.filter((slot) => slot > now);
  }, [offering, date, today]);

  // Keep the choices valid as the others change: a time the new date or
  // treatment does not offer, or a party larger than it takes, is cleared.
  const timeStillOffered = time === '' || slots.includes(time);
  const effectiveTime = timeStillOffered ? time : '';
  const maxGuests = offering?.maxGuests ?? 1;
  const effectiveGuests = Math.min(guests, maxGuests);

  // A signed-in member does not type their details again.
  useEffect(() => {
    let live = true;
    const fill = (details: Partial<Contact>) =>
      setContact((current) => {
        const next = { ...current };
        for (const key of Object.keys(details) as (keyof Contact)[]) {
          const value = details[key]?.trim();
          if (value && !next[key].trim()) next[key] = value;
        }
        return next;
      });

    accountApi
      .getSession()
      .then(async (account) => {
        if (!live) return;
        fill({ firstName: account.firstName, lastName: account.lastName, email: account.email });
        setMemberEmail(account.email);
        if (!account.emailVerified) return;
        const [latest] = await accountApi.listReservations();
        if (live && latest?.guest.phone) fill({ phone: latest.guest.phone });
      })
      .catch(() => {
        // Signed out: the ordinary case.
      });
    return () => {
      live = false;
    };
  }, []);

  function describe(caught: unknown): string {
    if (!(caught instanceof ApiError)) return tErrors('unknown');
    switch (caught.code) {
      case 'NETWORK_ERROR':
        return tErrors('network');
      case 'RATE_LIMITED':
        return tErrors('rateLimited');
      case 'OFFERING_NOT_FOUND':
        return t('errors.notOnMenu');
      case 'INVALID_SERVICE_REQUEST':
        return t('errors.choiceUnavailable');
      case 'VALIDATION_FAILED':
        return t('errors.checkFields');
      default:
        return tErrors('unknown');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!offering || !date || !effectiveTime) {
      setError(t('errors.chooseAll'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const request = await bookingApi.createServiceRequest(kind, {
        offeringCode: offering.code,
        preferredDate: date,
        preferredTime: effectiveTime,
        guests: effectiveGuests,
        firstName: contact.firstName.trim(),
        lastName: contact.lastName.trim(),
        email: contact.email.trim(),
        phone: contact.phone.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        locale,
      });
      setSent(request);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.formCard} role="status">
        <h2 className={styles.formTitle}>{t('sent.title')}</h2>
        <p className={styles.reference}>
          <span className={styles.label}>{t('sent.reference')}</span>
          <bdi>{sent.reference}</bdi>
        </p>
        <p className={styles.body}>
          {t('sent.summary', {
            item: sent.offering.name[locale],
            date: formatStayDate(sent.preferredDate, locale),
            time: formatTimeOfDay(sent.preferredTime, locale),
            guests: sent.guests,
          })}
        </p>
        <p className={styles.notice}>{t('sent.body', { email: sent.guest.email })}</p>
      </div>
    );
  }

  if (offerings.length === 0) {
    return (
      <div className={styles.formCard}>
        <p className={styles.body}>{t(`${kind}.unavailable`)}</p>
      </div>
    );
  }

  const field = (key: keyof Contact) => ({
    value: contact[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setContact((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <form className={styles.formCard} onSubmit={submit}>
      <h2 className={styles.formTitle}>{t(`${kind}.formTitle`)}</h2>
      <p className={styles.body}>{t('notABooking')}</p>

      {memberEmail ? <p className={styles.notice}>{t('filledFromAccount')}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <label className={styles.field}>
        <span className={styles.label}>{t(`${kind}.itemLabel`)}</span>
        <select
          className={styles.input}
          value={offeringCode}
          onChange={(event) => setOfferingCode(event.target.value)}
          required
        >
          {offerings.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name[locale]}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>{t('date')}</span>
          <input
            className={styles.input}
            type="date"
            value={date}
            min={today}
            max={addDays(today, 365)}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t('time')}</span>
          <select
            className={styles.input}
            value={effectiveTime}
            onChange={(event) => setTime(event.target.value)}
            disabled={!date}
            required
          >
            <option value="" disabled>
              {date ? t('chooseTime') : t('chooseDateFirst')}
            </option>
            {slots.map((slot) => (
              <option key={slot} value={slot}>
                {formatTimeOfDay(slot, locale)}
              </option>
            ))}
          </select>
          {date && slots.length === 0 ? (
            <span className={styles.hint}>{t('noTimesLeft')}</span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t('guests')}</span>
          <select
            className={styles.input}
            value={effectiveGuests}
            onChange={(event) => setGuests(Number(event.target.value))}
          >
            {Array.from({ length: maxGuests }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>{t('firstName')}</span>
          <input className={styles.input} autoComplete="given-name" maxLength={80} required {...field('firstName')} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('lastName')}</span>
          <input className={styles.input} autoComplete="family-name" maxLength={80} required {...field('lastName')} />
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>{t('email')}</span>
          <input className={styles.input} type="email" autoComplete="email" dir="ltr" maxLength={160} required {...field('email')} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('phone')}</span>
          <input className={styles.input} type="tel" autoComplete="tel" dir="ltr" maxLength={30} required {...field('phone')} />
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>{t(`${kind}.notesLabel`)}</span>
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={1000}
          rows={3}
        />
      </label>

      <button className={styles.submit} type="submit" disabled={busy}>
        {busy ? t('sending') : t(`${kind}.submit`)}
      </button>
      <p className={styles.hint}>{t('payAtHotel')}</p>
    </form>
  );
}

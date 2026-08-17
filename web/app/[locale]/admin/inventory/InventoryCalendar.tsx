'use client';

/**
 * The availability calendar.
 *
 * Shows a month of inventory for one room type and edits it across a date
 * range. Ranged edits rather than per-day ones because that is how the work
 * arrives — "close this type for the refurbishment fortnight" is one decision,
 * and splitting it into fourteen requests would put fourteen rows in the audit
 * log for it.
 *
 * The screen never computes availability itself. `bookedRooms` and the refusal
 * to cut inventory below it both come from the API, where the booking rules
 * live (`booking-engine`).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  adminApi,
  type AdminRoomType,
  type InventoryCalendar,
} from '@/lib/api/admin-client';
import type { Locale } from '@/lib/api/types';
import { formatNumber, formatStayDate, weekdayNames } from '@/lib/format';
import { AdminShell } from '../AdminShell';
import { useAdminSession } from '../AdminSession';
import { NextIcon, PreviousIcon } from '../icons';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  cx,
  Empty,
  ErrorNote,
  Field,
  Input,
  Loading,
  Num,
  SavedNote,
  Select,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

/** `YYYY-MM-DD` for a date, in UTC — the calendar is days, not instants. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

export function InventoryCalendarScreen({ locale }: { locale: Locale }) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();
  const { admin } = useAdminSession();

  const canEdit = admin.role === 'ADMIN';

  const [roomTypes, setRoomTypes] = useState<AdminRoomType[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [calendar, setCalendar] = useState<InventoryCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .listRoomTypes()
      .then((types) => {
        setRoomTypes(types);
        setSelected((current) => current || (types[0]?.code ?? ''));
      })
      .catch((caught: unknown) => setError(describeError(caught)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!selected) return;

    setLoading(true);
    setError(null);

    try {
      setCalendar(
        await adminApi.getInventory({
          roomTypeCode: selected,
          from: isoDate(startOfMonth(month)),
          to: isoDate(endOfMonth(month)),
        }),
      );
    } catch (caught) {
      setError(describeError(caught));
      setCalendar(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthLabel = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-AE' : 'en-AE',
    { month: 'long', year: 'numeric', timeZone: 'UTC', numberingSystem: 'latn' },
  ).format(month);

  return (
    <AdminShell
      title={t('nav.inventory')}
      meta={monthLabel}
      actions={
        <>
          <Button
            size="icon"
            aria-label={t('inventory.previousMonth')}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <PreviousIcon
              className={cx(styles.icon, styles.iconDirectional)}
            />
          </Button>
          <Button
            size="icon"
            aria-label={t('inventory.nextMonth')}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <NextIcon className={cx(styles.icon, styles.iconDirectional)} />
          </Button>
        </>
      }
    >
      <Card>
        <CardBody>
          <div className={styles.toolbar}>
            <Field
              label={t('inventory.roomType')}
              className={styles.toolbarField}
            >
              <Select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {roomTypes.map((roomType) => (
                  <option key={roomType.code} value={roomType.code}>
                    {roomType.name[locale]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <ErrorNote message={error} />
      <SavedNote message={notice} />

      {canEdit && selected ? (
        <RangeEditor
          roomTypeCode={selected}
          month={month}
          onDone={async (message) => {
            setNotice(message);
            await load();
          }}
          onError={(message) => {
            setNotice(null);
            setError(message);
          }}
        />
      ) : null}

      {loading ? <Loading /> : null}

      {!loading && calendar && calendar.days.length === 0 ? (
        <Empty message={t('inventory.notOpen')} />
      ) : null}

      {!loading && calendar && calendar.days.length > 0 ? (
        <MonthGrid calendar={calendar} locale={locale} />
      ) : null}
    </AdminShell>
  );
}

function MonthGrid({
  calendar,
  locale,
}: {
  calendar: InventoryCalendar;
  locale: Locale;
}) {
  const t = useTranslations('admin');
  const days = weekdayNames(locale);

  /**
   * Blank cells so the first day rendered lands under its own weekday.
   *
   * Taken from the first day the API actually returned, not from the 1st of
   * the month: inventory rows only exist where the hotel's calendar has been
   * opened, so a month can legitimately begin part-way through. Padding from
   * the 1st would put every day in the wrong column whenever those two differ.
   */
  const firstDate = calendar.days[0]?.date;
  const leading = firstDate
    ? new Date(`${firstDate}T00:00:00Z`).getUTCDay()
    : 0;

  return (
    <Card>
      <CardBody>
        <div className={styles.calendarHead} aria-hidden="true">
          {days.map((day) => (
            <p key={day} className={styles.calendarWeekday}>
              {day}
            </p>
          ))}
        </div>

        <div className={styles.calendar}>
          {Array.from({ length: leading }, (_, index) => (
            <div key={`pad-${index}`} />
          ))}

          {calendar.days.map((day) => {
            const remaining = day.totalRooms - day.bookedRooms;
            const full = remaining <= 0;

            return (
              <div
                key={day.date}
                className={cx(
                  styles.calendarDay,
                  day.isClosed && styles.calendarDayClosed,
                  !day.isClosed && full && styles.calendarDayFull,
                )}
              >
                <p className={styles.calendarDate}>
                  <Num>{formatStayDate(day.date, locale)}</Num>
                </p>
                <p className={styles.calendarCount}>
                  <Num>{formatNumber(Math.max(0, remaining), locale)}</Num>
                </p>
                <p className={styles.calendarNote}>
                  {day.isClosed
                    ? t('inventory.closed')
                    : t('inventory.ofTotal', {
                        total: formatNumber(day.totalRooms, locale),
                      })}
                </p>
              </div>
            );
          })}
        </div>

        {/*
          The tints are reinforcement, and this states what they mean. Every
          cell already says "closed" or "of 24" in words, so nothing here
          depends on telling the two shades apart.
        */}
        <div className={styles.calendarLegend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} aria-hidden="true" />
            {t('inventory.legendAvailable')}
          </span>
          <span className={styles.legendItem}>
            <span
              className={cx(styles.legendSwatch, styles.legendSwatchFull)}
              aria-hidden="true"
            />
            {t('inventory.legendFull')}
          </span>
          <span className={styles.legendItem}>
            <span
              className={cx(styles.legendSwatch, styles.legendSwatchClosed)}
              aria-hidden="true"
            />
            {t('inventory.legendClosed')}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function RangeEditor({
  roomTypeCode,
  month,
  onDone,
  onError,
}: {
  roomTypeCode: string;
  month: Date;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [from, setFrom] = useState(isoDate(startOfMonth(month)));
  const [to, setTo] = useState(isoDate(endOfMonth(month)));
  const [totalRooms, setTotalRooms] = useState('');
  const [closed, setClosed] = useState<'unchanged' | 'open' | 'closed'>(
    'unchanged',
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (totalRooms === '' && closed === 'unchanged') {
      onError(t('inventory.nothingToChange'));
      return;
    }

    setBusy(true);

    try {
      await adminApi.updateInventory({
        roomTypeCode,
        from,
        to,
        ...(totalRooms === '' ? {} : { totalRooms: Number(totalRooms) }),
        ...(closed === 'unchanged' ? {} : { isClosed: closed === 'closed' }),
      });
      await onDone(t('inventory.updated', { from, to }));
      setTotalRooms('');
      setClosed('unchanged');
    } catch (caught) {
      // The API refuses the whole range if any night already has more rooms
      // booked than the new total, rather than applying part of it.
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader
          title={t('inventory.editTitle')}
          description={t('inventory.editIntro')}
          tight
        />

        <CardBody>
          <div className={styles.toolbar}>
            <Field label={t('inventory.from')} className={styles.toolbarField}>
              <Input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              />
            </Field>

            <Field label={t('inventory.to')} className={styles.toolbarField}>
              <Input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                required
              />
            </Field>

            <Field
              label={t('inventory.totalRooms')}
              className={styles.toolbarField}
            >
              <Input
                type="number"
                min="0"
                value={totalRooms}
                onChange={(event) => setTotalRooms(event.target.value)}
                placeholder={t('inventory.unchanged')}
                dir="ltr"
              />
            </Field>

            <Field
              label={t('inventory.stopSell')}
              className={styles.toolbarField}
            >
              <Select
                value={closed}
                onChange={(event) =>
                  setClosed(
                    event.target.value as 'unchanged' | 'open' | 'closed',
                  )
                }
              >
                <option value="unchanged">{t('inventory.unchanged')}</option>
                <option value="open">{t('inventory.open')}</option>
                <option value="closed">{t('inventory.closed')}</option>
              </Select>
            </Field>

            <div className={styles.toolbarActions}>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? t('saving') : t('inventory.apply')}
              </Button>
            </div>
          </div>
        </CardBody>
      </form>
    </Card>
  );
}

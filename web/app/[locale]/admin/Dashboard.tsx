'use client';

/**
 * The dashboard: today's arrivals and departures, occupancy, recent bookings.
 *
 * One request rather than four — the API composes this server-side, so the
 * screen cannot show four figures taken at four slightly different moments.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { adminApi, type AdminDashboard } from '@/lib/api/admin-client';
import type { Locale, Reservation } from '@/lib/api/types';
import { formatStayDate, formatNumber } from '@/lib/format';
import { AdminShell } from './AdminShell';
import {
  ArrivalIcon,
  DepartureIcon,
  OccupancyIcon,
  TotalIcon,
} from './icons';
import {
  Badge,
  Card,
  CardHeader,
  ErrorNote,
  Num,
  Stat,
  StatGridSkeleton,
  StatusPill,
  useApiErrorMessage,
} from './pieces';
import styles from './Admin.module.css';

export function Dashboard({ locale }: { locale: Locale }) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    adminApi
      .getDashboard()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    // The screen can unmount while the request is in flight — on sign-out, or
    // on a quick navigation. Setting state afterwards would warn and, worse,
    // could show a signed-out user someone else's figures.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminShell
      title={t('nav.dashboard')}
      meta={data ? <Num>{formatStayDate(data.date, locale)}</Num> : null}
    >
      <ErrorNote message={error} />

      {!data && !error ? <StatGridSkeleton /> : null}

      {data ? (
        <>
          <div className={styles.statGrid}>
            <Stat
              label={t('dashboard.arrivals')}
              value={<Num>{formatNumber(data.arrivals.length, locale)}</Num>}
              icon={<ArrivalIcon className={styles.icon} />}
            />
            <Stat
              label={t('dashboard.departures')}
              value={<Num>{formatNumber(data.departures.length, locale)}</Num>}
              icon={<DepartureIcon className={styles.icon} />}
            />
            <Stat
              label={t('dashboard.occupancy')}
              value={
                <Num>
                  {data.occupancyToday
                    ? `${formatNumber(data.occupancyToday.occupancyPercent, locale)}%`
                    : '—'}
                </Num>
              }
              // Isolated: the note mixes digits with words, and while the
              // Arabic keys are still English placeholders an unisolated
              // "0 of 106 rooms" renders as "of 106 rooms 0" on /ar.
              note={
                data.occupancyToday ? (
                  <bdi>
                    {t('dashboard.roomsBooked', {
                      booked: formatNumber(
                        data.occupancyToday.roomsBooked,
                        locale,
                      ),
                      total: formatNumber(
                        data.occupancyToday.roomsAvailable,
                        locale,
                      ),
                    })}
                  </bdi>
                ) : undefined
              }
              icon={<OccupancyIcon className={styles.icon} />}
            />
            <Stat
              label={t('dashboard.totalReservations')}
              value={<Num>{formatNumber(data.totalReservations, locale)}</Num>}
              icon={<TotalIcon className={styles.icon} />}
            />
          </div>

          <MovementCard
            title={t('dashboard.arrivals')}
            reservations={data.arrivals}
            locale={locale}
            emptyMessage={t('dashboard.noArrivals')}
          />

          <MovementCard
            title={t('dashboard.departures')}
            reservations={data.departures}
            locale={locale}
            emptyMessage={t('dashboard.noDepartures')}
          />

          <MovementCard
            title={t('dashboard.recent')}
            reservations={data.recentReservations}
            locale={locale}
            emptyMessage={t('reservations.none')}
          />
        </>
      ) : null}
    </AdminShell>
  );
}

/**
 * One list of bookings, as a card.
 *
 * The empty case keeps its own card rather than vanishing: "no arrivals today"
 * is information the front desk wants stated, not an absence to infer from a
 * missing section.
 */
function MovementCard({
  title,
  reservations,
  locale,
  emptyMessage,
}: {
  title: string;
  reservations: Reservation[];
  locale: Locale;
  emptyMessage: string;
}) {
  const t = useTranslations('admin');

  return (
    <Card>
      <CardHeader
        title={title}
        actions={
          reservations.length > 0 ? (
            <Badge tone="neutral">
              <Num>{formatNumber(reservations.length, locale)}</Num>
            </Badge>
          ) : undefined
        }
        tight
      />

      {reservations.length === 0 ? (
        <p className={styles.cardEmpty}>
          <bdi>{emptyMessage}</bdi>
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('reservations.reference')}</th>
                <th scope="col">{t('reservations.guest')}</th>
                <th scope="col">{t('reservations.roomType')}</th>
                <th scope="col">{t('reservations.stay')}</th>
                <th scope="col">{t('reservations.status')}</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((reservation) => (
                <tr key={reservation.reference}>
                  <td className={styles.mono}>
                    <Num>{reservation.reference}</Num>
                  </td>
                  <td>
                    {/* Guest names are database text in an unknown script, so
                        they are isolated from the layout direction. */}
                    <bdi>
                      {reservation.guest.firstName} {reservation.guest.lastName}
                    </bdi>
                  </td>
                  <td>
                    <bdi>{reservation.roomType.name[locale]}</bdi>
                  </td>
                  <td className={styles.numeric}>
                    <Num>
                      {formatStayDate(reservation.stay.checkIn, locale)} –{' '}
                      {formatStayDate(reservation.stay.checkOut, locale)}
                    </Num>
                  </td>
                  <td>
                    <StatusPill status={reservation.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

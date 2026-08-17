'use client';

/**
 * The reservations dashboard: filter, search, and act on bookings.
 *
 * Every action here goes to the API — check-in, check-out, and cancellation
 * are all reservation-engine operations, and none of the rules behind them
 * (what releases inventory, which transitions are legal) live in this file.
 * The screen only asks and reports (`pms-readiness`).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { adminApi } from '@/lib/api/admin-client';
import type { Locale, Reservation, ReservationStatus } from '@/lib/api/types';
import { formatMoney, formatStayDate } from '@/lib/format';
import { AdminShell } from '../AdminShell';
import { SearchIcon } from '../icons';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  Empty,
  ErrorNote,
  Field,
  Input,
  Loading,
  Num,
  Pagination,
  Select,
  StatusPill,
  useApiErrorMessage,
} from '../pieces';
import styles from '../Admin.module.css';

const PAGE_SIZE = 25;

const STATUSES: ReservationStatus[] = [
  'confirmed',
  'checked-in',
  'checked-out',
  'cancelled',
  'held',
];

export function Reservations({ locale }: { locale: Locale }) {
  const t = useTranslations('admin');
  const describeError = useApiErrorMessage();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ReservationStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyReference, setBusyReference] = useState<string | null>(null);

  // The booking the cancel dialog is currently asking about, if any.
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await adminApi.listReservations({
        limit: PAGE_SIZE,
        offset,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      setReservations(result.reservations);
      setTotal(result.total);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, search, status, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run an action against one booking, then reload.
   *
   * Reloading rather than patching the row locally: cancelling releases
   * inventory and changes figures elsewhere on the screen, and a hand-patched
   * row would drift from what the database actually holds.
   */
  async function act(
    reference: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    setBusyReference(reference);
    setError(null);

    try {
      await action();
      await load();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyReference(null);
    }
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    // Back to the first page: staying on page 3 of the previous result set
    // would usually show nothing.
    setOffset(0);
    void load();
  }

  return (
    <AdminShell
      title={t('nav.reservations')}
      meta={t('reservations.count', { count: total })}
    >
      <Card>
        <CardBody>
          <form className={styles.toolbar} onSubmit={applyFilters} role="search">
            <Field label={t('reservations.search')} className={styles.toolbarField}>
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('reservations.searchHint')}
              />
            </Field>

            <Field label={t('reservations.status')} className={styles.toolbarField}>
              <Select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ReservationStatus | '')
                }
              >
                <option value="">{t('reservations.allStatuses')}</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${statusKey(value)}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('reservations.from')} className={styles.toolbarField}>
              <Input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>

            <Field label={t('reservations.to')} className={styles.toolbarField}>
              <Input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>

            <div className={styles.toolbarActions}>
              <Button variant="primary" type="submit">
                <SearchIcon className={styles.icon} size="0.875rem" />
                {t('reservations.apply')}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <ErrorNote message={error} />

      {loading ? <Loading /> : null}

      {!loading && reservations.length === 0 ? (
        <Empty message={t('reservations.none')} />
      ) : null}

      {!loading && reservations.length > 0 ? (
        <Card>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('reservations.reference')}</th>
                  <th scope="col">{t('reservations.guest')}</th>
                  <th scope="col">{t('reservations.roomType')}</th>
                  <th scope="col">{t('reservations.stay')}</th>
                  <th scope="col">{t('reservations.total')}</th>
                  <th scope="col">{t('reservations.status')}</th>
                  <th scope="col">{t('reservations.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => (
                  <tr key={reservation.reference}>
                    <td className={styles.mono}>
                      <Num>{reservation.reference}</Num>
                    </td>
                    <td>
                      <bdi>
                        {reservation.guest.firstName}{' '}
                        {reservation.guest.lastName}
                      </bdi>
                      <span className={styles.cellSub}>
                        <bdi dir="ltr">{reservation.guest.email}</bdi>
                      </span>
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
                    <td className={styles.numeric}>
                      <Num>
                        {formatMoney(
                          reservation.price.grandTotal,
                          reservation.price.currency,
                          locale,
                        )}
                      </Num>
                    </td>
                    <td>
                      <StatusPill status={reservation.status} />
                    </td>
                    <td>
                      <RowActions
                        reservation={reservation}
                        busy={busyReference === reservation.reference}
                        onAct={act}
                        onRequestCancel={setPendingCancel}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            from={offset + 1}
            to={Math.min(offset + reservations.length, total)}
            total={total}
            canGoBack={offset > 0}
            canGoForward={offset + PAGE_SIZE < total}
            onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(offset + PAGE_SIZE)}
          />
        </Card>
      ) : null}

      {/*
        One dialog for the whole table rather than one per row. Cancelling
        releases the guest's rooms back to sale and cannot be undone from this
        screen, so it asks first — and asks in the hotel's own words, in the
        reader's language, which `window.confirm` could not do.
      */}
      <ConfirmDialog
        open={pendingCancel !== null}
        title={t('reservations.confirmCancelTitle')}
        description={t('reservations.confirmCancel', {
          reference: pendingCancel ?? '',
        })}
        // "Cancel booking", not "Cancel" — beside a "Go back" button, a lone
        // "Cancel" reads as the way *out* of the dialog rather than the
        // irreversible thing it actually does.
        confirmLabel={t('reservations.confirmCancelAction')}
        destructive
        busy={busyReference !== null}
        onDismiss={() => setPendingCancel(null)}
        onConfirm={() => {
          const reference = pendingCancel;
          if (!reference) return;
          setPendingCancel(null);
          void act(reference, () => adminApi.cancelReservation(reference));
        }}
      />
    </AdminShell>
  );
}

function statusKey(status: ReservationStatus): string {
  return status === 'checked-in'
    ? 'checkedIn'
    : status === 'checked-out'
      ? 'checkedOut'
      : status;
}

/**
 * The actions available on one booking.
 *
 * Which are offered follows the same lifecycle the API enforces — the server
 * rejects an illegal transition regardless, so this only avoids offering
 * buttons that would fail.
 */
function RowActions({
  reservation,
  busy,
  onAct,
  onRequestCancel,
}: {
  reservation: Reservation;
  busy: boolean;
  onAct: (reference: string, action: () => Promise<unknown>) => Promise<void>;
  onRequestCancel: (reference: string) => void;
}) {
  const t = useTranslations('admin');
  const { reference, status } = reservation;

  const canCheckIn = status === 'confirmed' || status === 'held';
  const canCheckOut = status === 'checked-in';
  const canCancel = status === 'confirmed' || status === 'held';

  if (!canCheckIn && !canCheckOut && !canCancel) {
    return <span className={styles.muted}>—</span>;
  }

  return (
    <div className={styles.rowActions}>
      {canCheckIn ? (
        <Button
          size="small"
          disabled={busy}
          onClick={() =>
            void onAct(reference, () =>
              adminApi.setReservationStatus(reference, 'check-in'),
            )
          }
        >
          {t('reservations.checkIn')}
        </Button>
      ) : null}

      {canCheckOut ? (
        <Button
          size="small"
          disabled={busy}
          onClick={() =>
            void onAct(reference, () =>
              adminApi.setReservationStatus(reference, 'check-out'),
            )
          }
        >
          {t('reservations.checkOut')}
        </Button>
      ) : null}

      {canCancel ? (
        <Button
          variant="danger"
          size="small"
          disabled={busy}
          onClick={() => onRequestCancel(reference)}
        >
          {t('reservations.cancel')}
        </Button>
      ) : null}
    </div>
  );
}

'use client';

/**
 * The three-step reserve flow.
 *
 * Dates and guests → room → details → confirmation, matching the mockups.
 *
 * The mockup's script carries hardcoded rates and computes the total in the
 * browser (`selPrice * selNights`). None of that survives here: availability
 * and every figure come from the API, because pricing and availability belong
 * to the booking layer so a future PMS can own them without this component
 * changing (`pms-readiness`, `booking-engine`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ApiError, bookingApi } from '@/lib/api/client';
import type {
  AvailableRoomType,
  Locale,
  Reservation,
  VoucherPreview,
} from '@/lib/api/types';
import { formatMoney, countNights } from '@/lib/format';
import { MAX_ADULTS } from '@/lib/stay-dates';
import { Confirmation } from './Confirmation';
import { DatePicker } from './DatePicker';
import { GuestDetails } from './GuestDetails';
import { StaySummary } from './StaySummary';
import { RoomDetailDialog } from './RoomDetailDialog';
import { useBookingState, type Step } from './useBookingState';
import styles from './Reserve.module.css';

export function ReserveFlow({ locale }: { locale: Locale }) {
  const t = useTranslations('reserve');
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');

  const { state, update, updateGuest, clear, restored } =
    useBookingState(locale);

  const [rooms, setRooms] = useState<AvailableRoomType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);

  /**
   * The room whose details are open, by code.
   *
   * The code rather than the room itself, so a refreshed availability response
   * cannot leave the dialog showing a stale price while the list behind it
   * shows the current one.
   */
  const [detailCode, setDetailCode] = useState<string | null>(null);

  /**
   * The discount the guest has applied, if any.
   *
   * Holds the whole repriced breakdown the API returned, not just the code, so
   * the summary shows exactly the figures the booking will use. It is cleared
   * whenever the stay or the room changes, because a code valid for a two-night
   * stay in one room may not apply to a different one — and showing a stale
   * discount would quote a price the booking then refuses.
   */
  const [voucher, setVoucher] = useState<VoucherPreview | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const nights =
    state.checkIn && state.checkOut
      ? countNights(state.checkIn, state.checkOut)
      : 0;

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.code === state.roomTypeCode) ?? null,
    [rooms, state.roomTypeCode],
  );

  /**
   * Turn an API failure into a message the guest can act on.
   *
   * Branching on the error *code* rather than its text is what lets the same
   * condition read correctly in both languages — and lets "those dates just
   * went" read differently from "we could not reach the booking system".
   */
  const describeError = useCallback(
    (caught: unknown): string => {
      if (caught instanceof ApiError) {
        switch (caught.code) {
          case 'NO_AVAILABILITY':
            return tErrors('noAvailability');
          case 'NETWORK_ERROR':
            return tErrors('network');
          case 'RATE_LIMITED':
            return tErrors('rateLimited');
          case 'INVALID_STAY':
            return tErrors('checkOutAfterCheckIn');
          // A mistyped code is the guest's to fix, so each reason is named.
          // Falling through to "something went wrong" would read as a fault at
          // the hotel's end and leave them with nothing to act on.
          case 'VOUCHER_NOT_FOUND':
            return tErrors('voucherNotFound');
          case 'VOUCHER_EXPIRED':
            return tErrors('voucherExpired');
          case 'VOUCHER_EXHAUSTED':
            return tErrors('voucherExhausted');
          case 'VOUCHER_NOT_APPLICABLE':
            return tErrors('voucherNotApplicable');
          default:
            return tErrors('unknown');
        }
      }
      return tErrors('unknown');
    },
    [tErrors],
  );

  const goToStep = useCallback(
    (step: Step) => {
      update({ step });
      setError(null);
      // Move focus to the heading so keyboard and screen-reader users land on
      // the new step rather than being left where the old button used to be.
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    [update],
  );

  async function searchAvailability() {
    if (!state.checkIn || !state.checkOut) {
      setError(tErrors('selectDates'));
      return;
    }
    if (state.checkOut <= state.checkIn) {
      setError(tErrors('checkOutAfterCheckIn'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const available = await bookingApi.checkAvailability({
        checkIn: state.checkIn,
        checkOut: state.checkOut,
        adults: state.adults,
        children: state.children,
        roomsCount: state.roomsCount,
      });
      setRooms(available);

      // A room chosen earlier may not be available for newly-picked dates.
      if (
        state.roomTypeCode &&
        !available.some((room) => room.code === state.roomTypeCode)
      ) {
        update({ roomTypeCode: null });
      }
      goToStep(2);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Re-fetch availability when returning to step 2 with no rooms loaded — after
   * restoring a saved session, for instance. Neither prices nor availability
   * are persisted, so they must always come back from the API fresh.
   *
   * The in-flight guard is a ref keyed on the search, not the `loading` state.
   * Using `loading` here deadlocks: it would have to be a dependency to be read
   * correctly, so setting it true re-runs the effect, and that run's cleanup
   * cancels the very request that set it — leaving the step showing "loading"
   * forever. Caught by the session-persistence e2e test.
   */
  const inFlightSearchRef = useRef<string | null>(null);

  useEffect(() => {
    if (!restored || state.step !== 2 || rooms.length > 0) return;
    if (!state.checkIn || !state.checkOut) return;

    const search = [
      state.checkIn,
      state.checkOut,
      state.adults,
      state.children,
      state.roomsCount,
    ].join('|');
    if (inFlightSearchRef.current === search) return;
    inFlightSearchRef.current = search;

    let cancelled = false;
    setLoading(true);
    bookingApi
      .checkAvailability({
        checkIn: state.checkIn,
        checkOut: state.checkOut,
        adults: state.adults,
        children: state.children,
        roomsCount: state.roomsCount,
      })
      .then((available) => {
        if (cancelled) return;
        setRooms(available);

        // The same check `searchAvailability` makes, because this path reaches
        // step 2 without going through it: a restored session, or a link that
        // named a room (`?room=`). Without it a room that has since sold out —
        // or one a crafted URL invented — stays selected against a list that
        // does not contain it, and "Continue" carries a phantom room into the
        // guest's details, where the booking fails at the last step instead of
        // the guest simply picking again here.
        if (
          state.roomTypeCode &&
          !available.some((room) => room.code === state.roomTypeCode)
        ) {
          update({ roomTypeCode: null });
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
        // Let a later attempt retry this same search.
        inFlightSearchRef.current = null;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    restored,
    state.step,
    state.checkIn,
    state.checkOut,
    state.adults,
    state.children,
    state.roomsCount,
    state.roomTypeCode,
    rooms.length,
    update,
    describeError,
  ]);

  // A code is validated against a specific stay and room type. Change either
  // and the preview is no longer the truth.
  useEffect(() => {
    setVoucher(null);
  }, [state.checkIn, state.checkOut, state.roomTypeCode, state.roomsCount]);

  /**
   * Ask the API what a code is worth for this stay.
   *
   * Returns an error message rather than throwing, so the field can show it
   * inline without the whole flow going into its error state — a mistyped code
   * is not a failed booking.
   */
  async function applyVoucher(code: string): Promise<string | null> {
    if (!state.checkIn || !state.checkOut || !state.roomTypeCode) return null;

    try {
      setVoucher(
        await bookingApi.previewVoucher({
          code,
          roomTypeCode: state.roomTypeCode,
          checkIn: state.checkIn,
          checkOut: state.checkOut,
          roomsCount: state.roomsCount,
        }),
      );
      return null;
    } catch (caught) {
      setVoucher(null);
      return describeError(caught);
    }
  }

  async function submitBooking() {
    if (!state.checkIn || !state.checkOut || !state.roomTypeCode) return;

    setLoading(true);
    setError(null);
    try {
      const created = await bookingApi.createReservation({
        roomTypeCode: state.roomTypeCode,
        checkIn: state.checkIn,
        checkOut: state.checkOut,
        adults: state.adults,
        children: state.children,
        roomsCount: state.roomsCount,
        guest: { ...state.guest, locale },
        ...(state.specialRequests
          ? { specialRequests: state.specialRequests }
          : {}),
        // The API re-validates and claims it inside the booking transaction.
        // If it has been exhausted since the preview, the booking fails rather
        // than quietly charging the undiscounted price.
        ...(voucher ? { voucherCode: voucher.code } : {}),
      });

      setReservation(created);
      // The booking is done; keeping the draft would let a refresh re-submit it.
      clear();
    } catch (caught) {
      setError(describeError(caught));
      // Losing the race for the last room means the chosen room is gone, so
      // send the guest back to pick again rather than leaving them on a dead
      // form.
      if (caught instanceof ApiError && caught.code === 'NO_AVAILABILITY') {
        setRooms([]);
        update({ step: 2, roomTypeCode: null });
      }
    } finally {
      setLoading(false);
    }
  }

  if (reservation) {
    return <Confirmation locale={locale} reservation={reservation} />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.formSide}>
        <p className={styles.pageLabel}>{t('title')}</p>
        <h1 className={styles.pageHeading} tabIndex={-1} ref={headingRef}>
          {t(`step${state.step}.title` as 'step1.title')}
        </h1>
        <p className={styles.pageSub}>{t('summary.payAtCheckIn')}</p>

        <StepIndicator current={state.step} />

        {error ? (
          // `alert` so the message is announced immediately — a guest who has
          // just lost a room to someone else needs to know now, not on next tab.
          <div className={styles.alert} role="alert">
            {error}
          </div>
        ) : null}

        {state.step === 1 && (
          <>
            <DatePicker
              locale={locale}
              checkIn={state.checkIn}
              checkOut={state.checkOut}
              onChange={({ checkIn, checkOut }) =>
                update({ checkIn, checkOut })
              }
            />

            <div className={styles.field}>
              <span className={styles.fieldLabel} id="guests-label">
                {t('step1.guests')}
              </span>
              <div className={styles.counter} aria-labelledby="guests-label">
                <button
                  type="button"
                  className={styles.counterBtn}
                  onClick={() =>
                    update({ adults: Math.max(1, state.adults - 1) })
                  }
                  disabled={state.adults <= 1}
                  aria-label={`${t('step1.guests')} −`}
                >
                  −
                </button>
                <span className={styles.counterValue} aria-live="polite">
                  {state.adults}
                </span>
                <button
                  type="button"
                  className={styles.counterBtn}
                  onClick={() =>
                    update({ adults: Math.min(MAX_ADULTS, state.adults + 1) })
                  }
                  disabled={state.adults >= MAX_ADULTS}
                  aria-label={`${t('step1.guests')} +`}
                >
                  +
                </button>
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={searchAvailability}
                disabled={loading}
                data-testid="check-availability"
              >
                {loading ? tCommon('loading') : t('step1.checkAvailability')}
              </button>
            </div>
          </>
        )}

        {state.step === 2 && (
          <>
            <span className={styles.roomsLabel}>{t('step2.title')}</span>

            {loading ? (
              <p className={styles.loading}>{tCommon('loading')}</p>
            ) : rooms.length === 0 ? (
              <div className={styles.empty}>
                <p>{t('step2.noAvailability')}</p>
              </div>
            ) : (
              <ul className={styles.roomList}>
                {rooms.map((room) => {
                  const selected = room.code === state.roomTypeCode;
                  return (
                    <li key={room.code}>
                      {/* Card, then button — not one element doing both. The
                          card carries the frame and the selected state; the
                          button inside it selects the room and nothing else.
                          A link cannot be nested inside a button, and the
                          alternative — making the whole card a link — would
                          take away the one-click selection this step exists
                          for. */}
                      <div
                        className={[
                          styles.roomCard,
                          selected ? styles.roomCardSelected : null,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <button
                          type="button"
                          className={[
                            styles.room,
                            selected ? styles.roomSelected : null,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => update({ roomTypeCode: room.code })}
                          aria-pressed={selected}
                          data-testid={`room-${room.code}`}
                        >
                          <span
                            className={styles.roomSwatch}
                            data-swatch={room.imageKey}
                            aria-hidden="true"
                          />
                          <span>
                            <span className={styles.roomCategory}>
                              {room.category[locale]}
                            </span>
                            <span className={styles.roomName}>
                              {room.name[locale]}
                            </span>
                            <span className={styles.roomMeta}>
                              {t('step2.roomsLeft', {
                                count: room.roomsAvailable,
                              })}
                            </span>
                          </span>
                          <span>
                            <span className={styles.roomAmount}>
                              {formatMoney(
                                room.price.grandTotal,
                                room.price.currency,
                                locale,
                              )}
                            </span>
                            <span className={styles.roomPer}>
                              {nights}{' '}
                              {nights === 1
                                ? tCommon('night')
                                : tCommon('nights')}
                            </span>
                          </span>
                          <span className={styles.roomCheck}>
                            <span className={styles.checkMark} />
                          </span>
                        </button>

                        {/* Opens in place rather than navigating. A guest
                            comparing rooms is mid-decision, and sending them
                            to another page ends the comparison and makes them
                            find their way back. The room page still exists for
                            searchers and shared links; this is the same
                            content without the round trip. */}
                        <button
                          type="button"
                          className={styles.roomDetails}
                          onClick={() => setDetailCode(room.code)}
                          data-testid={`room-details-${room.code}`}
                        >
                          {t('step2.viewDetails')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnBack}
                onClick={() => goToStep(1)}
              >
                {t('back')}
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => {
                  if (!state.roomTypeCode) {
                    setError(tErrors('selectRoom'));
                    return;
                  }
                  goToStep(3);
                }}
                disabled={loading || rooms.length === 0}
                data-testid="continue-to-details"
              >
                {t('continue')}
              </button>
            </div>

            {/* Resolved from the current `rooms` rather than held in state, so
                the dialog always shows the same price the row behind it does.
                A code whose room is no longer in the list — it sold out while
                the dialog was open — resolves to null, which closes it rather
                than leaving a price nobody can still book on screen. */}
            <RoomDetailDialog
              room={rooms.find((room) => room.code === detailCode) ?? null}
              locale={locale}
              nights={nights}
              selected={detailCode === state.roomTypeCode}
              onSelect={() => {
                update({ roomTypeCode: detailCode });
                setDetailCode(null);
              }}
              onDismiss={() => setDetailCode(null)}
            />
          </>
        )}

        {state.step === 3 && (
          <GuestDetails
            guest={state.guest}
            specialRequests={state.specialRequests}
            submitting={loading}
            onChangeGuest={updateGuest}
            onChangeRequests={(value) => update({ specialRequests: value })}
            onBack={() => goToStep(2)}
            onSubmit={submitBooking}
          />
        )}
      </div>

      <StaySummary
        locale={locale}
        checkIn={state.checkIn}
        checkOut={state.checkOut}
        adults={state.adults}
        children={state.children}
        room={selectedRoom}
        // The previewed breakdown wins when a code is applied: it is the same
        // arithmetic the booking will use, done by the API.
        price={voucher?.price ?? selectedRoom?.price ?? null}
        voucher={voucher}
        onApplyVoucher={applyVoucher}
        onRemoveVoucher={() => setVoucher(null)}
      />
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const t = useTranslations('reserve.steps');
  const items = [
    { step: 1 as const, label: t('dates') },
    { step: 2 as const, label: t('room') },
    { step: 3 as const, label: t('details') },
  ];

  return (
    <ol className={styles.steps}>
      {items.map((item) => {
        const done = item.step < current;
        const active = item.step === current;
        return (
          <li
            key={item.step}
            className={[
              styles.step,
              active ? styles.stepActive : null,
              done ? styles.stepDone : null,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={active ? 'step' : undefined}
          >
            <span className={styles.stepNum} aria-hidden="true">
              {done ? '✓' : item.step}
            </span>
            {item.label}
          </li>
        );
      })}
    </ol>
  );
}

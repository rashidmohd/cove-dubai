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
  PriceBreakdown,
  Reservation,
  RoomType,
  UnavailableRoomType,
  VoucherPreview,
} from '@/lib/api/types';
import { formatMoney, countNights } from '@/lib/format';
import {
  MAX_ADULTS,
  MAX_CHILDREN,
  MAX_CHILD_AGE,
  completeChildAges,
} from '@/lib/stay-dates';
import { Confirmation } from './Confirmation';
import { DatePicker } from './DatePicker';
import { GuestDetails } from './GuestDetails';
import { StaySummary } from './StaySummary';
import { Photo, RoomCarousel } from '@/components/marketing';
import { resolveRoomPhoto, resolveRoomPhotos } from '@/lib/media';
import { RoomDetailDialog } from './RoomDetailDialog';
import { useBookingState, type Step } from './useBookingState';
import styles from './Reserve.module.css';

/** A few photographs per room in the list; the details dialog has them all. */
const ROOM_PHOTO_LIMIT = 5;

/**
 * How step 2 lays out the rooms: a grid of large photographs by default, or
 * the compact list for a guest comparing prices down one column.
 */
type RoomView = 'grid' | 'list';

/** Where the guest's choice of view is remembered, in this browser only. */
const ROOM_VIEW_KEY = 'cove.reserve.roomView';

/**
 * The remembered view, or the grid. Read once, lazily: step 2 is never
 * server-rendered (the flow starts at step 1 until the session is restored),
 * so reading browser storage here cannot cause a hydration mismatch. Storage
 * can be unavailable or throw — a private window, blocked site data — and the
 * grid is then simply the answer.
 */
function readRoomView(): RoomView {
  if (typeof window === 'undefined') return 'grid';
  try {
    return window.localStorage.getItem(ROOM_VIEW_KEY) === 'list'
      ? 'list'
      : 'grid';
  } catch {
    return 'grid';
  }
}

export function ReserveFlow({ locale }: { locale: Locale }) {
  const t = useTranslations('reserve');
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');
  const tPhoto = useTranslations('photos');
  const tRooms = useTranslations('rooms');

  const { state, update, updateGuest, clear, restored } =
    useBookingState(locale);

  const [rooms, setRooms] = useState<AvailableRoomType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Why the room the guest arrived with is not in the list, shown above it.
   *
   * Separate from `error`: nothing has failed. The guest picked a room that
   * does not suit these dates or this party, and needs to hear which, so they
   * know whether to change the room, the dates or the guests.
   */
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * True when no room is on offer *because of the party*, not the dates. The
   * empty list then says so — "nothing available for those dates" would send
   * a family of six hunting through a calendar for dates that do not exist.
   */
  const [partyTooLarge, setPartyTooLarge] = useState(false);

  /**
   * Every room the hotel sells, for the step-1 card naming the room a guest
   * arrived with. Availability is not known until they pick dates, so this is
   * the catalogue, not an offer — it carries no price for the stay.
   */
  const [catalogue, setCatalogue] = useState<RoomType[]>([]);
  const [reservation, setReservation] = useState<Reservation | null>(null);

  /**
   * The room whose details are open, by code.
   *
   * The code rather than the room itself, so a refreshed availability response
   * cannot leave the dialog showing a stale price while the list behind it
   * shows the current one.
   */
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [roomView, setRoomView] = useState<RoomView>(readRoomView);

  const chooseRoomView = (view: RoomView) => {
    setRoomView(view);
    try {
      window.localStorage.setItem(ROOM_VIEW_KEY, view);
    } catch {
      // Not remembered; the choice still holds for this visit.
    }
  };

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
  const alertRef = useRef<HTMLDivElement>(null);

  // The alert renders at the top of the form, and on a phone the button that
  // raised it is pinned to the bottom of the screen — a whole page away. Bring
  // it into view so the guest is not left pressing a button that seems to do
  // nothing.
  useEffect(() => {
    if (error) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);


  const nights =
    state.checkIn && state.checkOut
      ? countNights(state.checkIn, state.checkOut)
      : 0;

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.code === state.roomTypeCode) ?? null,
    [rooms, state.roomTypeCode],
  );

  /** The price for the bar pinned under the guest's thumb on a phone. */
  const barPrice = voucher?.price ?? selectedRoom?.price ?? null;

  /** The room chosen before dates, as the catalogue describes it. */
  const chosenRoom = useMemo(
    () => catalogue.find((room) => room.code === state.roomTypeCode) ?? null,
    [catalogue, state.roomTypeCode],
  );

  const childAges = state.childAges;

  // Only fetched when a room has been chosen before availability — a link from
  // a room page — because that is the only time step 1 has a room to show.
  useEffect(() => {
    if (!restored || !state.roomTypeCode || catalogue.length > 0) return;
    let cancelled = false;
    bookingApi
      .getRoomTypes()
      .then((roomTypes) => {
        if (!cancelled) setCatalogue(roomTypes);
      })
      .catch(() => {
        // The card is a courtesy. Without it the flow still works: the room is
        // still chosen, and availability still decides what happens next.
      });
    return () => {
      cancelled = true;
    };
  }, [restored, state.roomTypeCode, catalogue.length]);

  /**
   * Explain why a chosen room is not on offer.
   *
   * Reads the reason the API gave. With none — an API that does not explain,
   * or a code it does not sell at all — the general sentence still tells the
   * guest the room is unavailable rather than leaving it to vanish silently.
   */
  const describeUnavailable = useCallback(
    (code: string, unavailable: UnavailableRoomType[]): string => {
      const room =
        catalogue.find((entry) => entry.code === code)?.name[locale] ??
        t('step2.yourRoom');
      const why = unavailable.find((entry) => entry.code === code);
      switch (why?.reason) {
        case 'occupancy':
          return t('step2.unavailable.occupancy', { room });
        case 'sold-out':
          return t('step2.unavailable.soldOut', { room });
        case 'minimum-stay':
          return t('step2.unavailable.minimumStay', {
            room,
            nights: why.minimumStayNights ?? 2,
          });
        default:
          return t('step2.unavailable.other', { room });
      }
    },
    [catalogue, locale, t],
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
          case 'OCCUPANCY_EXCEEDED':
            return tErrors('occupancyExceeded');
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
      setNotice(null);
      // Move focus to the heading so keyboard and screen-reader users land on
      // the new step rather than being left where the old button used to be.
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    [update],
  );

  /**
   * Select a room offer: its type, and the number of rooms it is offered at.
   * Kept together so the booking always takes as many rooms as were priced.
   */
  const chooseRoom = useCallback(
    (room: AvailableRoomType) =>
      update({ roomTypeCode: room.code, roomsCount: offeredRooms(room) }),
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
    const ages = completeChildAges(childAges);
    if (!ages) {
      setError(tErrors('childAgesRequired'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { roomTypes: available, unavailable } =
        await bookingApi.checkAvailability({
          checkIn: state.checkIn,
          checkOut: state.checkOut,
          adults: state.adults,
          childAges: ages,
          // No room count: the API offers each room at the number the party
          // needs, and choosing it books that many (`chooseRoom`).
        });
      setRooms(available);
      setPartyTooLarge(onlyOccupancy(available, unavailable));

      const chosen = available.find((room) => room.code === state.roomTypeCode);
      if (chosen) {
        // The guest chose this room before they had dates — from its page or
        // the rooms list — and it suits the stay. Asking them to pick it again
        // from a list of every room is the step this skips. The list is still
        // loaded, so "Back" from their details shows it with this room ticked.
        chooseRoom(chosen);
        goToStep(3);
        // A party too big for one of these rooms gets more than one, the way
        // any booking site would offer it — said plainly, so two rooms on the
        // bill is never a surprise.
        if (offeredRooms(chosen) > 1) {
          setNotice(
            t('step2.multiRoom', {
              room: chosen.name[locale],
              count: offeredRooms(chosen),
            }),
          );
        }
        return;
      }

      goToStep(2);
      const wanted = state.roomTypeCode;
      if (wanted) {
        // It does not suit the stay. Say why, above the rooms that do, so the
        // guest knows whether it is the dates, the party or the room to change.
        update({ roomTypeCode: null });
        setNotice(describeUnavailable(wanted, unavailable));
      }
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

    // A step-2 session with an unaged child cannot be searched; step 1 is
    // where the age is asked, so that is where the guest goes.
    const ages = completeChildAges(state.childAges);
    if (!ages) {
      update({ step: 1 });
      return;
    }

    const search = [
      state.checkIn,
      state.checkOut,
      state.adults,
      ages.join(','),
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
        childAges: ages,
      })
      .then(({ roomTypes: available, unavailable }) => {
        if (cancelled) return;
        setRooms(available);
        setPartyTooLarge(onlyOccupancy(available, unavailable));

        // The same check `searchAvailability` makes, because this path reaches
        // step 2 without going through it: a restored session, or a link that
        // named a room (`?room=`). Without it a room that has since sold out —
        // or one a crafted URL invented — stays selected against a list that
        // does not contain it, and "Continue" carries a phantom room into the
        // guest's details, where the booking fails at the last step instead of
        // the guest simply picking again here.
        const kept = available.find((room) => room.code === state.roomTypeCode);
        if (state.roomTypeCode && !kept) {
          update({ roomTypeCode: null });
        } else if (kept) {
          // Re-synced: the party may now need a different number of rooms.
          chooseRoom(kept);
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
    state.childAges,
    state.roomTypeCode,
    rooms.length,
    update,
    chooseRoom,
    describeError,
  ]);

  // A code is validated against a specific stay and room type. Change either
  // and the preview is no longer the truth.
  // The party too: extra-guest fees are discounted, so a preview for a
  // different party quotes a different total.
  useEffect(() => {
    setVoucher(null);
  }, [
    state.checkIn,
    state.checkOut,
    state.roomTypeCode,
    state.roomsCount,
    state.adults,
    state.childAges,
  ]);

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
          adults: state.adults,
          childAges: completeChildAges(state.childAges) ?? [],
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
        // Complete by now: step 1 refuses to search without every age.
        childAges: completeChildAges(state.childAges) ?? [],
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
          <div className={styles.alert} role="alert" ref={alertRef}>
            {error}
          </div>
        ) : null}

        {notice ? (
          // `status`, not `alert`: this is information about a choice, not a
          // failure, and it should not interrupt whatever is being read.
          <div className={styles.notice} role="status" data-testid="room-notice">
            {notice}
          </div>
        ) : null}

        {state.step === 1 && (
          <>
            {chosenRoom ? (
              <ChosenRoomCard
                room={chosenRoom}
                locale={locale}
                onChange={() => update({ roomTypeCode: null })}
              />
            ) : null}

            <DatePicker
              locale={locale}
              checkIn={state.checkIn}
              checkOut={state.checkOut}
              onChange={({ checkIn, checkOut }) =>
                update({ checkIn, checkOut })
              }
            />

            <div className={styles.guestRow}>
              <Counter
                id="adults"
                label={t('step1.adults')}
                hint={t('step1.adultsHint')}
                value={state.adults}
                min={1}
                max={MAX_ADULTS}
                onChange={(adults) => update({ adults })}
              />
              <Counter
                id="children"
                label={t('step1.children')}
                hint={t('step1.childrenHint', { max: MAX_CHILD_AGE })}
                value={childAges.length}
                min={0}
                max={MAX_CHILDREN}
                testId="children"
                onChange={(count) =>
                  update({
                    // Adding a child adds an unanswered age; removing one
                    // takes the last, so ages already picked stay put.
                    childAges:
                      count > childAges.length
                        ? [...childAges, null]
                        : childAges.slice(0, count),
                  })
                }
              />
            </div>

            {childAges.length > 0 ? (
              <fieldset className={styles.childAges}>
                <legend className={styles.fieldLabel}>
                  {t('step1.childAgesLegend')}
                </legend>
                <div className={styles.childAgeGrid}>
                  {childAges.map((age, index) => {
                    const id = `child-age-${index}`;
                    const missing = age === null && error !== null;
                    return (
                      <div className={styles.field} key={index}>
                        <label className={styles.childAgeLabel} htmlFor={id}>
                          {t('step1.childAge', { number: index + 1 })}
                        </label>
                        <select
                          id={id}
                          className={styles.select}
                          value={age ?? ''}
                          aria-invalid={missing || undefined}
                          data-testid={id}
                          onChange={(event) => {
                            const next = [...childAges];
                            next[index] =
                              event.target.value === ''
                                ? null
                                : Number(event.target.value);
                            update({ childAges: next });
                          }}
                        >
                          <option value="">{t('step1.ageChoose')}</option>
                          {Array.from({ length: MAX_CHILD_AGE + 1 }, (_, value) => (
                            <option key={value} value={value}>
                              {value === 0
                                ? t('step1.ageUnderOne')
                                : t('step1.ageYears', { age: value })}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                {/* Why we ask, so the question does not read as nosiness. */}
                <p className={styles.childAgesNote}>{t('step1.childAgesNote')}</p>
              </fieldset>
            ) : null}

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
            <div className={styles.roomsHead}>
              <span className={styles.roomsLabel}>{t('step2.title')}</span>

              {/* Two pressed-state buttons rather than a radio group: each is
                  a single action, and `aria-pressed` announces which is on. */}
              {!loading && rooms.length > 0 ? (
                <div
                  className={styles.viewToggle}
                  role="group"
                  aria-label={t('step2.view')}
                >
                  <button
                    type="button"
                    className={styles.viewOption}
                    onClick={() => chooseRoomView('grid')}
                    aria-pressed={roomView === 'grid'}
                    aria-label={t('step2.viewGrid')}
                    title={t('step2.viewGrid')}
                    data-testid="room-view-grid"
                  >
                    <GridIcon />
                  </button>
                  <button
                    type="button"
                    className={styles.viewOption}
                    onClick={() => chooseRoomView('list')}
                    aria-pressed={roomView === 'list'}
                    aria-label={t('step2.viewList')}
                    title={t('step2.viewList')}
                    data-testid="room-view-list"
                  >
                    <ListIcon />
                  </button>
                </div>
              ) : null}
            </div>

            {loading ? (
              <p className={styles.loading}>{tCommon('loading')}</p>
            ) : rooms.length === 0 ? (
              <div className={styles.empty}>
                <p>
                  {partyTooLarge
                    ? t('step2.partyTooLarge')
                    : t('step2.noAvailability')}
                </p>
              </div>
            ) : (
              <ul
                className={[
                  styles.roomList,
                  roomView === 'grid' ? styles.roomGrid : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-view={roomView}
              >
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
                        {/* The room's photographs, a few of them, to look
                            around without opening the details. Beside the
                            select button rather than inside it: the carousel
                            has its own arrows, and a button cannot hold other
                            buttons. It is not hidden from assistive technology
                            for the same reason — its controls are focusable.

                            The gradient stays underneath as the loading and
                            failure state. */}
                        <div
                          className={styles.roomSwatch}
                          data-swatch={room.imageKey}
                        >
                          <RoomCarousel
                            photos={resolveRoomPhotos(
                              room,
                              locale,
                              tPhoto('room', { name: room.name[locale] }),
                              ROOM_PHOTO_LIMIT,
                            )}
                            sizes={
                              roomView === 'grid'
                                ? '(max-width: 1000px) 100vw, 460px'
                                : '(max-width: 1000px) 104px, 200px'
                            }
                            label={room.name[locale]}
                            labels={{
                              previous: tRooms('carousel.previous'),
                              next: tRooms('carousel.next'),
                              slide: tRooms.raw('carousel.slide') as string,
                            }}
                            compact={roomView === 'list'}
                          />
                        </div>

                        <button
                          type="button"
                          className={[
                            styles.room,
                            selected ? styles.roomSelected : null,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => chooseRoom(room)}
                          aria-pressed={selected}
                          data-testid={`room-${room.code}`}
                        >
                          <span>
                            <span className={styles.roomCategory}>
                              {room.category[locale]}
                            </span>
                            <span className={styles.roomName}>
                              {offeredRooms(room) > 1 ? (
                                <span className={styles.roomTimes}>
                                  {offeredRooms(room)} ×{' '}
                                </span>
                              ) : null}
                              {room.name[locale]}
                            </span>
                            <span className={styles.roomMeta}>
                              {offeredRooms(room) > 1
                                ? `${t('step2.roomsForParty', {
                                    count: offeredRooms(room),
                                  })} · `
                                : null}
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
              <BarTotal
                price={barPrice}
                locale={locale}
                hint={tErrors('selectRoom')}
              />
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
                const room = rooms.find((entry) => entry.code === detailCode);
                if (room) chooseRoom(room);
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
            barTotal={<BarTotal price={barPrice} locale={locale} />}
          />
        )}
      </div>

      <StaySummary
        locale={locale}
        checkIn={state.checkIn}
        checkOut={state.checkOut}
        adults={state.adults}
        children={childAges.length}
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

/**
 * The total, for the action row a phone pins to the bottom of the screen.
 *
 * On a phone the summary panel sits below the whole form, so without this the
 * guest picks a room — or confirms the booking — without the price in sight.
 * Hidden on wider screens, where the summary is beside the form. Figures come
 * straight from the API's breakdown, as in the summary; nothing is computed.
 *
 * With no room chosen yet it says what the button needs instead, so pressing it
 * is never a surprise.
 */
function BarTotal({
  price,
  locale,
  hint,
}: {
  price: PriceBreakdown | null;
  locale: Locale;
  hint?: string;
}) {
  const t = useTranslations('reserve.summary');

  if (!price) {
    return hint ? (
      <span className={styles.barTotal}>
        <span className={styles.barHint}>{hint}</span>
      </span>
    ) : null;
  }

  return (
    <span className={styles.barTotal} data-testid="bar-total">
      <span className={styles.barLabel}>{t('total')}</span>
      <span className={styles.barAmount}>
        {formatMoney(price.grandTotal, price.currency, locale)}
      </span>
    </span>
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
              {/* A drawn tick, not the character U+2713. The `next/font`
                  faces are subset to `latin`, whose unicode-range stops well
                  short of the Dingbats block — and unicode-range decides
                  which characters a face is used for at all — so a literal ✓
                  is never set in Jost. It falls through to whatever symbol
                  font the OS happens to supply, which is Apple Symbols on
                  one machine and Segoe UI Symbol on the next. Drawn, it is
                  the same mark everywhere, and it matches the selection tick
                  on the room cards below. */}
              {done ? <span className={styles.stepTick} /> : item.step}
            </span>
            {item.label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * How many rooms an offer is for. An API from before multi-room offers sent
 * none, and offered one.
 */
function offeredRooms(room: AvailableRoomType): number {
  return room.roomsCount ?? 1;
}

/** Nothing on offer, and every room left out was left out for the party. */
function onlyOccupancy(
  available: AvailableRoomType[],
  unavailable: UnavailableRoomType[],
): boolean {
  return (
    available.length === 0 &&
    unavailable.length > 0 &&
    unavailable.every((room) => room.reason === 'occupancy')
  );
}

/**
 * A − / + counter.
 *
 * The label is visible and the buttons say what they change, so a screen
 * reader hears "Children, add" rather than a bare "plus".
 */
function Counter({
  id,
  label,
  hint,
  value,
  min,
  max,
  testId,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  testId?: string;
  onChange: (value: number) => void;
}) {
  const t = useTranslations('reserve.step1');
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel} id={`${id}-label`}>
        {label}
      </span>
      <div
        className={styles.counter}
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      >
        <button
          type="button"
          className={styles.counterBtn}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={t('decrease', { label })}
          data-testid={testId ? `${testId}-decrease` : undefined}
        >
          −
        </button>
        <span
          className={styles.counterValue}
          aria-live="polite"
          data-testid={testId ? `${testId}-count` : undefined}
        >
          {value}
        </span>
        <button
          type="button"
          className={styles.counterBtn}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={t('increase', { label })}
          data-testid={testId ? `${testId}-increase` : undefined}
        >
          +
        </button>
      </div>
      <span className={styles.counterHint} id={`${id}-hint`}>
        {hint}
      </span>
    </div>
  );
}

/**
 * The room a guest arrived with, at the top of step 1.
 *
 * Without it a guest who pressed "Reserve" on a room lands on a date picker
 * with no sign their choice was kept. It states the room's capacity because
 * that is the one thing about it the next two fields can contradict.
 */
function ChosenRoomCard({
  room,
  locale,
  onChange,
}: {
  room: RoomType;
  locale: Locale;
  onChange: () => void;
}) {
  const t = useTranslations('reserve.step1');
  const tPhoto = useTranslations('photos');
  const maxAdults = room.maxAdults ?? room.maxOccupancy;

  return (
    <section
      className={styles.chosenRoom}
      aria-label={t('yourRoom')}
      data-testid="chosen-room"
    >
      <div
        // `roomSwatch` for its gradients, which stand in until a photograph
        // loads and stay when there is none; `chosenRoomPhoto` sizes it.
        className={`${styles.roomSwatch} ${styles.chosenRoomPhoto}`}
        data-swatch={room.imageKey}
      >
        <Photo
          photo={resolveRoomPhoto(
            room,
            locale,
            tPhoto('room', { name: room.name[locale] }),
          )}
          sizes="120px"
        />
      </div>
      <div className={styles.chosenRoomText}>
        <span className={styles.roomCategory}>{t('yourRoom')}</span>
        <span className={styles.roomName}>{room.name[locale]}</span>
        <span className={styles.roomMeta}>
          {maxAdults < room.maxOccupancy
            ? t('capacityWithAdults', {
                sleeps: room.maxOccupancy,
                adults: maxAdults,
              })
            : t('capacity', { sleeps: room.maxOccupancy })}
        </span>
      </div>
      <button
        type="button"
        className={styles.chosenRoomChange}
        onClick={onChange}
        data-testid="change-room"
      >
        {t('changeRoom')}
      </button>
    </section>
  );
}

/** Four squares: the grid view. */
function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5h-4.5zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5h-4.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

/** Three rows, each a thumbnail and a line: the list view. */
function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M2.5 3h3v2.5h-3zM2.5 6.75h3v2.5h-3zM2.5 10.5h3v2.5h-3zM7.5 4.25h6M7.5 8h6M7.5 11.75h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

'use client';

/**
 * Booking state, persisted for the length of the browser session.
 *
 * The `booking-engine` skill requires progress to survive navigating away — a
 * guest who opens the Rooms page mid-booking to compare, then comes back, must
 * not lose their dates.
 *
 * `sessionStorage` rather than `localStorage` on purpose: a half-finished
 * booking is not something to resurrect weeks later on a shared machine, and
 * stale dates would silently become dates in the past.
 *
 * Note what is *not* stored: no price, and no availability. Both are the API's
 * to state (`pms-readiness`), and a cached price is a price that can be wrong.
 *
 * Initial state has two sources — saved progress, and the query string a home
 * page search arrives with. Both are resolved here, because "what stay is this
 * flow starting from" is one question and should not have two answers in two
 * components.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  MAX_CHILDREN,
  MAX_CHILD_AGE,
  readRoomCode,
  readStayQuery,
  todayInDubai,
} from '@/lib/stay-dates';
import type { Locale } from '@/lib/api/types';

export type Step = 1 | 2 | 3;

export interface GuestForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface BookingState {
  step: Step;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  /**
   * One entry per child, `null` until the guest picks that child's age. The
   * count of children is this array's length, so the two cannot disagree.
   */
  childAges: Array<number | null>;
  roomsCount: number;
  roomTypeCode: string | null;
  guest: GuestForm;
  specialRequests: string;
}

const STORAGE_KEY = 'cove-booking-progress';

export const initialBookingState: BookingState = {
  step: 1,
  checkIn: null,
  checkOut: null,
  adults: 2,
  childAges: [],
  roomsCount: 1,
  roomTypeCode: null,
  guest: { firstName: '', lastName: '', email: '', phone: '' },
  specialRequests: '',
};

/**
 * Restore saved progress, discarding anything unusable.
 *
 * Dates are re-checked against today because a session can outlive them: a
 * guest who leaves a tab open overnight would otherwise come back to a booking
 * for yesterday, which the API would reject with an error they cannot act on.
 */
function restore(): BookingState {
  if (typeof window === 'undefined') return initialBookingState;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return initialBookingState;

    const saved = JSON.parse(raw) as Partial<BookingState>;
    const state: BookingState = {
      ...initialBookingState,
      ...saved,
      childAges: restoreChildAges(saved.childAges),
    };

    const today = todayInDubai();
    if (state.checkIn && state.checkIn < today) {
      return {
        ...initialBookingState,
        adults: state.adults,
        childAges: state.childAges,
        guest: state.guest,
      };
    }

    // Never restore straight into a later step without the data that step
    // depends on, which would render an empty room list or an unpriced summary.
    if (state.step > 1 && (!state.checkIn || !state.checkOut)) state.step = 1;
    if (state.step > 2 && !state.roomTypeCode) state.step = 2;

    return state;
  } catch {
    // Corrupt or tampered storage should never break the booking flow.
    return initialBookingState;
  }
}

/**
 * Child ages from storage, keeping only entries that could have been entered.
 *
 * Progress saved before ages were asked has no `childAges` at all — those
 * sessions never had a way to add a child, so an empty list is exactly right.
 */
function restoreChildAges(saved: unknown): Array<number | null> {
  if (!Array.isArray(saved)) return [];
  return saved
    .slice(0, MAX_CHILDREN)
    .map((age) =>
      Number.isInteger(age) && age >= 0 && age <= MAX_CHILD_AGE
        ? (age as number)
        : null,
    );
}

/**
 * Apply a stay handed over in the query string, e.g. from the home page search.
 *
 * **The link wins over saved progress.** Someone who has just searched for
 * March is telling us more about what they want than a draft from earlier in
 * the session, and silently ignoring the dates they picked reads as a bug.
 * Because that replaces the stay, it also drops the room chosen against the old
 * one: a room selected for different dates may not even be available for these.
 *
 * `?room=` then names a room to start from — the offers page and the room
 * detail page both link in that way. It is applied *after* the stay for exactly
 * the reason above: a new stay clears the old room, and the room this link
 * carries was chosen against the dates it carries, so it must survive that
 * clearing rather than be swept up by it.
 *
 * Validation lives in `readStayQuery` and `readRoomCode` — both pure, and both
 * tested.
 */
function applyStayFromParams(
  state: BookingState,
  params: URLSearchParams,
): BookingState {
  const stay = readStayQuery(params, todayInDubai());
  const next = { ...state };

  if (stay.adults !== null) next.adults = stay.adults;

  if (stay.checkIn && stay.checkOut) {
    next.checkIn = stay.checkIn;
    next.checkOut = stay.checkOut;
    next.roomTypeCode = null;
    // The party comes with the stay. A search states its children — none, if
    // it carries no ages — so a draft's children from earlier in the session
    // must not ride along into a search the guest made without them.
    next.childAges = stay.childAges ?? [];
    // A link carrying a stay has settled step 1 already: the guest picked
    // those dates and pressed "Check availability" to get here. Landing them on
    // the date picker with the dates filled in made them press it a second
    // time. Step 2 fetches availability for these dates as soon as it opens,
    // with no rooms loaded, so the room list simply arrives.
    //
    // Unless the children could not be read: then the guest is shown step 1
    // to state them again, rather than a room list for a party without them.
    next.step = stay.childAges === null ? 1 : 2;
  }

  // `?room=` then pre-selects a room — the room page, the rooms list and the
  // offers page all link this way. A guest arriving with one has already
  // chosen, so the flow does not ask again: step 1 shows the room, and when
  // availability confirms it fits the party for those dates the flow goes
  // straight to their details (`ReserveFlow`).
  //
  // Always step 1, even with dates: who is staying — and how old the
  // children are — decides whether the room fits at all, and no link carries
  // that. Landing past it would skip the one question the room choice still
  // depends on.
  //
  // Nothing is taken on trust by doing this. Availability is re-checked for
  // the dates, and a room the API does not offer drops the guest onto the room
  // list with the reason, rather than carrying a phantom room into the
  // guest's details.
  const room = readRoomCode(params.get('room'));
  if (room) {
    next.roomTypeCode = room;
    next.step = 1;
  }

  return next;
}

export function useBookingState(locale: Locale) {
  // Always start from the default so the server and first client render agree;
  // restoring during render would cause a hydration mismatch.
  const [state, setState] = useState<BookingState>(initialBookingState);
  const [restored, setRestored] = useState(false);

  const searchParams = useSearchParams();

  // Read once, on mount. Held in a ref so that a later navigation which changes
  // the query string cannot reach back in and overwrite dates the guest has
  // since edited by hand.
  const initialParams = useRef(searchParams);

  useEffect(() => {
    setState(
      applyStayFromParams(
        restore(),
        new URLSearchParams(initialParams.current.toString()),
      ),
    );
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private browsing can refuse writes. Losing persistence is acceptable;
      // breaking the booking is not.
    }
  }, [state, restored]);

  const update = useCallback((patch: Partial<BookingState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const updateGuest = useCallback((patch: Partial<GuestForm>) => {
    setState((current) => ({
      ...current,
      guest: { ...current.guest, ...patch },
    }));
  }, []);

  const clear = useCallback(() => {
    setState(initialBookingState);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { state, update, updateGuest, clear, restored, locale };
}

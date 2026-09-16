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

import { readRoomCode, readStayQuery, todayInDubai } from '@/lib/stay-dates';
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
  children: number;
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
  children: 0,
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
    const state: BookingState = { ...initialBookingState, ...saved };

    const today = todayInDubai();
    if (state.checkIn && state.checkIn < today) {
      return {
        ...initialBookingState,
        adults: state.adults,
        children: state.children,
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
    next.step = 1;
  }

  const room = readRoomCode(params.get('room'));
  if (room) {
    next.roomTypeCode = room;

    // A link carrying both a stay and a room has settled step 1 already: the
    // guest picked those dates and then chose a room against them, so opening
    // on the date picker asks a question they have answered. With only a room
    // — the offers page, which has no dates to give — step 1 is still where
    // they have to start, and the room simply arrives pre-selected.
    //
    // Nothing is taken on trust by doing this. Step 2 re-checks availability
    // for these dates, and the guard there drops a room the API does not offer,
    // so a stale or invented link lands on the room list rather than carrying a
    // phantom room into the guest's details.
    if (next.checkIn && next.checkOut) next.step = 2;
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

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
 */
import { useCallback, useEffect, useState } from 'react';

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

/** Today in Dubai, as YYYY-MM-DD. */
function todayInDubai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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

export function useBookingState(locale: Locale) {
  // Always start from the default so the server and first client render agree;
  // restoring during render would cause a hydration mismatch.
  const [state, setState] = useState<BookingState>(initialBookingState);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    setState(restore());
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

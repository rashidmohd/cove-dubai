/**
 * The guest-account API client — browser only.
 *
 * Separate from `bookingApi` because it carries a session: every call sends
 * the guest cookie (`credentials: 'include'`, needed cross-origin on Railway)
 * and attaches the CSRF token to writes. Separate from `adminApi` because the
 * two sessions have nothing to do with each other, by design.
 */
import { publicConfig } from '../config';
import { ApiError } from './client';
import type { ApiErrorCode, Locale, Reservation } from './types';

export interface GuestAccount {
  email: string;
  firstName: string;
  lastName: string;
  locale: Locale;
  /** Bookings stay hidden until this is true. */
  emailVerified: boolean;
}

/** Refreshed by `login` and `getSession`, the only two ways a session begins. */
let csrfToken: string | null = null;

async function request<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';

  let response: Response;
  try {
    response = await fetch(`${publicConfig.apiUrl}/api/account${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (cause) {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the booking service.', 0, {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    } | null;
    throw new ApiError(
      (payload?.error?.code as ApiErrorCode) ?? 'INTERNAL_ERROR',
      payload?.error?.message ?? 'The booking service returned an error.',
      response.status,
      payload?.error?.details,
    );
  }

  return (await response.json()) as T;
}

export const accountApi = {
  /**
   * Always resolves the same way, whether or not the address already has an
   * account — the email that follows is what differs. The page must say
   * "check your inbox" either way.
   */
  async register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    locale: Locale;
  }): Promise<void> {
    await request('/register', { method: 'POST', body: input });
  },

  async verify(token: string): Promise<GuestAccount> {
    const data = await request<{ account: GuestAccount }>('/verify', {
      method: 'POST',
      body: { token },
    });
    return data.account;
  },

  async login(email: string, password: string): Promise<GuestAccount> {
    const data = await request<{ account: GuestAccount; csrfToken: string }>(
      '/login',
      { method: 'POST', body: { email, password } },
    );
    csrfToken = data.csrfToken;
    return data.account;
  },

  /** Who is signed in, or an `ApiError` with status 401 when nobody is. */
  async getSession(): Promise<GuestAccount> {
    const data = await request<{ account: GuestAccount; csrfToken: string }>(
      '/session',
    );
    csrfToken = data.csrfToken;
    return data.account;
  },

  async logout(): Promise<void> {
    try {
      await request('/logout', { method: 'POST' });
    } finally {
      csrfToken = null;
    }
  },

  async resendVerification(): Promise<void> {
    await request('/verification', { method: 'POST' });
  },

  /** Resolves the same way for any address, like `register`. */
  async requestPasswordReset(email: string, locale: Locale): Promise<void> {
    await request('/password-reset/request', {
      method: 'POST',
      body: { email, locale },
    });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await request('/password-reset', { method: 'POST', body: { token, password } });
  },

  async listReservations(): Promise<Reservation[]> {
    const data = await request<{ reservations: Reservation[] }>('/reservations');
    return data.reservations;
  },
};

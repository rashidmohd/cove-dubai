/**
 * The booking API client.
 *
 * **This is the only way `web` reaches data.** The front-end never touches the
 * database, never imports Prisma, and never contains booking, pricing, or
 * availability logic — all of that lives behind the API's `BookingProvider` so
 * a future PMS can own it (`pms-readiness`).
 *
 * The client is usable from both sides of the app:
 *   - Server Components and `generateMetadata` reach the API at
 *     `INTERNAL_API_URL`, which on AWS is a private address.
 *   - The browser reaches it at `NEXT_PUBLIC_API_URL`, the public one.
 *
 * `resolveBaseUrl` picks the right one, so callers never think about it.
 */
import { getServerConfig, publicConfig } from '../config';
import type {
  ApiErrorCode,
  AvailableRoomType,
  CreateReservationInput,
  IsoDate,
  Offer,
  PriceBreakdown,
  Reservation,
  RoomType,
  VoucherPreview,
} from './types';

/**
 * A failed API call.
 *
 * Carries the machine-readable `code` so the UI can show a specific translated
 * message — an unavailable room reads very differently to a network failure —
 * without parsing the server's prose.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function resolveBaseUrl(): string {
  // `window` is the reliable signal here: the same module is bundled for both
  // environments, and only the browser can use the public URL.
  return typeof window === 'undefined'
    ? getServerConfig().apiUrl
    : publicConfig.apiUrl;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Passed to Next's fetch cache. Availability must never be cached. */
  cache?: RequestCache;
  revalidate?: number | false;
  signal?: AbortSignal;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${resolveBaseUrl()}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.revalidate !== undefined
        ? { next: { revalidate: options.revalidate } }
        : {}),
    });
  } catch (cause) {
    // The API was unreachable — DNS, TLS, connection refused, offline. This is
    // a distinct condition from the API rejecting the request, and the booking
    // flow must be able to tell the guest so.
    throw new ApiError(
      'NETWORK_ERROR',
      'Could not reach the booking service.',
      0,
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
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

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

export const bookingApi = {
  /**
   * Room types for the marketing and rooms pages.
   *
   * Cached for an hour: this changes only when the hotel edits a room in the
   * admin panel, and marketing pages are statically rendered.
   */
  async getRoomTypes(): Promise<RoomType[]> {
    const data = await request<{ roomTypes: RoomType[] }>('/api/room-types', {
      revalidate: 3600,
    });
    return data.roomTypes;
  },

  /**
   * The offers the hotel is advertising.
   *
   * Cached like room types: this changes when the hotel edits a rate plan, not
   * per request. Expiry is enforced by the API's query rather than by cache
   * lifetime, so a stale cache cannot advertise a finished offer beyond this
   * window.
   */
  async getOffers(): Promise<Offer[]> {
    const data = await request<{ offers: Offer[] }>('/api/offers', {
      revalidate: 3600,
    });
    return data.offers;
  },

  /**
   * Live availability for a stay.
   *
   * Never cached. A cached availability response would show a guest a room that
   * has already gone.
   */
  async checkAvailability(args: {
    checkIn: IsoDate;
    checkOut: IsoDate;
    adults: number;
    children?: number;
    roomsCount?: number;
    signal?: AbortSignal;
  }): Promise<AvailableRoomType[]> {
    const data = await request<{ roomTypes: AvailableRoomType[] }>(
      `/api/availability?${query({
        checkIn: args.checkIn,
        checkOut: args.checkOut,
        adults: args.adults,
        children: args.children ?? 0,
        roomsCount: args.roomsCount ?? 1,
      })}`,
      { cache: 'no-store', ...(args.signal ? { signal: args.signal } : {}) },
    );
    return data.roomTypes;
  },

  async getRate(args: {
    roomTypeCode: string;
    checkIn: IsoDate;
    checkOut: IsoDate;
    roomsCount?: number;
  }): Promise<PriceBreakdown> {
    const data = await request<{ price: PriceBreakdown }>(
      `/api/rates?${query({ ...args, roomsCount: args.roomsCount ?? 1 })}`,
      { cache: 'no-store' },
    );
    return data.price;
  },

  async createReservation(
    input: CreateReservationInput,
  ): Promise<Reservation> {
    const data = await request<{ reservation: Reservation }>(
      '/api/reservations',
      { method: 'POST', body: input, cache: 'no-store' },
    );
    return data.reservation;
  },

  /**
   * What a discount code is worth for this stay, without claiming it.
   *
   * Advisory in the same way availability is: the code can still be exhausted
   * by the time the booking commits, and `createReservation` is the authority.
   */
  async previewVoucher(args: {
    code: string;
    roomTypeCode: string;
    checkIn: IsoDate;
    checkOut: IsoDate;
    roomsCount?: number;
  }): Promise<VoucherPreview> {
    const data = await request<{ preview: VoucherPreview }>(
      '/api/vouchers/preview',
      { method: 'POST', body: args, cache: 'no-store' },
    );
    return data.preview;
  },

  async getReservation(reference: string): Promise<Reservation> {
    const data = await request<{ reservation: Reservation }>(
      `/api/reservations/${encodeURIComponent(reference)}`,
      { cache: 'no-store' },
    );
    return data.reservation;
  },

  async cancelReservation(
    reference: string,
    token: string,
  ): Promise<Reservation> {
    const data = await request<{ reservation: Reservation }>(
      `/api/reservations/${encodeURIComponent(reference)}/cancel`,
      { method: 'POST', body: { token }, cache: 'no-store' },
    );
    return data.reservation;
  },
};

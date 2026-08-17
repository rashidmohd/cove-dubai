/**
 * The admin API client.
 *
 * Browser-only, unlike the guest client. Admin requests carry a session cookie
 * and a CSRF token, and neither is available to a Server Component — so every
 * admin screen fetches its own data on the client and there is nothing to
 * prerender. That suits the panel: none of it should be cached, indexed, or
 * statically built.
 *
 * Two things every mutating call needs:
 *
 *   - `credentials: 'include'`. On Railway the API is a different origin from
 *     the site, so without this the browser sends no cookie at all and every
 *     request looks anonymous. This is the single most common way the panel
 *     "works locally and fails on staging".
 *   - The `X-CSRF-Token` header. The server holds the matching value in the
 *     session; a cross-site page can trigger the request but cannot read the
 *     token to attach it.
 *
 * Like `lib/api/types.ts`, these types mirror the server's domain types by hand
 * — `web` and `server` are separate npm projects with no shared package.
 */
import { publicConfig } from '../config';
import { ApiError } from './client';
import type {
  Amenity,
  AmenityCategory,
  ApiErrorCode,
  IsoDate,
  LocalizedText,
  Reservation,
  ReservationStatus,
  RoomType,
} from './types';

export type AdminRole = 'ADMIN' | 'STAFF';

export interface AdminIdentity {
  email: string;
  name: string;
  role: AdminRole;
}

export interface AdminRoomType extends RoomType {
  isActive: boolean;
  totalRooms: number;
}

export interface AdminAmenity extends Amenity {
  isActive: boolean;
  sortOrder: number;
  /** How many room types list it. Zero is the only safe state to delete from. */
  roomTypeCount: number;
}

export interface InventoryDay {
  date: IsoDate;
  totalRooms: number;
  bookedRooms: number;
  isClosed: boolean;
}

export interface InventoryCalendar {
  roomTypeCode: string;
  from: IsoDate;
  to: IsoDate;
  days: InventoryDay[];
}

export interface OperationalSetting {
  key: string;
  value: string;
  description: string;
  updatedAt: string;
}

export interface OccupancyDay {
  date: IsoDate;
  roomsAvailable: number;
  roomsBooked: number;
  occupancyPercent: number;
}

export interface OccupancyReport {
  from: IsoDate;
  to: IsoDate;
  days: OccupancyDay[];
  revenueTotal: number;
  currency: string;
}

export interface AdminDashboard {
  date: IsoDate;
  admin: AdminIdentity;
  arrivals: Reservation[];
  departures: Reservation[];
  occupancyToday: OccupancyDay | null;
  recentReservations: Reservation[];
  totalReservations: number;
}

export interface ReservationListFilter {
  status?: ReservationStatus;
  roomTypeCode?: string;
  from?: IsoDate;
  to?: IsoDate;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
  admin: { email: string; name: string } | null;
}

/**
 * The CSRF token for the current session.
 *
 * Held in a module variable rather than React state so that any call site can
 * reach it without threading it through props. It is refreshed by `login` and
 * `getSession`, which are the only two ways a session begins.
 */
let csrfToken: string | null = null;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';

  let response: Response;
  try {
    response = await fetch(`${publicConfig.apiUrl}${path}`, {
      method,
      // Without this the session cookie is not sent cross-origin.
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken && method !== 'GET'
          ? { 'X-CSRF-Token': csrfToken }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch (cause) {
    throw new ApiError(
      'NETWORK_ERROR',
      'Could not reach the booking service.',
      0,
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, unknown>;
      };
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

export const adminApi = {
  // --- Session -------------------------------------------------------------

  async login(email: string, password: string): Promise<AdminIdentity> {
    const data = await request<{
      admin: AdminIdentity;
      csrfToken: string;
    }>('/api/auth/login', { method: 'POST', body: { email, password } });

    csrfToken = data.csrfToken;
    return data.admin;
  },

  /** Who is signed in, or an `ApiError` with status 401 if nobody is. */
  async getSession(): Promise<AdminIdentity> {
    const data = await request<{
      admin: AdminIdentity;
      csrfToken: string;
    }>('/api/auth/session');

    // Re-issued on every page load: the token lives in the session, and the
    // page cannot read it from a cookie.
    csrfToken = data.csrfToken;
    return data.admin;
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      // Drop the token even if the call failed, so a stale one is never
      // attached to a later request.
      csrfToken = null;
    }
  },

  // --- Dashboard and reservations -----------------------------------------

  getDashboard(): Promise<AdminDashboard> {
    return request<AdminDashboard>('/api/admin/dashboard');
  },

  listReservations(
    filter: ReservationListFilter = {},
  ): Promise<{ reservations: Reservation[]; total: number }> {
    return request(`/api/admin/reservations${query({ ...filter })}`);
  },

  async cancelReservation(
    reference: string,
    reason?: string,
  ): Promise<Reservation> {
    const data = await request<{ reservation: Reservation }>(
      `/api/admin/reservations/${encodeURIComponent(reference)}/cancel`,
      { method: 'POST', body: reason ? { reason } : {} },
    );
    return data.reservation;
  },

  async setReservationStatus(
    reference: string,
    action: 'check-in' | 'check-out',
  ): Promise<Reservation> {
    const data = await request<{ reservation: Reservation }>(
      `/api/admin/reservations/${encodeURIComponent(reference)}/${action}`,
      { method: 'POST' },
    );
    return data.reservation;
  },

  // --- Room types ----------------------------------------------------------

  async listRoomTypes(): Promise<AdminRoomType[]> {
    const data = await request<{ roomTypes: AdminRoomType[] }>(
      '/api/admin/room-types',
    );
    return data.roomTypes;
  },

  async updateRoomType(
    code: string,
    changes: {
      name?: LocalizedText;
      category?: LocalizedText;
      description?: LocalizedText;
      maxOccupancy?: number;
      baseRate?: number;
      isActive?: boolean;
    },
  ): Promise<AdminRoomType> {
    const data = await request<{ roomType: AdminRoomType }>(
      `/api/admin/room-types/${encodeURIComponent(code)}`,
      { method: 'PATCH', body: changes },
    );
    return data.roomType;
  },

  // --- Amenities -----------------------------------------------------------

  async listAmenities(): Promise<AdminAmenity[]> {
    const data = await request<{ amenities: AdminAmenity[] }>(
      '/api/admin/amenities',
    );
    return data.amenities;
  },

  async createAmenity(draft: {
    code: string;
    otaCode?: number | null;
    name: LocalizedText;
    category: AmenityCategory;
    sortOrder?: number;
  }): Promise<AdminAmenity> {
    const data = await request<{ amenity: AdminAmenity }>(
      '/api/admin/amenities',
      { method: 'POST', body: draft },
    );
    return data.amenity;
  },

  async updateAmenity(
    code: string,
    changes: {
      otaCode?: number | null;
      name?: LocalizedText;
      category?: AmenityCategory;
      sortOrder?: number;
      isActive?: boolean;
    },
  ): Promise<AdminAmenity> {
    const data = await request<{ amenity: AdminAmenity }>(
      `/api/admin/amenities/${encodeURIComponent(code)}`,
      { method: 'PATCH', body: changes },
    );
    return data.amenity;
  },

  async deleteAmenity(code: string): Promise<void> {
    await request(`/api/admin/amenities/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    });
  },

  /** Replace the whole list for one room type. An empty array clears it. */
  async setRoomTypeAmenities(
    roomTypeCode: string,
    amenityCodes: string[],
  ): Promise<AdminRoomType> {
    const data = await request<{ roomType: AdminRoomType }>(
      `/api/admin/room-types/${encodeURIComponent(roomTypeCode)}/amenities`,
      { method: 'PUT', body: { amenityCodes } },
    );
    return data.roomType;
  },

  // --- Availability calendar ----------------------------------------------

  getInventory(args: {
    roomTypeCode: string;
    from: IsoDate;
    to: IsoDate;
  }): Promise<InventoryCalendar> {
    return request(
      `/api/admin/room-types/${encodeURIComponent(args.roomTypeCode)}/inventory${query(
        { from: args.from, to: args.to },
      )}`,
    );
  },

  updateInventory(args: {
    roomTypeCode: string;
    from: IsoDate;
    to: IsoDate;
    totalRooms?: number;
    isClosed?: boolean;
  }): Promise<InventoryCalendar> {
    const { roomTypeCode, ...body } = args;
    return request(
      `/api/admin/room-types/${encodeURIComponent(roomTypeCode)}/inventory`,
      { method: 'PATCH', body },
    );
  },

  // --- Reports and settings ------------------------------------------------

  getOccupancy(args: { from: IsoDate; to: IsoDate }): Promise<OccupancyReport> {
    return request(`/api/admin/reports/occupancy${query({ ...args })}`);
  },

  async listSettings(): Promise<OperationalSetting[]> {
    const data = await request<{ settings: OperationalSetting[] }>(
      '/api/admin/settings',
    );
    return data.settings;
  },

  async updateSetting(
    key: string,
    value: string,
  ): Promise<OperationalSetting> {
    const data = await request<{ setting: OperationalSetting }>(
      `/api/admin/settings/${encodeURIComponent(key)}`,
      { method: 'PATCH', body: { value } },
    );
    return data.setting;
  },

  async listAuditLog(
    args: { limit?: number; offset?: number } = {},
  ): Promise<{ entries: AuditEntry[]; total: number }> {
    return request(`/api/admin/audit-log${query({ ...args })}`);
  },
};

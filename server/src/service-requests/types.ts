/**
 * Domain types for spa and dining requests.
 *
 * The shapes the API speaks, independent of the tables underneath — the same
 * discipline as `booking/types.ts`. No row id appears in any of them: an
 * offering is named by its kind and code, a request by its reference.
 */
import type { IsoDate, LocalizedText } from '../booking/types.js';

export type ServiceKindName = 'spa' | 'dining';

export type ServiceRequestStatusName = 'new' | 'confirmed' | 'declined' | 'cancelled';

/** A spa treatment or a restaurant, as a guest sees it. */
export interface Offering {
  kind: ServiceKindName;
  code: string;
  name: LocalizedText;
  description: LocalizedText | null;
  /** Spa treatments only. */
  durationMinutes: number | null;
  /** Spa treatments only — shown, paid at the hotel. */
  price: number | null;
  currency: 'AED';
  /** Every time a guest may ask for, `HH:MM`, half-hourly. */
  slots: string[];
  maxGuests: number;
}

/** An offering as the admin sees it. */
export interface AdminOffering extends Offering {
  firstSlot: string;
  lastSlot: string;
  sortOrder: number;
  isActive: boolean;
  /** How many requests name it — the delete guard. */
  requestCount: number;
}

export interface OfferingDraft {
  code: string;
  name: LocalizedText;
  description?: LocalizedText | null | undefined;
  durationMinutes?: number | null | undefined;
  price?: number | null | undefined;
  firstSlot: string;
  lastSlot: string;
  maxGuests?: number | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

export interface OfferingChanges {
  name?: LocalizedText | undefined;
  description?: LocalizedText | null | undefined;
  durationMinutes?: number | null | undefined;
  price?: number | null | undefined;
  firstSlot?: string | undefined;
  lastSlot?: string | undefined;
  maxGuests?: number | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

export interface ServiceRequestDraft {
  offeringCode: string;
  preferredDate: IsoDate;
  preferredTime: string;
  guests: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes?: string | undefined;
  locale: 'en' | 'ar';
}

export interface ServiceRequestRecord {
  reference: string;
  kind: ServiceKindName;
  offering: { code: string; name: LocalizedText };
  preferredDate: IsoDate;
  preferredTime: string;
  guests: number;
  guest: { firstName: string; lastName: string; email: string; phone: string };
  notes: string | null;
  locale: 'en' | 'ar';
  status: ServiceRequestStatusName;
  /** Set once confirmed — may differ from the time asked for. */
  confirmedTime: string | null;
  /** The team's message to the guest, sent with the answer. */
  responseNote: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface ServiceRequestFilter {
  status?: ServiceRequestStatusName | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export type ServiceRequestErrorCode =
  | 'OFFERING_NOT_FOUND'
  | 'OFFERING_CODE_IN_USE'
  /** It has requests, so it is deactivated rather than deleted. */
  | 'OFFERING_IN_USE'
  /** A date in the past, a time it does not offer, too many guests. */
  | 'INVALID_SERVICE_REQUEST'
  | 'SERVICE_REQUEST_NOT_FOUND'
  /** Confirming a declined request, say. */
  | 'INVALID_REQUEST_TRANSITION';

export class ServiceRequestError extends Error {
  constructor(
    public readonly code: ServiceRequestErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceRequestError';
  }
}

/**
 * Photography: where the bytes live, and which photograph fills a slot.
 *
 * Two kinds of image reach the marketing pages, and they arrive by different
 * routes:
 *
 * 1. **Room photography** belongs to the database. A room type carries an
 *    `images[]` array built from `MediaAsset` rows the admin panel uploads, and
 *    that is always preferred — it is the route the client controls without a
 *    deploy.
 * 2. **The building itself** — lobby, reception, pool, gym, the facade — has no
 *    database row and no admin screen. Those are structural to the design, not
 *    editorial, so they are named here against object keys in the same bucket.
 *
 * `PROPERTY_PHOTOS` also stands in for room photography until the upload path
 * works end to end (see the R2 notes in `docs/project-status.md`), which is why
 * `resolveRoomPhoto` falls through the database, then this file, then the
 * `imageKey` gradient. A room type with no photograph anywhere still renders.
 *
 * **Keys, never absolute URLs**, for exactly the reason the server stores
 * `storageKey`: the public origin is configuration, so moving the bucket is an
 * environment variable rather than an edit to every call site.
 */
import { publicConfig } from '@/lib/config';

import type { Locale } from '@/i18n/routing';
import type { RoomImage, RoomType } from '@/lib/api/types';

/**
 * A photograph ready to render.
 *
 * `alt` is already resolved to one language. `RoomImage` carries both, but a
 * page renders in a single locale and its translation function only knows that
 * one, so resolving here keeps every call site from having to produce Arabic it
 * cannot reach.
 */
export interface Photograph {
  url: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * The object key for a property photograph, relative to the bucket root.
 *
 * Every current file is 2821x1596 except the facade, which was shot portrait.
 * The dimensions are recorded rather than inferred because the front-end has no
 * way to measure a remote image at build time, and unsized images are the usual
 * way a CLS budget is blown.
 */
interface PropertyPhoto {
  key: string;
  width: number;
  height: number;
}

const LANDSCAPE = { width: 2821, height: 1596 } as const;

/**
 * Every photograph the client has supplied, by the name the design refers to.
 *
 * Adding a file to the bucket does not publish it — it has to be named here and
 * placed in a slot. That is intentional: a bucket listing is not a design.
 */
export const PROPERTY_PHOTOS = {
  facade: { key: 'images/hotel.jpg', width: 1423, height: 1688 },
  entrance: { key: 'images/hotel-entrance.jpg', ...LANDSCAPE },
  lobby: { key: 'images/lobby.jpg', ...LANDSCAPE },
  lobbySeating: { key: 'images/lobby-2.jpg', ...LANDSCAPE },
  reception: { key: 'images/reception.jpg', ...LANDSCAPE },
  liftLobby: { key: 'images/lift-lobby.jpg', ...LANDSCAPE },
  restaurant: { key: 'images/restaurant.jpg', ...LANDSCAPE },
  restaurantTables: { key: 'images/restaurant-2.jpg', ...LANDSCAPE },
  // The pool was redesigned in the September 2026 renders, which are smaller
  // than the rest of the set.
  pool: { key: 'images/pool-3.jpg', width: 1755, height: 1170 },
  poolTerrace: { key: 'images/pool-4.jpg', width: 1755, height: 1170 },
  poolDusk: { key: 'images/pool-5.jpg', width: 1755, height: 1169 },
  // The rest of the September 2026 facility renders, for the Dining and
  // Wellness galleries. Where the set repeats a shot already above at 2821px,
  // the gallery uses that sharper file instead of adding a copy here.
  restaurantLong: { key: 'images/restaurant-3.jpg', width: 1755, height: 981 },
  restaurantColumns: { key: 'images/restaurant-4.jpg', width: 1755, height: 984 },
  restaurantMarble: { key: 'images/restaurant-5.jpg', width: 1755, height: 985 },
  restaurantHost: { key: 'images/restaurant-6.jpg', width: 1755, height: 975 },
  restaurantCorner: { key: 'images/restaurant-7.jpg', width: 1755, height: 977 },
  restaurantLength: { key: 'images/restaurant-8.jpg', width: 1755, height: 976 },
  loungeCafe: { key: 'images/lounge-1.jpg', width: 1752, height: 975 },
  loungeArmchairs: { key: 'images/lounge-2.jpg', width: 1755, height: 986 },
  loungeSofas: { key: 'images/lounge-3.jpg', width: 1750, height: 979 },
  gymNight: { key: 'images/gym-4.jpg', width: 1275, height: 711 },
  gymTreadmills: { key: 'images/gym-5.jpg', width: 1275, height: 849 },
  gymWeights: { key: 'images/gym-6.jpg', width: 1275, height: 848 },
  gym: { key: 'images/gym.jpg', ...LANDSCAPE },
  gymStudio: { key: 'images/gym-3.jpg', ...LANDSCAPE },
  roomTwin: { key: 'images/room.jpg', ...LANDSCAPE },
  roomDressing: { key: 'images/room-2.jpg', ...LANDSCAPE },
  suiteLounge: { key: 'images/room-3.jpg', ...LANDSCAPE },
  roomKing: { key: 'images/room-4.jpg', ...LANDSCAPE },
  roomPendant: { key: 'images/room-type-2.jpg', ...LANDSCAPE },
  roomDesk: { key: 'images/room-type-3.jpg', ...LANDSCAPE },
} as const satisfies Record<string, PropertyPhoto>;

export type PropertyPhotoName = keyof typeof PROPERTY_PHOTOS;

/**
 * Which photograph stands in for a room type that has no uploaded gallery.
 *
 * Keyed on `imageKey` rather than room code because `imageKey` is what the API
 * already sends for exactly this purpose — it is the existing "how should this
 * room look" channel, and the gradients are keyed the same way.
 */
const ROOM_PHOTO_BY_IMAGE_KEY: Record<string, PropertyPhotoName> = {
  'img-king': 'roomPendant',
  'img-twin': 'roomTwin',
  'img-suite': 'suiteLounge',
};

/**
 * Absolute URL for an object key, or null when no media origin is configured.
 *
 * Mirrors the server's `publicUrlFor`: a missing origin degrades the page to
 * its gradient rather than rendering a broken image, because a misconfigured
 * environment should not take the marketing site down.
 */
export function mediaUrl(key: string): string | null {
  const base = publicConfig.mediaBaseUrl;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

/** A named property photograph, ready to render, or null if unconfigured. */
export function propertyPhoto(
  name: PropertyPhotoName,
  alt: string,
): Photograph | null {
  const photo = PROPERTY_PHOTOS[name];
  const url = mediaUrl(photo.key);
  if (!url) return null;
  return { url, alt, width: photo.width, height: photo.height };
}

/**
 * The photograph for a room type, in order of authority.
 *
 * The database wins whenever it has something, so an upload through the admin
 * panel immediately replaces the stand-in without a deploy. `fallbackAlt` is
 * only consulted for the stand-in — an uploaded asset carries alt text the
 * client wrote, and that is always better than ours.
 */
export function resolveRoomPhoto(
  room: Pick<RoomType, 'imageKey'> & { images?: RoomImage[] },
  locale: Locale,
  fallbackAlt: string,
): Photograph | null {
  const uploaded = room.images?.[0];
  if (uploaded) {
    return {
      url: uploaded.url,
      alt: uploaded.alt[locale],
      width: uploaded.width,
      height: uploaded.height,
    };
  }

  const name = ROOM_PHOTO_BY_IMAGE_KEY[room.imageKey];
  if (!name) return null;
  return propertyPhoto(name, fallbackAlt);
}

/**
 * The first `limit` photographs of a room type's gallery, for a card that lets
 * a guest look around without leaving the list.
 *
 * Falls back to the single `resolveRoomPhoto` stand-in when nothing has been
 * uploaded, so a room type without a gallery still shows one picture.
 */
export function resolveRoomPhotos(
  room: Pick<RoomType, 'imageKey'> & { images?: RoomImage[] },
  locale: Locale,
  fallbackAlt: string,
  limit: number,
): Photograph[] {
  const uploaded = (room.images ?? []).slice(0, limit).map((image) => ({
    url: image.url,
    alt: image.alt[locale],
    width: image.width,
    height: image.height,
  }));
  if (uploaded.length > 0) return uploaded;

  const fallback = resolveRoomPhoto(room, locale, fallbackAlt);
  return fallback ? [fallback] : [];
}

'use client';

/**
 * What there is to know about a room.
 *
 * One component, two surfaces: the room page at `/rooms/[code]`, and the detail
 * dialog in step 2 of the booking flow. They frame it differently — a page has
 * a hero and a gallery, a dialog has a close button — but the substance is the
 * same, and a guest comparing rooms in the flow must not be shown *less* than
 * the page would have told them.
 *
 * A Client Component so the dialog can use it. That costs the room page a
 * little JavaScript it would not otherwise ship, which is the price of the two
 * surfaces not drifting apart — the alternative is the same description, spec
 * table and amenity list written twice, diverging the first time either is
 * edited.
 *
 * Presentational only: it fetches nothing and decides nothing. Both callers
 * already hold the room — the page from the cached room-type list, the dialog
 * from the availability response, which carries the full room type.
 */
import { useTranslations } from 'next-intl';

import type { Locale, RoomType } from '@/lib/api/types';
import { LTR_SPEC_KEYS, SPEC_KEYS } from '@/lib/room-specs';
import styles from './RoomDetail.module.css';

export function RoomDetailBody({
  room,
  locale,
  /**
   * The amenity list's heading level.
   *
   * The page puts this under an `h1`, the dialog under the room name in its own
   * `h2` — so the correct level differs, and a hardcoded one would break the
   * heading order on whichever surface lost. WCAG 2.1 AA is non-negotiable
   * here (CLAUDE.md), and heading order is part of it.
   */
  amenitiesHeading: Heading = 'h2',
}: {
  room: RoomType;
  locale: Locale;
  amenitiesHeading?: 'h2' | 'h3';
}) {
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');

  return (
    <>
      {/* Database text in either script — isolated so it cannot disturb the
          surrounding layout. */}
      <p className={styles.description}>
        <bdi>{room.description[locale]}</bdi>
      </p>

      <dl className={styles.specs}>
        {SPEC_KEYS.map((key) => {
          // Optional on purpose: a room added in the admin panel has no copy
          // here until the client writes it, and a missing spec must simply
          // not render rather than throw.
          const value = t.has(`specs.${room.code}.${key}`)
            ? t(`specs.${room.code}.${key}`)
            : null;
          if (!value) return null;

          return (
            <div key={key} className={styles.spec}>
              <dt className={styles.specLabel}>{t(`specLabels.${key}`)}</dt>
              <dd className={styles.specValue}>
                {/* `bdi` isolates the value so it cannot disturb the
                    surrounding text; `dir` pins the measurements that must
                    read left-to-right in both languages. */}
                <bdi
                  {...(LTR_SPEC_KEYS.has(key) ? { dir: 'ltr' as const } : {})}
                >
                  {value}
                </bdi>
              </dd>
            </div>
          );
        })}

        <div className={styles.spec}>
          <dt className={styles.specLabel}>{tCommon('adults')}</dt>
          <dd className={styles.specValue}>
            {t('sleeps', { count: room.maxOccupancy })}
          </dd>
        </div>
      </dl>

      {/* Amenities come from the API, so the hotel edits them in the admin
          panel rather than in a message file. The specs above are still prose
          in `messages/` — they have no standard vocabulary behind them.

          `?? []` is load-bearing, not defensive habit: room types are cached
          for an hour and the two services deploy independently, so a response
          predating this field is a normal state rather than a broken one, and
          reading `.length` off it directly throws. */}
      {(room.amenities ?? []).length > 0 ? (
        <div className={styles.amenities}>
          <Heading className={styles.amenitiesTitle}>
            {t('amenitiesTitle')}
          </Heading>
          <ul className={styles.amenityList}>
            {(room.amenities ?? []).map((amenity) => (
              <li key={amenity.code} className={styles.amenityItem}>
                <bdi>{amenity.name[locale]}</bdi>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

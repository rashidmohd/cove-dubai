'use client';

/**
 * A room card's photographs, one at a time.
 *
 * Deliberately restrained, because a carousel is easy to get wrong on a luxury
 * page:
 *
 * - **Never moves on its own.** The first photograph stays until the guest asks
 *   for the next; nothing slides while they are reading the price.
 * - **The browser does the moving.** The track is a CSS scroll-snap strip, so
 *   swiping on a phone, trackpad gestures, and right-to-left in Arabic are all
 *   native. The script only drives the two arrow buttons and the counter.
 * - **Quiet controls.** Arrows appear on hover or keyboard focus, and a small
 *   "1 / 5" counter stands in for a row of dots.
 * - **Only the first photograph is fetched up front.** The rest are lazy, and a
 *   horizontally scrolled-away image is not requested until it is nearly in
 *   view.
 *
 * With a single photograph it renders exactly what `Photo` would, and no
 * controls at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Photograph } from '@/lib/media';

import { Photo } from './Photo';
import styles from './RoomCarousel.module.css';

export function RoomCarousel({
  photos,
  sizes,
  label,
  labels,
  compact = false,
}: {
  photos: Photograph[];
  sizes: string;
  /** Smaller arrows and counter, for a thumbnail-sized slot. */
  compact?: boolean;
  /** Names the carousel for assistive technology — the room's name. */
  label: string;
  /** Already translated on the server; `{index}` and `{total}` in `slide`. */
  labels: { previous: string; next: string; slide: string };
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const total = photos.length;

  // `scrollLeft` is negative in a right-to-left scroller, so the magnitude is
  // what locates the current slide in either direction.
  const syncIndex = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setIndex(Math.round(Math.abs(track.scrollLeft) / track.clientWidth));
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || total < 2) return;
    track.addEventListener('scroll', syncIndex, { passive: true });
    return () => track.removeEventListener('scroll', syncIndex);
  }, [syncIndex, total]);

  const go = (step: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    // "Next" moves towards the end of the reading direction: leftwards in
    // Arabic.
    const rtl = getComputedStyle(track).direction === 'rtl';
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    track.scrollBy({
      left: step * (rtl ? -1 : 1) * track.clientWidth,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };

  if (total === 0) return null;
  if (total === 1) return <Photo photo={photos[0] ?? null} sizes={sizes} />;

  return (
    <div
      className={styles.carousel}
      data-compact={compact ? 'true' : undefined}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
    >
      <ul className={styles.track} ref={trackRef}>
        {photos.map((photo, i) => (
          <li
            key={photo.url}
            className={styles.slide}
            role="group"
            aria-roledescription="slide"
            aria-label={labels.slide
              .replace('{index}', String(i + 1))
              .replace('{total}', String(total))}
          >
            <Photo photo={photo} sizes={sizes} />
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={`${styles.arrow} ${styles.previous}`}
        onClick={() => go(-1)}
        disabled={index === 0}
        aria-label={labels.previous}
      >
        <Chevron />
      </button>
      <button
        type="button"
        className={`${styles.arrow} ${styles.next}`}
        onClick={() => go(1)}
        disabled={index >= total - 1}
        aria-label={labels.next}
      >
        <Chevron />
      </button>

      {/* Visual only: each slide already announces its own position. */}
      {/* `dir` on the numbers only: on the paragraph it would also flip which
          corner `inset-inline-end` places it in. */}
      <p className={styles.counter} aria-hidden="true">
        <bdi dir="ltr">
          {index + 1} / {total}
        </bdi>
      </p>
    </div>
  );
}

/** Points towards the end of the line; the stylesheet mirrors it as needed. */
function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M6 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

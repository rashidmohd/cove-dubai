'use client';

/**
 * A grid of photographs, and a full-screen viewer to look through them.
 *
 * Each tile is a button that opens the viewer on that photograph. The viewer
 * walks the **whole** set — including any photographs the grid skips via
 * `gridFrom`, such as a room's hero shown directly above — so a guest can
 * start anywhere and still see every picture.
 *
 * A native `<dialog>` with `showModal()`, as `RoomDetailDialog` and the admin
 * panel use: the focus trap, Escape and top-layer stacking come with it.
 *
 * Moving between photographs works the way `RoomCarousel` does — a CSS
 * scroll-snap strip, so swiping and right-to-left are native — plus the arrow
 * keys, which follow the reading direction.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { Photograph } from '@/lib/media';

import { Photo } from './Photo';
import styles from './PhotoGallery.module.css';

export function PhotoGallery({
  photos,
  label,
  gridFrom = 0,
}: {
  /** Every photograph the viewer can show, in order. */
  photos: Photograph[];
  /** What is being shown — a room's or a venue's name — for the viewer. */
  label: string;
  /** Leave the first photographs out of the grid, e.g. a hero shown above. */
  gridFrom?: number;
}) {
  const t = useTranslations('common.gallery');
  const tCommon = useTranslations('common');

  const dialogRef = useRef<HTMLDialogElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  /** Null while closed; otherwise the photograph to open on. */
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const total = photos.length;

  const slideLabel = (i: number) =>
    t('slide', { index: i + 1, total });

  // Open and close follow state, so Escape and the close button take the same
  // path and React never disagrees with the element about whether it is open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (openAt !== null && !dialog.open) dialog.showModal();
    if (openAt === null && dialog.open) dialog.close();
  }, [openAt]);

  // Jump — not scroll — to the photograph that was clicked, once the slides
  // are mounted and have a width.
  useEffect(() => {
    const track = trackRef.current;
    if (openAt === null || !track) return;
    const rtl = getComputedStyle(track).direction === 'rtl';
    track.scrollTo({
      left: (rtl ? -1 : 1) * openAt * track.clientWidth,
      behavior: 'instant',
    });
    setIndex(openAt);
  }, [openAt]);

  // The page behind should not scroll while the viewer is up.
  useEffect(() => {
    if (openAt === null) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [openAt]);

  const syncIndex = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setIndex(Math.round(Math.abs(track.scrollLeft) / track.clientWidth));
  }, []);

  const go = (step: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const rtl = getComputedStyle(track).direction === 'rtl';
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    track.scrollBy({
      left: step * (rtl ? -1 : 1) * track.clientWidth,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };

  const close = () => setOpenAt(null);

  const current = photos[index];

  return (
    <>
      <ul className={styles.grid}>
        {photos.slice(gridFrom).map((photo, i) => (
          <li key={photo.url} className={styles.tile}>
            <button
              type="button"
              className={styles.tileButton}
              onClick={() => setOpenAt(gridFrom + i)}
              aria-label={t('enlarge', { index: gridFrom + i + 1, total })}
              aria-haspopup="dialog"
            >
              <Photo photo={photo} sizes="(max-width: 900px) 100vw, 33vw" />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        className={styles.viewer}
        aria-label={label}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          // Handled here so a press is exactly one photograph, whichever
          // element has focus, rather than a native scroll of some distance.
          event.preventDefault();
          const rtl = document.documentElement.dir === 'rtl';
          const forward = (event.key === 'ArrowRight') !== rtl;
          if (forward && index < total - 1) go(1);
          if (!forward && index > 0) go(-1);
        }}
        data-testid="gallery-viewer"
      >
        {/* Mounted only while open, so a closed viewer holds no images in the
            page and nothing in the accessibility tree. */}
        {openAt !== null ? (
          <div className={styles.frame}>
            <div className={styles.bar}>
              <p className={styles.counter} aria-hidden="true">
                <bdi dir="ltr">
                  {index + 1} / {total}
                </bdi>
              </p>
              <button
                type="button"
                className={styles.close}
                onClick={close}
                aria-label={tCommon('close')}
                data-testid="gallery-close"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <ul
              className={styles.track}
              ref={trackRef}
              onScroll={syncIndex}
            >
              {photos.map((photo, i) => (
                <li
                  key={photo.url}
                  className={styles.slide}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={slideLabel(i)}
                  // Clicking the dark space around a photograph closes, as a
                  // backdrop click does on any other dialog.
                  onClick={(event) => {
                    if (event.target === event.currentTarget) close();
                  }}
                >
                  <div className={styles.image}>
                    <Photo photo={photo} sizes="100vw" />
                  </div>
                </li>
              ))}
            </ul>

            <button
              type="button"
              className={`${styles.arrow} ${styles.previous}`}
              onClick={() => go(-1)}
              disabled={index === 0}
              aria-label={t('previous')}
              data-testid="gallery-previous"
            >
              <Chevron />
            </button>
            <button
              type="button"
              className={`${styles.arrow} ${styles.next}`}
              onClick={() => go(1)}
              disabled={index >= total - 1}
              aria-label={t('next')}
              data-testid="gallery-next"
            >
              <Chevron />
            </button>

            {/* The alt text doubles as a caption: it was written to describe
                the photograph, which is exactly what a caption does. */}
            <p className={styles.caption} aria-live="polite">
              {current?.alt}
            </p>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

/** Points towards the end of the line; the stylesheet mirrors it as needed. */
function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
      <path
        d="M6 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

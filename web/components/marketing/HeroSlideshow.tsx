'use client';

/**
 * The home hero's photographs, one slowly giving way to the next.
 *
 * Restrained on purpose — the search bar is the most important thing on this
 * screen and nothing here should compete with it:
 *
 * - **Slow.** Each photograph holds for seven seconds and crossfades over
 *   nearly two, drifting in by a few per cent while it is shown.
 * - **No arrows, no dots.** One quiet pause/play button in the corner, which
 *   WCAG 2.2.2 requires for anything that moves on its own for more than five
 *   seconds.
 * - **Still for anyone who asked for less motion.** With
 *   `prefers-reduced-motion` the first photograph simply stays, and the button
 *   is not shown because there is nothing to pause.
 * - **Only the first photograph is urgent.** It loads with `priority` as the
 *   LCP element; each later one is mounted a slide ahead of being shown, so it
 *   is fetched in the background rather than competing with the first paint.
 *
 * It fills the hero's existing photo layer, beneath the scrim, so the headline
 * and the search sit exactly where they did over a single photograph.
 */
import { useEffect, useState } from 'react';

import type { Photograph } from '@/lib/media';

import { Photo } from './Photo';
import styles from './HeroSlideshow.module.css';

/** How long each photograph is shown, fade included. */
const HOLD_MS = 7000;

export function HeroSlideshow({
  photos,
  labels,
  toggleClassName,
}: {
  photos: Photograph[];
  labels: { pause: string; play: string };
  /** Moves the pause/play button where the hero's own content needs its corner. */
  toggleClassName?: string;
}) {
  const total = photos.length;
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  /** Slides mounted so far: the current one and the next, never all at once. */
  const [mounted, setMounted] = useState(Math.min(2, total));
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (total < 2 || paused || reducedMotion) return;
    const timer = window.setTimeout(() => {
      const next = (index + 1) % total;
      setPrevious(index);
      setIndex(next);
      // Mount the one after next now, so it has a full hold to download.
      setMounted((count) => Math.min(total, Math.max(count, next + 2)));
    }, HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, reducedMotion, total]);

  if (total === 0) return null;

  return (
    <>
      <div
        className={styles.slideshow}
        data-paused={paused || reducedMotion ? 'true' : undefined}
      >
        {photos.slice(0, mounted).map((photo, i) => {
          const state =
            i === index ? styles.active : i === previous ? styles.leaving : '';
          return (
            <div
              key={photo.url}
              className={`${styles.slide} ${state}`}
              // Only the photograph on screen is announced; the others are
              // there to fade to, not to be read.
              aria-hidden={i === index ? undefined : true}
            >
              <Photo photo={photo} sizes="100vw" priority={i === 0} />
            </div>
          );
        })}
      </div>

      {/* Outside the slides' own stacking context, so it sits above the
          hero's scrim and can be reached, rather than beneath it with them. */}
      {total > 1 && !reducedMotion ? (
        <button
          type="button"
          className={[styles.toggle, toggleClassName].filter(Boolean).join(' ')}
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? labels.play : labels.pause}
          data-testid="hero-slideshow-toggle"
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
      ) : null}
    </>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5 3v10M11 3v10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5 3l8 5-8 5z" fill="currentColor" />
    </svg>
  );
}

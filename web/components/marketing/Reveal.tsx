'use client';

/**
 * Scroll reveal — content fades up as it enters the viewport.
 *
 * One of the design system's four signature effects, staggered by ~120ms.
 *
 * Two things it deliberately does *not* do:
 *
 *   - It never hides content before JavaScript runs. The element starts in its
 *     normal, visible state and is only marked hidden once this component
 *     mounts. A CSS-first implementation (opacity: 0 by default) would leave
 *     the marketing pages blank if the bundle failed — and these are precisely
 *     the pages whose content must not depend on JS.
 *   - It does nothing at all when the visitor has asked for reduced motion:
 *     the observer is never created, so no element is ever hidden.
 */
import { useEffect, useRef, type ReactNode } from 'react';

import styles from './Marketing.module.css';

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Stagger, in milliseconds. The design system suggests ~120ms steps. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (prefersReducedMotion) return;

    // IntersectionObserver is universally supported now, but guarding costs
    // nothing and the failure mode would be permanently invisible content.
    if (typeof IntersectionObserver === 'undefined') return;

    // Only hide what is still below the fold.
    //
    // Hiding everything on mount made content already on screen flash —
    // rendered, then blanked, then faded back in — and left anything below the
    // fold invisible to any context that does not scroll: full-page
    // screenshots, print, and PDF export among them. An element the visitor can
    // already see has nothing to reveal, so it is simply left alone.
    const box = element.getBoundingClientRect();
    if (box.top < window.innerHeight) return;

    element.dataset['reveal'] = 'pending';

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          window.setTimeout(() => {
            target.dataset['reveal'] = 'shown';
          }, delay);
          observer.unobserve(target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={[styles.reveal, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}

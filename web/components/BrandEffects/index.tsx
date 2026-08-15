/**
 * The three signature brand effects, as reusable components.
 *
 * All are purely decorative and therefore hidden from assistive technology.
 * They are Server Components — none needs interactivity, so none ships JS.
 */
import type { CSSProperties } from 'react';

import styles from './BrandEffects.module.css';

interface WeaveProps {
  /** Mockups use 0.04–0.06 depending on the section. */
  opacity?: number;
  /** Cross-hatch spacing. Mockups use 18–22px. */
  gap?: number;
  className?: string;
}

/** Faint gold cross-hatch laid over a section. */
export function Weave({ opacity = 0.05, gap = 22, className }: WeaveProps) {
  return (
    <div
      aria-hidden="true"
      className={[styles.weave, className].filter(Boolean).join(' ')}
      style={
        {
          '--weave-opacity': opacity,
          '--weave-gap': `${gap}px`,
        } as CSSProperties
      }
    />
  );
}

interface GlowProps {
  width?: number;
  height?: number;
  /** Alpha of the gold at the centre of the radial. */
  strength?: number;
  /** Centre it in its container, rather than positioning it via className. */
  centre?: boolean;
  /**
   * Slowly pulse. Used behind the hero. Automatically disabled under
   * `prefers-reduced-motion`.
   */
  breathing?: boolean;
  className?: string;
}

/** Large soft radial that gives dark sections their warmth. */
export function Glow({
  width = 600,
  height = 300,
  strength = 0.08,
  centre = false,
  breathing = false,
  className,
}: GlowProps) {
  return (
    <div
      aria-hidden="true"
      className={[
        styles.glow,
        centre ? styles.glowCentre : null,
        breathing ? styles.breathing : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--glow-width': `${width}px`,
          '--glow-height': `${height}px`,
          '--glow-strength': strength,
        } as CSSProperties
      }
    />
  );
}

/**
 * Oversized ghost monogram fixed behind the page.
 *
 * The letter is decorative: it is the brand mark rendered as texture, not
 * content, so it must not be announced. Screen readers would otherwise read a
 * stray "C" on every page.
 */
export function GhostMonogram({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={[styles.ghost, className].filter(Boolean).join(' ')}
    >
      C
    </div>
  );
}

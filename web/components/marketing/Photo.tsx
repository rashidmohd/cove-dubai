/**
 * A photograph filling a design slot.
 *
 * Every image slot on the marketing pages was drawn as a gradient rectangle
 * whose size comes from the layout — an aspect ratio, or a grid row. This
 * component drops a photograph into one of those rectangles without changing
 * its size, which is why it uses `fill` rather than intrinsic `width`/`height`:
 * the slot already reserves the space, so there is nothing to shift and the CLS
 * budget in CLAUDE.md is met by the CSS rather than by the image.
 *
 * **The gradient stays underneath.** It is the loading state and the failure
 * state at once — an unconfigured media origin, a 404 from the bucket, a photo
 * the client has not supplied yet — so no slot is ever empty.
 *
 * A Server Component: `next/image` renders to a plain `<img>` with a `srcset`,
 * and nothing here needs the client.
 */
import Image from 'next/image';

import type { Photograph } from '@/lib/media';

import styles from './Photo.module.css';

export function Photo({
  photo,
  sizes,
  className,
}: {
  /** Null when no photograph is available — the slot renders its gradient. */
  photo: Photograph | null;
  /**
   * How wide the slot actually is at each breakpoint, so the optimiser can
   * pick a sensible file. Required rather than defaulted: a wrong `sizes` is
   * invisible in the layout and silently ships a 2800px image to a phone.
   */
  sizes: string;
  className?: string;
}) {
  if (!photo) return null;

  return (
    <Image
      src={photo.url}
      // Already in the page's language — an English alt attribute on the
      // Arabic site is a broken experience for the people relying on it.
      alt={photo.alt}
      fill
      sizes={sizes}
      className={[styles.photo, className].filter(Boolean).join(' ')}
    />
  );
}

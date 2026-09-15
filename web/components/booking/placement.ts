/**
 * Which side of its field the stay calendar opens on.
 *
 * The calendar used to be hardcoded to open downwards, which is right only when
 * the field is near the top of the screen — and on every surface we have, it is
 * not. The hero search sits on the lower third of the first screen, and the
 * reserve flow's own picker falls below the fold on any laptop window shorter
 * than about 700px. Either way the guest was asked to scroll blind to reach the
 * days, on the one journey that earns money.
 *
 * The arithmetic lives here, apart from the component, because it is the part
 * worth testing and the part that is easy to get subtly wrong. Nothing in this
 * file touches the DOM: the caller measures, this decides.
 */

export type Placement = 'below' | 'above';

/** Matches the 6px offset the popover has always sat at. */
const GAP = 6;

/**
 * Breathing room so the calendar never sits flush against the screen edge.
 *
 * Deliberately small. Measured on the reserve flow at 1440x900, the calendar
 * clears the bottom of the window by 18px — so a margin of 12 or more puts that
 * case exactly on the boundary, where the field's fractional pixel decides
 * whether it flips. It fits there today and should go on fitting: the point of
 * this module is to rescue the cases that are broken, not to move the ones that
 * work.
 */
const MARGIN = 8;

export interface PlacementInput {
  /** The field's top, relative to the viewport (`getBoundingClientRect`). */
  anchorTop: number;
  /** The field's bottom, relative to the viewport. */
  anchorBottom: number;
  viewportHeight: number;
  /** The calendar's natural, unconstrained height. */
  calendarHeight: number;
}

export interface PlacementResult {
  placement: Placement;
  /**
   * A cap for the calendar's height, or null to leave it unconstrained.
   *
   * Only set when the calendar fits on neither side — a phone held in
   * landscape, essentially. The popover then scrolls inside itself, which is
   * not lovely but is strictly better than running off the screen.
   */
  maxHeight: number | null;
}

/**
 * Decide where the calendar goes.
 *
 * Downwards is preferred and only given up when it does not fit: it is the
 * established behaviour, it is what a guest expects of a date field, and it
 * keeps the field itself unobscured.
 *
 * Note what this does **not** need to know about: the fixed navigation bar on
 * the full-bleed home page. A flipped calendar could only slide underneath it
 * when `anchorTop` is small — and a small `anchorTop` means there is more room
 * below than above, so `below` wins before flipping is ever considered. The
 * rule corrects for the nav without being told it exists.
 */
export function choosePlacement({
  anchorTop,
  anchorBottom,
  viewportHeight,
  calendarHeight,
}: PlacementInput): PlacementResult {
  const roomBelow = viewportHeight - anchorBottom - GAP - MARGIN;
  const roomAbove = anchorTop - GAP - MARGIN;

  if (calendarHeight <= roomBelow) {
    return { placement: 'below', maxHeight: null };
  }

  if (calendarHeight <= roomAbove) {
    return { placement: 'above', maxHeight: null };
  }

  // It fits neither way. Take the roomier side and let the calendar scroll
  // within what it has.
  const placement: Placement = roomAbove > roomBelow ? 'above' : 'below';
  const room = placement === 'above' ? roomAbove : roomBelow;

  // A floor rather than a raw value: on a very short screen `room` can go to
  // zero or negative, and a 0px-tall popover is a calendar the guest cannot use
  // at all. At this size it will overflow the screen a little; that is the
  // least-bad option left, and it is still scrollable.
  return { placement, maxHeight: Math.max(room, 200) };
}

'use client';

/**
 * Keep a popover on screen by opening it above its field when below will not
 * fit — the measuring half of `placement.ts`, which does the deciding.
 *
 * Lifted out of `CalendarPopover` when the home search gained a second
 * popover, for guests. Both hang off a field in the same bar, so both meet the
 * same problem — the bar sits on the lower third of the hero — and a guests
 * panel that ran off the bottom of the screen while the calendar beside it
 * flipped would be the same bug fixed once.
 *
 * The popover must be rendered inside a `position: relative` field: its
 * `offsetParent` is what gets measured.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { choosePlacement, type PlacementResult } from './placement';

export function usePopoverPlacement<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  // Downwards until measurement says otherwise — the common case, and the state
  // the markup has always rendered in.
  const [fit, setFit] = useState<PlacementResult>({
    placement: 'below',
    maxHeight: null,
  });

  const measure = useCallback(() => {
    const el = ref.current;
    const field = el?.offsetParent;
    if (!el || !(field instanceof HTMLElement)) return;

    const rect = field.getBoundingClientRect();
    setFit(
      choosePlacement({
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        viewportHeight: window.innerHeight,
        // `scrollHeight`, not `offsetHeight`: once a previous measurement has
        // capped the height, `offsetHeight` reports the cap and the popover
        // could never discover it has room to grow back.
        calendarHeight: el.scrollHeight,
      }),
    );
  }, []);

  // Before paint, not after, so the guest never sees it open downwards and then
  // jump. Popovers mount only on a click, so this never runs on the server.
  useLayoutEffect(measure, [measure]);

  // A resize changes the room available; so does scrolling. Passive, because
  // neither handler calls `preventDefault`.
  useEffect(() => {
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [measure]);

  return { ref, fit, measure };
}

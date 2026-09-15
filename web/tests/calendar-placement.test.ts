/**
 * Where the stay calendar opens.
 *
 * The numbers in these cases are the ones measured in a real browser when the
 * bug was found, so a regression here is a regression against the thing that
 * was actually wrong rather than against an invented scenario:
 *
 *   - the home search on `/preview/still` at 1440x900 — 224px off the bottom
 *   - the live reserve flow at 1440x620 — 271px off the bottom
 *   - the reserve flow at full height, which was fine and must stay fine
 */
import { describe, expect, it } from 'vitest';

import { choosePlacement } from '../components/booking/placement';

/** The calendar's natural height, measured. */
const CALENDAR = 291;

describe('choosePlacement', () => {
  it('opens downwards when there is room, which is the common case', () => {
    // A field in the upper half of a tall window — nothing to solve here, and
    // the calendar must not start moving around for no reason.
    expect(
      choosePlacement({
        anchorTop: 300,
        anchorBottom: 340,
        viewportHeight: 900,
        calendarHeight: CALENDAR,
      }),
    ).toEqual({ placement: 'below', maxHeight: null });
  });

  it('leaves the reserve flow at full height opening downwards', () => {
    // Measured from the live page: the field ends at 593px in a 900px window,
    // which clears the calendar by 18px. It has always opened downwards here
    // and it looks right — flipping would throw the calendar over the step
    // heading for no gain. This is the case the margin is tuned around, so it
    // is worth pinning: it is the boundary between "rescue it" and "leave it".
    const fit = choosePlacement({
      anchorTop: 553,
      anchorBottom: 593,
      viewportHeight: 900,
      calendarHeight: CALENDAR,
    });

    expect(fit.placement).toBe('below');
    expect(fit.maxHeight).toBeNull();
  });

  it('flips the reserve flow on a phone', () => {
    // Measured: the field ends at 604px in an 844px window, 49px short.
    expect(
      choosePlacement({
        anchorTop: 564,
        anchorBottom: 604,
        viewportHeight: 844,
        calendarHeight: CALENDAR,
      }).placement,
    ).toBe('above');
  });

  it('flips up for the hero search, which sits on the lower third', () => {
    // `/preview/still` at 1440x900: this opened 224px below the fold.
    const fit = choosePlacement({
      anchorTop: 745,
      anchorBottom: 827,
      viewportHeight: 900,
      calendarHeight: CALENDAR,
    });

    expect(fit.placement).toBe('above');
    expect(fit.maxHeight).toBeNull();
  });

  it('flips up for the reserve flow on a short laptop window', () => {
    // 1440x620 — the live defect, and the reason this is not a drafts-only fix.
    const fit = choosePlacement({
      anchorTop: 560,
      anchorBottom: 600,
      viewportHeight: 620,
      calendarHeight: CALENDAR,
    });

    expect(fit.placement).toBe('above');
    expect(fit.maxHeight).toBeNull();
  });

  it('does not flip a field near the top of the screen', () => {
    // The case that would slide the calendar under the fixed nav on the
    // full-bleed home page. There is barely any room above, so `below` has to
    // win even though the calendar does not quite fit there either.
    const fit = choosePlacement({
      anchorTop: 96,
      anchorBottom: 140,
      viewportHeight: 380,
      calendarHeight: CALENDAR,
    });

    expect(fit.placement).toBe('below');
  });

  it('takes the roomier side and caps the height when it fits neither', () => {
    // A phone held in landscape. Neither side has 291px.
    const fit = choosePlacement({
      anchorTop: 250,
      anchorBottom: 300,
      viewportHeight: 390,
      calendarHeight: CALENDAR,
    });

    expect(fit.placement).toBe('above');
    // 250 - 6 (gap) - 8 (margin)
    expect(fit.maxHeight).toBe(236);
  });

  it('never caps the calendar so short it cannot be used', () => {
    // A field filling almost the whole of a tiny viewport. Both sides are
    // effectively zero, and a 0px popover is worse than one that overflows.
    const fit = choosePlacement({
      anchorTop: 10,
      anchorBottom: 290,
      viewportHeight: 300,
      calendarHeight: CALENDAR,
    });

    expect(fit.maxHeight).toBe(200);
  });

  it('prefers below when the two sides are equal', () => {
    // Nothing is gained by moving, and staying leaves the field unobscured.
    const fit = choosePlacement({
      anchorTop: 150,
      anchorBottom: 250,
      viewportHeight: 400,
      calendarHeight: CALENDAR,
    });

    expect(fit.placement).toBe('below');
  });

  it('leaves a margin rather than sitting flush against the edge', () => {
    // Exactly enough room for the calendar, the 6px gap and the 12px margin —
    // and then one pixel less, which must flip.
    const exact = {
      anchorTop: 400,
      anchorBottom: 500,
      viewportHeight: 500 + CALENDAR + 6 + 8,
      calendarHeight: CALENDAR,
    };
    expect(choosePlacement(exact).placement).toBe('below');
    expect(
      choosePlacement({ ...exact, viewportHeight: exact.viewportHeight - 1 })
        .placement,
    ).toBe('above');
  });
});

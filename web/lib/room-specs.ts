/**
 * The per-room specification list.
 *
 * Size, bed, view, bathroom and floor are **marketing copy in the message
 * files**, keyed by room code, not database fields — Phase 1 has no structured
 * column for them and inventing one would mean guessing the shape a future PMS
 * expects (`pms-readiness`). Every surface that renders them therefore reads
 * `rooms.specs.<code>.<key>` behind a `t.has()` guard, because a room type
 * added in the admin panel has no copy here until the client writes it.
 *
 * The order and the bidi rule live here rather than in each surface: the Rooms
 * listing, the room page and the booking flow's detail dialog must not each
 * decide for themselves which specs exist or which of them read left-to-right.
 */

/** Rendered in this order wherever specs appear. */
export const SPEC_KEYS = ['size', 'bed', 'view', 'bathroom', 'floor'] as const;

export type SpecKey = (typeof SPEC_KEYS)[number];

/**
 * Specs whose value is a measurement or a numeric range rather than prose.
 *
 * These are always read left-to-right, whatever the page language. Left to
 * inherit the Arabic page's direction, bidi reordering displays "42 m²" as
 * "m² 42" and — worse — the floor range "2 – 6" as "6 – 2", which is not a
 * styling problem but wrong information. The stored values are correct; only
 * the rendering direction needs pinning.
 */
export const LTR_SPEC_KEYS = new Set<string>(['size', 'floor']);

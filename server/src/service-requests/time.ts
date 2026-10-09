/**
 * Times of day for spa and dining requests, in Dubai.
 *
 * Unlike a room night, a request names a time, so "today" and "now" matter:
 * a guest must not be able to ask for 10:00 at 15:00. Dubai has no daylight
 * saving — it is UTC+4 all year — so a fixed offset is exact, and needs no
 * time-zone database on the server.
 */
import { toIsoDate } from '../booking/dates.js';
import type { IsoDate } from '../booking/types.js';

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** A half-hour slot, `HH:00` or `HH:30`. */
export const SLOT_PATTERN = /^([01]\d|2[0-3]):[03]0$/;

/** Any time of day, `HH:MM` — what the team may confirm. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Every half hour from `first` to `last` inclusive. */
export function slotsBetween(first: string, last: string): string[] {
  const slots: string[] = [];
  for (let at = toMinutes(first); at <= toMinutes(last); at += 30) {
    slots.push(fromMinutes(at));
  }
  return slots;
}

/** Today and the time now, as a clock in Dubai shows them. */
export function dubaiNow(now = new Date()): { date: IsoDate; time: string } {
  const shifted = new Date(now.getTime() + DUBAI_OFFSET_MS);
  return {
    date: toIsoDate(shifted),
    time: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(
      shifted.getUTCMinutes(),
    ).padStart(2, '0')}`,
  };
}

/** Has this slot, on this day, already gone by in Dubai? */
export function isInPast(date: IsoDate, time: string, now = new Date()): boolean {
  const current = dubaiNow(now);
  if (date !== current.date) return date < current.date;
  return toMinutes(time) <= toMinutes(current.time);
}

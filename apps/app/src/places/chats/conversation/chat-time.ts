// The chat's clock: how a moment reads in a chat (time of day, weekday, "Yesterday"). Pure and free of any view code, so a node test and the thread-reply summaries can import it
// without pulling in the block registry (which loads .tsx). model.ts re-exports all of it.
import { chatWhen } from "../rightpane/model.ts";
import type { Zones } from "../../../../../../lib/zones.ts";
import { partsIn, titleOf as zoneTitle, dayIn } from "../../../../../../lib/zones.ts";

export interface Clock {
  now: number;
  offsetMin: number;
  /** the Space's zone and the viewer's, for a shared place; left out for a private one (the device's offset is the clock) */ zones?: Zones;
}

export const DAY = 86_400_000;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const local = (ts: number, c: Clock): number => ts + c.offsetMin * 60_000;
export const dayNumber = (ts: number, c: Clock): number =>
  c.zones ? dayIn(ts, c.zones.space) : Math.floor(local(ts, c) / DAY);

/** What hover says about a message's time: both zones and the full date. Only where there are zones (a shared place). */
export function timeTitle(ts: number, c: Clock): string | undefined {
  return c.zones ? zoneTitle(ts, c.zones) : undefined;
}

/** The hour and minute of a moment in the clock the chat reads in, 24-hour, for code that needs the numbers. */
export function clockParts(ts: number, c: Clock): { hour: number; minute: number } {
  if (c.zones) {
    const p = partsIn(ts, c.zones.space);
    return { hour: p.hour, minute: p.minute };
  }
  const d = new Date(local(ts, c));
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** The weekday of a moment in the clock the chat reads in, short: "Wed". Works for a moment ahead as well as behind. */
export function weekdayShort(ts: number, c: Clock): string {
  const dow = c.zones ? partsIn(ts, c.zones.space).dow : new Date(local(ts, c)).getUTCDay();
  return (WEEKDAYS[dow] ?? "").slice(0, 3);
}

/** A time of day the way a person says it: "10:28 PM". One format in every chat (owner, 7 Nov 2026). */
export function timeLabel(ts: number, c: Clock): string {
  const { hour, minute } = clockParts(ts, c);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** When something happened, in a chat: a time of day today, exactly as a message row says it (the one formatter above); an earlier day as "Yesterday", the weekday or the date (the same words as the lists). */
export function whenLabel(ts: number, c: Clock): string {
  return dayNumber(c.now, c) - dayNumber(ts, c) <= 0 ? timeLabel(ts, c) : chatWhen(ts, c);
}

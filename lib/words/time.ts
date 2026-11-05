// One way to say a time to a person: short, in their own zone, once. "Wed 11 Nov, 4:16". `offsetMin` is the viewer's zone against UTC.
import { clockIn, dateIn } from "../zones.ts";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortTime(at: number, offsetMin = 0): string {
  const a = new Date(at + offsetMin * 60_000);
  const h = a.getUTCHours();
  return `${DAYS[a.getUTCDay()]} ${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}, ${h % 12 === 0 ? 12 : h % 12}:${String(a.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The same in an IANA zone (daylight saving included): "Sat 7 Nov, 2:31 PM". A feed line is read in the Space's zone. */
export function shortTimeIn(at: number, zone: string): string {
  return `${dateIn(at, zone)}, ${clockIn(at, zone)}`;
}

/** The token a stored sentence carries for a moment; the reader's zone fills it in later. */
export const atToken = (at: number): string => `{at:${Math.round(at)}}`;
/** The token a stored sentence carries for a person or agent; the reader's directory names it. */
export const whoToken = (id: string): string => `{who:${id}}`;

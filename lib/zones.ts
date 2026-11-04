// Time zones, one place. A Space has a time zone (an IANA name) that every shared place reads in; a person has their own, shown quietly beside it when it differs. This file is pure: no React, no network.
// It uses Intl for the zone rules (daylight saving included) and nothing else, so the same math runs in the app, the server and the tests. A name that Intl does not know is not a zone.
// DECISION: a time is formatted as "9:00 AM" (12 hour), the way the owner wrote the example, and a day word ("Tomorrow", "Thu") is added only when the day is not today in that zone.

const MIN = 60_000, DAY = 86_400_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmtOf(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(zone, f);
  }
  return f;
}

/** Is this an IANA zone the runtime knows? "UTC" counts. */
export function validZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.trim() === "" || zone.length > 64) return false;
  try { fmtOf(zone); return true; } catch { return false; }
}

/** The zone this computer is set to, or UTC where it cannot say. */
export function deviceZone(): string {
  try { const z = new Intl.DateTimeFormat().resolvedOptions().timeZone; return validZone(z) ? z : "UTC"; } catch { return "UTC"; }
}

export interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number; dow: number }

/** The wall clock in a zone at an instant. */
export function partsIn(at: number, zone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of fmtOf(zone).formatToParts(new Date(at))) if (p.type !== "literal") out[p.type] = Number(p.value);
  const hour = out["hour"] === 24 ? 0 : out["hour"]!;
  const dow = new Date(Date.UTC(out["year"]!, out["month"]! - 1, out["day"]!)).getUTCDay();
  return { year: out["year"]!, month: out["month"]!, day: out["day"]!, hour, minute: out["minute"]!, second: out["second"]!, dow };
}

/** Minutes the zone is ahead of UTC at that instant (negative west of it). Daylight saving is in it. */
export function offsetMinAt(at: number, zone: string): number {
  const p = partsIn(at, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / MIN);
}

/** The calendar day in the zone, as a whole number (days since 1 Jan 1970 on that wall clock). */
export function dayIn(at: number, zone: string): number {
  return Math.floor((at + offsetMinAt(at, zone) * MIN) / DAY);
}

/** "9:00 AM". */
export function clockIn(at: number, zone: string): string {
  const p = partsIn(at, zone);
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`;
}

/** "Thu 6 Nov". The year is added when it is not this year in that zone. */
export function dateIn(at: number, zone: string, now?: number): string {
  const p = partsIn(at, zone);
  const base = `${DAYS[p.dow]} ${p.day} ${MONTHS[p.month - 1]}`;
  return now !== undefined && partsIn(now, zone).year !== p.year ? `${base} ${p.year}` : base;
}

/** "Today", "Tomorrow", "Yesterday", "Thu" within a week, else "Thu 6 Nov": how far a day is from today, in the zone. */
export function dayWord(at: number, now: number, zone: string): string {
  const d = dayIn(at, zone) - dayIn(now, zone);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return Math.abs(d) < 7 ? DAYS[partsIn(at, zone).dow]! : dateIn(at, zone, now);
}

/** "Pacific Time", from the zone's long name with Standard and Daylight left out (the clock says which it is). Falls back to the city. */
export function zoneName(zone: string, at: number = Date.now()): string {
  try {
    const long = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? "";
    const plain = long.replace(/\s+(Standard|Daylight|Summer)\s+/i, " ").replace(/\s+/g, " ").trim();
    if (plain !== "" && !/^GMT[+-]/.test(plain)) return plain;
  } catch { /* an unknown zone */ }
  return zoneCity(zone);
}

/** "Los Angeles" from "America/Los_Angeles". */
export function zoneCity(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

/** "UTC-8", "UTC+5:30": the offset in the label of a picker row. */
export function offsetLabel(at: number, zone: string): string {
  const m = offsetMinAt(at, zone);
  if (m === 0) return "UTC";
  const a = Math.abs(m);
  return `UTC${m < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

/** The two zones every shared time is read in. `space` is the Space's; `viewer` is the person looking. */
export interface Zones { space: string; viewer: string }

export interface When {
  /** The time in the Space zone: "9:00 AM", "Tomorrow 9:00 AM", "Thu 9:00 AM", "7 Nov". */
  text: string;
  /** The viewer's own reading, only when it is not the same moment on the wall: "10:00 PM", "Thu 12:30 AM". */
  mine?: string;
  /** Both zones and the full date, for hover and long-press. */
  title: string;
}

function relativeText(at: number, now: number, zone: string, withTime: boolean): string {
  const d = dayIn(at, zone) - dayIn(now, zone);
  const time = clockIn(at, zone);
  if (d === 0) return time;
  const day = d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : Math.abs(d) < 7 ? DAYS[partsIn(at, zone).dow]! : dateIn(at, zone, now);
  return withTime || Math.abs(d) < 7 ? `${day} ${time}` : day;
}

/** A time as people say it from now, in the Space zone, with the viewer's reading beside it when their zone shows a different clock. */
export function whenIn(at: number, now: number, z: Zones): When {
  const text = relativeText(at, now, z.space, true);
  const differs = offsetMinAt(at, z.space) !== offsetMinAt(at, z.viewer);
  let mine: string | undefined;
  if (differs) {
    // the viewer's reading says its day only when it is not the Space's day at that moment
    const sameDay = dayIn(at, z.viewer) - dayIn(now, z.viewer) === dayIn(at, z.space) - dayIn(now, z.space) && partsIn(at, z.viewer).day === partsIn(at, z.space).day;
    mine = sameDay ? clockIn(at, z.viewer) : relativeText(at, now, z.viewer, true);
  }
  return { text, ...(mine ? { mine } : {}), title: titleOf(at, z) };
}

/** "Thu 6 Nov 2026, 9:00 AM Pacific Time. 10:00 PM your time, Pakistan Time." */
export function titleOf(at: number, z: Zones): string {
  const p = partsIn(at, z.space);
  const full = `${DAYS[p.dow]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${clockIn(at, z.space)} ${zoneName(z.space, at)}`;
  if (offsetMinAt(at, z.space) === offsetMinAt(at, z.viewer)) return full;
  const q = partsIn(at, z.viewer);
  const mine = `${DAYS[q.dow]} ${q.day} ${MONTHS[q.month - 1]}, ${clockIn(at, z.viewer)} ${zoneName(z.viewer, at)}`;
  return `${full}. Your time: ${mine}.`;
}

/** A deadline as a date line: "Fri 7 Nov, 6:00 PM" in the Space zone. */
export function dueIn(at: number, z: Zones): string {
  return `${dateIn(at, z.space)}, ${clockIn(at, z.space)}`;
}

/** The instant of a wall clock reading in a zone ("2026-11-07T18:00"), settled so a time that does not exist (the hour skipped in spring) moves forward and one that happens twice takes the first. */
export function instantOf(local: string, zone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let guess = wall - offsetMinAt(wall, zone) * MIN;
  const again = wall - offsetMinAt(guess, zone) * MIN;
  if (again !== guess) guess = Math.min(guess, again);
  const p = partsIn(guess, zone);
  // a skipped hour lands an hour earlier on the wall: ask again with the later offset
  if (p.hour !== +m[4]! || p.minute !== +m[5]!) return wall - offsetMinAt(wall + 2 * 60 * MIN, zone) * MIN;
  return Number.isFinite(guess) ? guess : null;
}

/** The wall clock of an instant in a zone as a datetime-local value ("2026-11-07T18:00"). */
export function localInput(at: number, zone: string): string {
  const p = partsIn(at, zone);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** The zones a picker offers, with city and the time there now. Intl knows the list where the runtime has supportedValuesOf. */
export function zoneChoices(now: number = Date.now()): { zone: string; city: string; name: string; offset: string; time: string; label: string }[] {
  let names: string[] = [];
  try { names = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { names = []; }
  if (names.length === 0) names = FALLBACK_ZONES;
  if (!names.includes("UTC")) names = [...names, "UTC"];
  return names.filter(validZone).map((zone) => {
    const city = zoneCity(zone), name = zoneName(zone, now), time = clockIn(now, zone);
    return { zone, city, name, offset: offsetLabel(now, zone), time, label: `${name}, ${city}, ${time}` };
  }).sort((a, b) => offsetMinAt(now, a.zone) - offsetMinAt(now, b.zone) || a.city.localeCompare(b.city));
}

const FALLBACK_ZONES = [
  "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Atlantic/Reykjavik", "Europe/London",
  "Europe/Paris", "Europe/Athens", "Africa/Cairo", "Europe/Moscow", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Kuala_Lumpur", "Asia/Singapore",
  "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
];

/** The words that find a zone in a picker: its city, its name and its zone id. */
export function zoneMatches(c: { zone: string; city: string; name: string }, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  return [c.city, c.name, c.zone, c.zone.replace(/_/g, " ")].some((s) => s.toLowerCase().includes(needle));
}

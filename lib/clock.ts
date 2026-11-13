// The clock: when a wake is next due. One file for every "next time" in the product: a time of day (cron), an interval ("every N hours") and one moment, with the start of a day and a day later in a zone.
// A zone is always a name ("Asia/Karachi"), never an offset, and the default is the Space's. This file sits over lib/zones.ts, which knows the zone rules; it is pure (no React, no database, no network).
//
// The rules a clock change needs, fixed by the P1 contract (CONTRACTS-2026-11-13/P1-clock-wake.md, "Time"):
//   gap     a time that does not exist (spring forward) fires at the first moment after the gap, the same day.
//   repeat  a time that happens twice (fall back) fires once, at its first pass.
//   every   an interval counts from the last due time, so a clock change cannot move it.
import { offsetMinAt, partsIn, validZone } from "./zones.ts";

const SECOND = 1_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

// ---- a wall clock reading to an instant

/** The instant a wall clock reading has in a zone. `wall` is the reading written as if it were UTC (Date.UTC of its year, month, day, hour, minute, second). */
export function instantOfWall(wall: number, zone: string): number {
  // the offsets in force a day before the reading and a day after it: a clock change is the only thing that makes them differ
  const before = offsetMinAt(wall - DAY, zone);
  const after = offsetMinAt(wall + DAY, zone);
  const reads = (t: number): boolean => {
    const p = partsIn(t, zone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) === wall;
  };
  const tries = [wall - before * MINUTE, wall - after * MINUTE].filter(reads);
  if (tries.length > 0) return Math.min(...tries); // twice (fall back): the first pass
  // it does not exist (spring forward): the gap ends where the offset changes, somewhere between the two instants the reading would have had
  let lo = Math.min(wall - before * MINUTE, wall - after * MINUTE);
  let hi = Math.max(wall - before * MINUTE, wall - after * MINUTE);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMinAt(mid, zone) === after) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The first instant of the day `at` falls in, on the clock of the zone. A day that starts in a gap (Havana skips midnight) starts when the gap ends. */
export function startOfDay(at: number, zone: string): number {
  const p = partsIn(at, zone);
  return instantOfWall(Date.UTC(p.year, p.month - 1, p.day), zone);
}

/** The same wall clock time `days` calendar days later (earlier when negative): 09:00 stays 09:00 across a clock change. */
export function addDays(at: number, days: number, zone: string): number {
  return moveWall(at, zone, 0, days);
}

/** The same wall clock time `months` calendar months later. Like Date, a day the month does not have rolls into the next (31 January plus one month is 3 March). */
export function addMonths(at: number, months: number, zone: string): number {
  return moveWall(at, zone, months, 0);
}

function moveWall(at: number, zone: string, months: number, days: number): number {
  const p = partsIn(at, zone);
  const wall = Date.UTC(p.year, p.month - 1 + months, p.day + days, p.hour, p.minute, p.second);
  return instantOfWall(wall, zone) + (at - Math.floor(at / SECOND) * SECOND);
}

// ---- cron

interface Field {
  set: ReadonlySet<number>;
  star: boolean;
}
/** A five field cron, read. Made by `parseCron`; handed to `nextCron`. */
export interface CronSpec {
  min: Field;
  hour: Field;
  dom: Field;
  mon: Field;
  dow: Field;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOWS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

function parseField(text: string, lo: number, hi: number, names?: readonly string[], nameBase = 0): Field | undefined {
  const value = (s: string): number | undefined => {
    if (/^\d+$/.test(s)) return Number(s);
    const i = names ? names.indexOf(s.toLowerCase()) : -1;
    return i >= 0 ? i + nameBase : undefined;
  };
  const set = new Set<number>();
  let star = false;
  for (const part of text.split(",")) {
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined || range === undefined || range === "") return undefined;
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) return undefined;
      step = Number(stepText);
    }
    let a: number | undefined;
    let b: number | undefined;
    if (range === "*") {
      a = lo;
      b = hi;
      if (stepText === undefined) star = true;
    } else if (range.includes("-")) {
      const [x, y, z] = range.split("-");
      if (z !== undefined || x === undefined || y === undefined) return undefined;
      a = value(x);
      b = value(y);
    } else {
      a = value(range);
      b = stepText !== undefined ? hi : a;
    }
    if (a === undefined || b === undefined || a < lo || b > hi || a > b) return undefined;
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return set.size > 0 ? { set, star } : undefined;
}

/** A five field cron: minute hour day-of-month month day-of-week. Lists, ranges, steps, month and weekday names and the @daily style macros. Weekday 7 is Sunday. Undefined when the text is not one. */
export function parseCron(text: string): CronSpec | undefined {
  const t = text.trim().toLowerCase();
  const parts = (MACROS[t] ?? t).split(/\s+/);
  if (parts.length !== 5) return undefined;
  const min = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dom = parseField(parts[2]!, 1, 31);
  const mon = parseField(parts[3]!, 1, 12, MONTHS, 1);
  const dowRaw = parseField(parts[4]!, 0, 7, DOWS, 0);
  if (!min || !hour || !dom || !mon || !dowRaw) return undefined;
  const dow: Field = { star: dowRaw.star, set: new Set([...dowRaw.set].map((d) => d % 7)) };
  return { min, hour, dom, mon, dow };
}

/** A time of day, every day (or on one weekday, 0 is Sunday): what a goal's "every morning at 9" is. */
export function cronAt(hour: number, minute: number, weekday?: number): CronSpec {
  return parseCron(`${minute} ${hour} * * ${weekday ?? "*"}`)!;
}

/** The days a cron looks ahead: nine years finds a leap day on a leap year, and a cron that never fires (30 February) ends the search. */
const LOOK_AHEAD_DAYS = 366 * 9;

/** The first fire strictly after `after`, on the wall clock of the zone. Undefined when the cron never fires. */
export function nextCron(spec: CronSpec, zone: string, after: number): number | undefined {
  const start = partsIn(after, zone);
  const hours = [...spec.hour.set].sort((a, b) => a - b);
  const mins = [...spec.min.set].sort((a, b) => a - b);
  const day0 = Date.UTC(start.year, start.month - 1, start.day);
  for (let n = 0; n < LOOK_AHEAD_DAYS; n++) {
    const day = new Date(day0 + n * DAY);
    if (!spec.mon.set.has(day.getUTCMonth() + 1)) continue;
    const domOk = spec.dom.set.has(day.getUTCDate());
    const dowOk = spec.dow.set.has(day.getUTCDay());
    // both day fields restricted: either one matches (cron's rule); a star in one leaves the other in charge
    if (!(spec.dom.star || spec.dow.star ? domOk && dowOk : domOk || dowOk)) continue;
    // wall clock order is instant order (a gap folds its times onto one instant, a repeat counts once), so the first one after `after` is the answer
    for (const h of hours)
      for (const m of mins) {
        const at = instantOfWall(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m), zone);
        if (at > after) return at;
      }
  }
  return undefined;
}

// ---- an interval

/** The next time of an interval wake: the grid `lastDue + k * every` (k is 1, 2, 3 ...), first point strictly after `after`. Counted in elapsed time, so a clock change cannot move it. */
export function nextEvery(lastDue: number, everyMs: number, after: number = lastDue): number {
  if (!(everyMs > 0)) throw new RangeError("an interval is longer than zero");
  return lastDue + Math.max(1, Math.floor((after - lastDue) / everyMs) + 1) * everyMs;
}

// ---- which zone, and when

/** The zones a wake can read its clock in, most specific first. */
export interface ZoneChain {
  wake?: string | null;
  space?: string | null;
  person?: string | null;
}

/** A zone is a name. Intl also reads "+05:00" as a zone, and an offset does not follow daylight saving, so it is not one here. */
const isName = (zone: unknown): zone is string => validZone(zone) && !/^[+-]/.test(zone);

/** The wake's own zone, else the Space's, else the person's, else UTC. A name that is not a zone is skipped. */
export function zoneOf(z: ZoneChain): string {
  return [z.wake, z.space, z.person].find(isName) ?? "UTC";
}

/** When a wake is due: one moment, a time of day (in the zone named here, else the Space's), or every N hours counted from the last due time. */
export type When =
  | { at: number }
  | { cron: string; tz?: string | null }
  | { every: { hours: number }; lastDue: number };

/** The next time `when` is due strictly after `after`; undefined when it never is again. `zones` are the Space's and the person's, for a wake that names none of its own. */
export function nextFire(when: When, zones: Omit<ZoneChain, "wake">, after: number): number | undefined {
  if ("at" in when) return when.at > after ? when.at : undefined;
  if ("every" in when) return nextEvery(when.lastDue, when.every.hours * 3_600_000, after);
  const spec = parseCron(when.cron);
  return spec && nextCron(spec, zoneOf({ ...zones, wake: when.tz }), after);
}

// Cron for automation schedules. Five fields, names, steps and the @daily macros.
// A local time that does not exist when clocks spring forward is skipped. A time that happens twice when clocks fall back fires on its first pass only.
// The same rules as the host scheduler, kept here so the tick math can be tested without the generator.

const MINUTE = 60_000;
const DAY = 86_400_000;

interface Field { set: ReadonlySet<number>; star: boolean }
export interface CronSpec { min: Field; hour: Field; dom: Field; mon: Field; dow: Field }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOWS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *",
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

/** A five-field cron. Undefined when the text is not one the scheduler can read. */
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

export function validTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const fmts = new Map<string, Intl.DateTimeFormat>();
interface Local { y: number; mo: number; d: number; h: number; mi: number }

function localOf(ms: number, tz: string): Local {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    fmts.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year!, mo: o.month!, d: o.day!, h: o.hour! % 24, mi: o.minute! };
}

const asUtc = (l: Local): number => Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi);

/** The instant a wall-clock minute has in a zone. Undefined when that minute is skipped by a spring-forward. On a fall-back, the earlier instant. */
function localToUtc(l: Local, tz: string): number | undefined {
  const want = asUtc(l);
  let guess = want - (asUtc(localOf(want, tz)) - want);
  for (let i = 0; i < 2; i++) {
    const got = asUtc(localOf(guess, tz));
    if (got === want) return guess;
    guess -= got - want;
  }
  return asUtc(localOf(guess, tz)) === want ? guess : undefined;
}

/** The first fire strictly after `after`. Undefined when the cron never fires, such as 30 February. */
export function nextCron(spec: CronSpec, tz: string, after: number): number | undefined {
  const start = localOf(after, tz);
  const hours = [...spec.hour.set].sort((a, b) => a - b);
  const mins = [...spec.min.set].sort((a, b) => a - b);
  const day0 = Date.UTC(start.y, start.mo - 1, start.d);
  for (let n = 0; n < 366 * 9; n++) {
    const dt = new Date(day0 + n * DAY);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    if (!spec.mon.set.has(mo)) continue;
    const domOk = spec.dom.set.has(d);
    const dowOk = spec.dow.set.has(dt.getUTCDay());
    // Both day fields restricted: either matches. A star in one leaves the other in charge.
    const dayOk = spec.dom.star || spec.dow.star ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of hours) for (const mi of mins) {
      const at = localToUtc({ y, mo, d, h, mi }, tz);
      if (at !== undefined && at > after) return at;
    }
  }
  return undefined;
}

function sorted(field: Field): number[] {
  return [...field.set].sort((a, b) => a - b);
}

function coversAll(field: Field, count: number): boolean {
  return field.star || field.set.size === count;
}

/** Step from the low end of the field through the high end. Undefined for a partial list. */
function fullStep(values: number[], lo: number, hi: number): number | undefined {
  if (values.length < 2 || values[0] !== lo) return undefined;
  const step = values[1]! - values[0]!;
  if (step < 1) return undefined;
  for (let i = 1; i < values.length; i++) if (values[i] !== lo + i * step) return undefined;
  if (lo + values.length * step <= hi) return undefined;
  return step;
}

function hm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dayList(days: number[]): string {
  const names = days.map((d) => DAY_NAMES[d] ?? "day");
  if (names.length === 1) return `Every ${names[0]}`;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Plain language for a cron. Undefined when the cron is not valid. */
export function summarizeCron(cron: string): string | undefined {
  const spec = parseCron(cron);
  if (!spec) return undefined;
  const mins = sorted(spec.min);
  const hours = sorted(spec.hour);
  const doms = sorted(spec.dom);
  const dows = sorted(spec.dow);
  const minuteAll = coversAll(spec.min, 60);
  const hourAll = coversAll(spec.hour, 24);
  const domAll = coversAll(spec.dom, 31);
  const monAll = coversAll(spec.mon, 12);
  const dowAll = coversAll(spec.dow, 7);
  const fallback = `Cron ${cron.trim().replace(/\s+/g, " ")}`;
  if (!spec.dom.star && !spec.dow.star) return fallback;
  if (!monAll) return fallback;
  if (minuteAll && hourAll && domAll && dowAll) return "Every minute";
  const minuteStep = fullStep(mins, 0, 59);
  if (minuteStep !== undefined && hourAll && domAll && dowAll) return minuteStep === 1 ? "Every minute" : `Every ${minuteStep} minutes`;
  const hourStep = fullStep(hours, 0, 23);
  const onlyMinute = mins.length === 1 ? mins[0] : undefined;
  if (onlyMinute !== undefined && hourStep !== undefined && domAll && dowAll) {
    if (hourStep === 1 && onlyMinute === 0) return "Every hour";
    if (onlyMinute === 0) return `Every ${hourStep} hours`;
    return hourStep === 1 ? `Every hour at minute ${String(onlyMinute).padStart(2, "0")}` : `Every ${hourStep} hours at minute ${String(onlyMinute).padStart(2, "0")}`;
  }
  const onlyHour = hours.length === 1 ? hours[0] : undefined;
  if (onlyMinute === undefined || onlyHour === undefined) return fallback;
  const at = hm(onlyHour, onlyMinute);
  if (domAll && dowAll) return `Every day at ${at}`;
  if (domAll && dows.length === 5 && dows[0] === 1 && dows[4] === 5) return `Weekdays at ${at}`;
  if (domAll && !dowAll) return `${dayList(dows)} at ${at}`;
  if (dowAll && doms.length === 1) return `Monthly on day ${doms[0]} at ${at}`;
  return fallback;
}

export interface NextOccurrences {
  timezone: string;
  times: number[];
}

/** The next `count` fires strictly after `after`, in the named zone. Honors an optional start and end. */
export function nextOccurrences(cron: string, timezone: string, after: number, count = 5, bounds?: { startAt?: number; endAt?: number }): NextOccurrences | { error: "bad_cron" | "bad_timezone" } {
  if (!validTimeZone(timezone)) return { error: "bad_timezone" };
  const spec = parseCron(cron);
  if (!spec) return { error: "bad_cron" };
  const n = Math.min(20, Math.max(1, Math.floor(count)));
  const times: number[] = [];
  let at = after;
  if (bounds?.startAt !== undefined && bounds.startAt - 1 > at) at = bounds.startAt - 1;
  for (let i = 0; i < n; i++) {
    const t = nextCron(spec, timezone, at);
    if (t === undefined) break;
    if (bounds?.endAt !== undefined && t > bounds.endAt) break;
    if (bounds?.startAt !== undefined && t < bounds.startAt) {
      at = t;
      i -= 1;
      continue;
    }
    times.push(t);
    at = t;
  }
  return { timezone, times };
}

export const CRON_MINUTE_MS = MINUTE;

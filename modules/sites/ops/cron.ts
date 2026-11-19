// Cron for site jobs (r42-sites-run, slice 5): five fields (minute hour day-of-month month day-of-week), read in a time zone, with the usual aliases.
// Pure code. `next` finds the first minute after a time that the expression names; `latestBefore` finds the last slot at or before a time (what a restarted scheduler needs to know it missed).

export interface Cron {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  /** true when the field was `*`: standard cron matches a day when EITHER the day-of-month or the day-of-week field names it, unless one of them is `*` */
  anyDay: boolean;
  anyWeekday: boolean;
}

const ALIAS: Readonly<Record<string, string>> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function field(src: string, lo: number, hi: number, names: readonly string[], nameBase: number): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`"${part}" is not a cron value`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (!(step >= 1)) throw new Error("A step is 1 or more");
    const num = (s: string): number => {
      const i = names.indexOf(s.toLowerCase());
      const v = i >= 0 ? i + nameBase : Number(s);
      if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${s} is outside ${lo} to ${hi}`);
      return v;
    };
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = (m[1] as string).split("-");
      a = num(x as string);
      b = y === undefined ? (m[2] === undefined ? a : hi) : num(y);
    }
    if (a > b) throw new Error(`${part} runs backwards`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

/** Parse an expression; throws an Error whose message is one plain sentence. */
export function parseCron(expr: string): Cron {
  const src = ALIAS[expr.trim().toLowerCase()] ?? expr.trim();
  const f = src.split(/\s+/);
  if (f.length !== 5) throw new Error("A schedule has five parts: minute, hour, day of month, month, day of week.");
  const wd = field(f[4] as string, 0, 7, DAYS, 0);
  if (wd.has(7)) {
    wd.delete(7);
    wd.add(0);
  }
  return {
    minutes: field(f[0] as string, 0, 59, [], 0),
    hours: field(f[1] as string, 0, 23, [], 0),
    days: field(f[2] as string, 1, 31, [], 1),
    months: field(f[3] as string, 1, 12, MONTHS, 1),
    weekdays: wd,
    anyDay: f[2] === "*",
    anyWeekday: f[4] === "*",
  };
}

export interface Local {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  wd: number;
}
const fmt = new Map<string, Intl.DateTimeFormat>();
const WD: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** The wall-clock parts of an instant in a zone. */
export function localOf(t: number, tz: string): Local {
  let f = fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    fmt.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
  return {
    y: Number(o["year"]),
    mo: Number(o["month"]),
    d: Number(o["day"]),
    h: Number(o["hour"]) % 24,
    mi: Number(o["minute"]),
    wd: WD[o["weekday"] as string] ?? 0,
  };
}

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const floorMinute = (t: number): number => Math.floor(t / MIN) * MIN;

function dayOk(c: Cron, d: number, wd: number): boolean {
  const dom = c.days.has(d);
  const dow = c.weekdays.has(wd);
  if (c.anyDay && c.anyWeekday) return true;
  if (c.anyDay) return dow;
  if (c.anyWeekday) return dom;
  return dom || dow;
}

/** Minutes the zone is ahead of UTC at an instant (daylight saving included). */
export function offsetMin(t: number, tz: string): number {
  const l = localOf(t, tz);
  return Math.round((Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) - floorMinute(t)) / MIN);
}

/**
 * The instant a wall-clock time in a zone happens, once and only once. A time that does not exist (the hour skipped when clocks go forward) happens at the same moment shifted by the skipped hour,
 * so a slot is never lost; a time that happens twice (clocks go back) is the first of them, so a slot is never doubled.
 */
export function instantOf(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offs = [...new Set([offsetMin(wall - DAY, tz), offsetMin(wall + DAY, tz)])];
  const valid = offs.map((o) => wall - o * MIN).filter((t, i) => offsetMin(t, tz) === offs[i]);
  if (valid.length > 0) return Math.min(...valid);
  return wall - Math.min(...offs) * MIN;
}

/**
 * The first matching minute strictly after `after`, or null when none exists in the next 5 years (such as 31 February). Days are stepped by date arithmetic, so a schedule that rarely or never
 * matches costs a few thousand additions and no more; the zone is consulted only for the days that match.
 */
export function next(c: Cron, after: number, tz: string): number | null {
  const start = localOf(after, tz);
  const mins = [...c.minutes].sort((a, b) => a - b);
  const hrs = [...c.hours].sort((a, b) => a - b);
  let day = Date.UTC(start.y, start.mo - 1, start.d);
  const stop = day + 5 * 366 * DAY;
  for (; day <= stop; day += DAY) {
    const dt = new Date(day);
    if (!c.months.has(dt.getUTCMonth() + 1)) continue;
    if (!dayOk(c, dt.getUTCDate(), dt.getUTCDay())) continue;
    // a day with no change of clocks around it: every slot is the wall time less one offset, and the first one after `after` is the answer
    const o1 = offsetMin(day - DAY / 2, tz);
    const o2 = offsetMin(day + DAY + DAY / 2, tz);
    const plain = o1 === o2;
    let best: number | null = null;
    for (const h of hrs) {
      for (const m of mins) {
        const t = plain
          ? Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), h, m) - o1 * MIN
          : instantOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), h, m, tz);
        if (t > after && (best === null || t < best)) best = t;
        if (plain && best !== null) break;
      }
      if (plain && best !== null) break;
    }
    // a day's candidates are not always in order of the clock (a shifted slot), so the earliest of the day is taken
    if (best !== null) return best;
  }
  return null;
}

/** The last matching minute at or before `at`, looking back at most `within` ms; null when none. Used to find the one slot a restarted scheduler missed. */
export function latestBefore(c: Cron, at: number, tz: string, within: number): number | null {
  const from = at - within;
  let found: number | null = null;
  let t = next(c, from - 1, tz);
  while (t !== null && t <= at) {
    found = t;
    t = next(c, t, tz);
  }
  return found;
}

/** What a person reads: the next run in the Space's time, or why there is none. */
export function describe(expr: string): string {
  const e = expr.trim().toLowerCase();
  if (e === "@hourly" || e === "0 * * * *") return "Every hour";
  if (e === "@daily" || e === "@midnight" || e === "0 0 * * *") return "Every day at midnight";
  if (e === "@weekly") return "Every Sunday at midnight";
  if (e === "@monthly") return "On the 1st of every month at midnight";
  let m = /^\*\/(\d+) \* \* \* \*$/.exec(e);
  if (m) return `Every ${m[1]} minutes`;
  m = /^(\d+) (\d+) \* \* \*$/.exec(e);
  if (m) return `Every day at ${String(m[2]).padStart(2, "0")}:${String(m[1]).padStart(2, "0")}`;
  return expr.trim();
}

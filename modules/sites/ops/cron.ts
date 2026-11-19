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
const floorMinute = (t: number): number => Math.floor(t / MIN) * MIN;

function dayOk(c: Cron, l: Local): boolean {
  const dom = c.days.has(l.d);
  const dow = c.weekdays.has(l.wd);
  if (c.anyDay && c.anyWeekday) return true;
  if (c.anyDay) return dow;
  if (c.anyWeekday) return dom;
  return dom || dow;
}

/** The first matching minute strictly after `after`, or null when none exists in the next 5 years (such as 31 February). */
export function next(c: Cron, after: number, tz: string): number | null {
  let t = floorMinute(after) + MIN;
  const stop = after + 5 * 366 * 24 * 60 * MIN;
  while (t <= stop) {
    const l = localOf(t, tz);
    if (!c.months.has(l.mo)) {
      t += (24 * 60 - (l.h * 60 + l.mi)) * MIN;
      continue;
    }
    if (!dayOk(c, l)) {
      t += (24 * 60 - (l.h * 60 + l.mi)) * MIN;
      continue;
    }
    if (!c.hours.has(l.h)) {
      t += (60 - l.mi) * MIN;
      continue;
    }
    if (!c.minutes.has(l.mi)) {
      t += MIN;
      continue;
    }
    return t;
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

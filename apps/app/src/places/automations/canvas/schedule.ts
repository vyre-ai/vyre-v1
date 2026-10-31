// The schedule picker's model: a friendly choice (every N minutes, hour, day, weekday, week, month) compiled to the one cron the scheduler stores, the cron read back into a choice,
// the cron in words, and the next fire times in a time zone. The app cannot import modules, so the cron rules here follow modules/automations/schedule/cron.ts:
// five fields, names and steps, a skipped local time is skipped, a repeated one fires on its first pass, and when both day fields are set either may match.

const DAY = 86_400_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOWS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *",
};

interface Field { set: ReadonlySet<number>; star: boolean }
export interface CronSpec { min: Field; hour: Field; dom: Field; mon: Field; dow: Field }

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
  return { min, hour, dom, mon, dow: { star: dowRaw.star, set: new Set([...dowRaw.set].map((d) => d % 7)) } };
}

export function validTimeZone(tz: string): boolean {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** The zone this device is in. The person's saved zone wins when there is one. */
export function deviceTimeZone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && validTimeZone(tz) ? tz : "UTC";
  } catch { return "UTC"; }
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
  return { y: o["year"]!, mo: o["month"]!, d: o["day"]!, h: o["hour"]! % 24, mi: o["minute"]! };
}
const asUtc = (l: Local): number => Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi);
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

function nextCron(spec: CronSpec, tz: string, after: number): number | undefined {
  const start = localOf(after, tz);
  const hours = [...spec.hour.set].sort((a, b) => a - b);
  const mins = [...spec.min.set].sort((a, b) => a - b);
  const day0 = Date.UTC(start.y, start.mo - 1, start.d);
  for (let n = 0; n < 366 * 9; n++) {
    const dt = new Date(day0 + n * DAY);
    const mo = dt.getUTCMonth() + 1;
    if (!spec.mon.set.has(mo)) continue;
    const d = dt.getUTCDate();
    const domOk = spec.dom.set.has(d);
    const dowOk = spec.dow.set.has(dt.getUTCDay());
    const dayOk = spec.dom.star || spec.dow.star ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of hours) for (const mi of mins) {
      const at = localToUtc({ y: dt.getUTCFullYear(), mo, d, h, mi }, tz);
      if (at !== undefined && at > after) return at;
    }
  }
  return undefined;
}

/** The next `count` fire times after `after`, in the zone. Empty when the cron or the zone is not valid. */
export function nextRuns(cron: string, tz: string, after: number, count = 3): number[] {
  const spec = parseCron(cron);
  if (!spec || !validTimeZone(tz)) return [];
  const out: number[] = [];
  let at = after;
  for (let i = 0; i < count; i++) {
    const t = nextCron(spec, tz, at);
    if (t === undefined) break;
    out.push(t);
    at = t;
  }
  return out;
}

/** "Mon 3 Nov, 09:00" in the zone. */
export function runWords(ms: number, tz: string): string {
  const l = localOf(ms, tz);
  const dow = new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay();
  const month = new Date(Date.UTC(l.y, l.mo - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${DAY_SHORT[dow]} ${l.d} ${month}, ${hm(l.h, l.mi)}`;
}

const sorted = (f: Field): number[] => [...f.set].sort((a, b) => a - b);
const coversAll = (f: Field, count: number): boolean => f.star || f.set.size === count;
const hm = (h: number, m: number): string => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
function fullStep(values: number[], lo: number, hi: number): number | undefined {
  if (values.length < 2 || values[0] !== lo) return undefined;
  const step = values[1]! - values[0]!;
  if (step < 1) return undefined;
  for (let i = 1; i < values.length; i++) if (values[i] !== lo + i * step) return undefined;
  if (lo + values.length * step <= hi) return undefined;
  return step;
}
function dayList(days: number[]): string {
  const names = days.map((d) => DAY_NAMES[d] ?? "day");
  if (names.length === 1) return `Every ${names[0]}`;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Plain language for a cron ("Every Monday at 09:00"). Undefined when the cron cannot be read; a valid one the words do not cover comes back as "Cron ...". */
export function cronSummary(cron: string): string | undefined {
  const spec = parseCron(cron);
  if (!spec) return undefined;
  const mins = sorted(spec.min), hours = sorted(spec.hour), doms = sorted(spec.dom), dows = sorted(spec.dow);
  const minuteAll = coversAll(spec.min, 60), hourAll = coversAll(spec.hour, 24), domAll = coversAll(spec.dom, 31), monAll = coversAll(spec.mon, 12), dowAll = coversAll(spec.dow, 7);
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
  if (domAll && dows.length === 5 && dows[0] === 1 && dows[4] === 5) return `Every weekday at ${at}`;
  if (domAll && !dowAll) return `${dayList(dows)} at ${at}`;
  if (dowAll && doms.length === 1) return `Every month on day ${doms[0]} at ${at}`;
  return fallback;
}

/** The summary the card and the preview show: "Every Monday at 09:00, Asia/Karachi". Undefined without a readable cron. */
export function scheduleWords(cron: string, tz: string): string | undefined {
  const words = cronSummary(cron);
  return words === undefined ? undefined : `${words}, ${tz}`;
}

// ---------------------------------------------------------------- the friendly choice

export type Every = "minutes" | "hours" | "day" | "weekdays" | "week" | "month" | "cron";
export const EVERY_CHOICES: readonly { key: Exclude<Every, "cron">; label: string }[] = [
  { key: "minutes", label: "N minutes" },
  { key: "hours", label: "N hours" },
  { key: "day", label: "Day" },
  { key: "weekdays", label: "Weekday" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export interface ScheduleDraft {
  every: Every;
  /** For minutes and hours: the step. */
  n: number;
  /** "HH:MM". For hours, only the minutes part is used. */
  time: string;
  /** For week: 0 is Sunday. */
  days: number[];
  /** For month: 1 to 31. */
  day: number;
  cron: string;
}

export const DEFAULT_DRAFT: ScheduleDraft = { every: "day", n: 15, time: "09:00", days: [1], day: 1, cron: "0 9 * * *" };

export const timeParts = (time: string): { h: number; m: number } | null => {
  const hit = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!hit) return null;
  const h = Number(hit[1]), m = Number(hit[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? { h, m } : null;
};

/** The cron a choice stores. Null when the choice is not complete (a bad time, no day picked). */
export function cronFromDraft(d: ScheduleDraft): string | null {
  if (d.every === "cron") return parseCron(d.cron) ? d.cron.trim().replace(/\s+/g, " ") : null;
  if (d.every === "minutes") {
    if (!Number.isInteger(d.n) || d.n < 1 || d.n > 59) return null;
    return d.n === 1 ? "* * * * *" : `*/${d.n} * * * *`;
  }
  const t = timeParts(d.time);
  if (!t) return null;
  if (d.every === "hours") {
    if (!Number.isInteger(d.n) || d.n < 1 || d.n > 23) return null;
    return d.n === 1 ? `${t.m} * * * *` : `${t.m} */${d.n} * * *`;
  }
  const at = `${t.m} ${t.h}`;
  if (d.every === "day") return `${at} * * *`;
  if (d.every === "weekdays") return `${at} * * 1-5`;
  if (d.every === "week") {
    const days = [...new Set(d.days)].filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).sort((a, b) => a - b);
    return days.length === 0 ? null : `${at} * * ${days.join(",")}`;
  }
  if (!Number.isInteger(d.day) || d.day < 1 || d.day > 31) return null;
  return `${at} ${d.day} * *`;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** A stored cron as a choice. A cron the friendly choices cannot express comes back as "cron" so nothing is lost. */
export function draftFromCron(cron: string): ScheduleDraft {
  const custom: ScheduleDraft = { ...DEFAULT_DRAFT, every: "cron", cron: cron.trim() };
  const spec = parseCron(cron);
  if (!spec) return custom;
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return custom;
  const [mi, hr, dom, mon, dow] = f as [string, string, string, string, string];
  if (mon !== "*") return custom;
  const num = (x: string): number | null => (/^\d+$/.test(x) ? Number(x) : null);
  if (mi === "*" && hr === "*" && dom === "*" && dow === "*") return { ...DEFAULT_DRAFT, every: "minutes", n: 1 };
  const step = /^\*\/(\d+)$/.exec(mi);
  if (step && hr === "*" && dom === "*" && dow === "*") return { ...DEFAULT_DRAFT, every: "minutes", n: Number(step[1]) };
  const m = num(mi);
  if (m === null) return custom;
  if (hr === "*" && dom === "*" && dow === "*") return { ...DEFAULT_DRAFT, every: "hours", n: 1, time: `00:${two(m)}` };
  const hstep = /^\*\/(\d+)$/.exec(hr);
  if (hstep && dom === "*" && dow === "*") return { ...DEFAULT_DRAFT, every: "hours", n: Number(hstep[1]), time: `00:${two(m)}` };
  const h = num(hr);
  if (h === null || h > 23 || m > 59) return custom;
  const time = `${two(h)}:${two(m)}`;
  if (dom === "*" && dow === "*") return { ...DEFAULT_DRAFT, every: "day", time };
  if (dom === "*" && dow === "1-5") return { ...DEFAULT_DRAFT, every: "weekdays", time };
  if (dom === "*" && /^[0-6](,[0-6])*$/.test(dow)) return { ...DEFAULT_DRAFT, every: "week", time, days: dow.split(",").map(Number) };
  const d = num(dom);
  if (dow === "*" && d !== null && d >= 1 && d <= 31) return { ...DEFAULT_DRAFT, every: "month", time, day: d };
  return custom;
}

export interface ScheduleConfig { cron: string; timezone: string; missed: "skip" | "run_once" | "backfill_each_tick"; [key: string]: unknown }

/** What the trigger holds, read for the picker. A schedule with no readable cron has `cron` empty and the picker shows the default choice. */
export function scheduleOf(config: Record<string, unknown> | undefined, personTz: string): { cron: string; timezone: string; missed: ScheduleConfig["missed"]; draft: ScheduleDraft; set: boolean } {
  const cron = typeof config?.["cron"] === "string" ? config["cron"].trim() : "";
  const tz = typeof config?.["timezone"] === "string" && validTimeZone(config["timezone"]) ? config["timezone"] : personTz;
  const m = config?.["missed"];
  const missed = m === "run_once" || m === "backfill_each_tick" ? m : "skip";
  const set = cron !== "" && parseCron(cron) !== undefined;
  return { cron, timezone: tz, missed, draft: set ? draftFromCron(cron) : { ...DEFAULT_DRAFT }, set };
}

/** The config to store after an edit: the other keys the trigger holds stay. Null when the choice is not complete, so nothing half-made is saved. */
export function configFromDraft(prev: Record<string, unknown> | undefined, draft: ScheduleDraft, timezone: string): ScheduleConfig | null {
  const cron = cronFromDraft(draft);
  if (cron === null) return null;
  const m = prev?.["missed"];
  const missed = m === "run_once" || m === "backfill_each_tick" ? m : "skip";
  return { ...(prev ?? {}), cron, timezone, missed };
}

/** The problem with an incomplete choice, in words. Null when it is complete. */
export function draftProblem(d: ScheduleDraft): string | null {
  if (cronFromDraft(d) !== null) return null;
  if (d.every === "cron") return d.cron.trim() === "" ? "Write a cron line: minute hour day month weekday." : "That is not a cron line. Use five fields: minute hour day month weekday.";
  if (d.every === "minutes") return "Minutes must be a whole number from 1 to 59.";
  if (d.every === "hours" && (!Number.isInteger(d.n) || d.n < 1 || d.n > 23)) return "Hours must be a whole number from 1 to 23.";
  if (!timeParts(d.time)) return "Write the time as hours and minutes, such as 09:00.";
  if (d.every === "week") return "Pick at least one day.";
  return "The day of the month must be from 1 to 31.";
}

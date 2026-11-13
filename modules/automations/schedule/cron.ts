// Cron for automation schedules: the clock's cron (lib/clock.ts) under the names this module has always had, and the plain language and the preview built on it.
// A local time that does not exist when clocks spring forward fires at the first moment after the gap (the lead's decision of 13 Nov 2026; it used to be skipped that day). A time that happens twice when clocks fall back fires on its first pass only.
import { nextCron, parseCron } from "../../../lib/clock.ts";
import type { CronSpec } from "../../../lib/clock.ts";
import { validZone as validTimeZone } from "../../../lib/zones.ts";

export { nextCron, parseCron, validTimeZone };
export type { CronSpec };

const MINUTE = 60_000;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Field = CronSpec["min"];

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
  if (minuteStep !== undefined && hourAll && domAll && dowAll)
    return minuteStep === 1 ? "Every minute" : `Every ${minuteStep} minutes`;
  const hourStep = fullStep(hours, 0, 23);
  const onlyMinute = mins.length === 1 ? mins[0] : undefined;
  if (onlyMinute !== undefined && hourStep !== undefined && domAll && dowAll) {
    if (hourStep === 1 && onlyMinute === 0) return "Every hour";
    if (onlyMinute === 0) return `Every ${hourStep} hours`;
    return hourStep === 1
      ? `Every hour at minute ${String(onlyMinute).padStart(2, "0")}`
      : `Every ${hourStep} hours at minute ${String(onlyMinute).padStart(2, "0")}`;
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
export function nextOccurrences(
  cron: string,
  timezone: string,
  after: number,
  count = 5,
  bounds?: { startAt?: number; endAt?: number },
): NextOccurrences | { error: "bad_cron" | "bad_timezone" } {
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

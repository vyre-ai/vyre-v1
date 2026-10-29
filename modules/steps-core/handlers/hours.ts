// Open hours for a Wait. A time that lands outside the window moves to the next open start, at most 14 days ahead.
import { stepError } from "../projections.ts";

export interface OpenHours {
  timezone: string;
  days: number[];
  start: string;
  end: string;
}

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(text: string): { h: number; m: number } | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return { h, m: min };
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtc - utcMs;
}

function zoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let off = zoneOffsetMs(utcGuess, timeZone);
  off = zoneOffsetMs(utcGuess - off, timeZone);
  return utcGuess - off;
}

function local(ms: number, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: WEEK.indexOf(String(parts.weekday)),
  };
}

function addDays(year: number, month: number, day: number, n: number): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(year, month - 1, day));
  t.setUTCDate(t.getUTCDate() + n);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** The same instant when it is open, otherwise the next open start. */
export function nextOpen(atMs: number, hours: OpenHours): number {
  const start = clock(hours.start);
  const end = clock(hours.end);
  if (!hours.timezone || !start || !end || !Array.isArray(hours.days) || hours.days.length === 0) {
    throw stepError("validation.bad_input", "Open hours need a time zone, days, a start, and an end.", false);
  }
  const openDays = new Set(hours.days);
  const first = local(atMs, hours.timezone);
  for (let day = 0; day < 14; day++) {
    const date = addDays(first.year, first.month, first.day, day);
    const probe = zoned(date.year, date.month, date.day, 12, 0, hours.timezone);
    if (!openDays.has(local(probe, hours.timezone).weekday)) continue;
    const openAt = zoned(date.year, date.month, date.day, start.h, start.m, hours.timezone);
    const closeAt = zoned(date.year, date.month, date.day, end.h, end.m, hours.timezone);
    if (closeAt <= openAt) continue;
    if (atMs >= openAt && atMs < closeAt) return atMs;
    if (openAt >= atMs) return openAt;
  }
  throw stepError("validation.bad_input", "No open hours in the next 14 days.", false);
}

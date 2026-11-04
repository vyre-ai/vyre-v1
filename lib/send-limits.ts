// The Space sending limits (Console > Messaging > Rules): send.cap (most messages in a day), send.window ('8-20' | '9-17' | 'any', hours in the recipient's time zone when known, else the Space's)
// and send.throttle (messages a minute). Pure rules only: a module reads the three settings and its own list of send times, asks planSend, and either sends, holds the message for the time given or
// refuses it. Nothing here touches a database or a clock, so every module that sends can share it and stay a leaf.
//
// DECISION: the daily cap is a rolling 24 hours, counted from the earliest message still inside it, so the answer to "when does it reset" is one instant, not a calendar guess.
// DECISION: a held message is queued for the time it may leave, never dropped. The throttle uses whole minutes: a minute that is full pushes the message to the start of the next one.
// DECISION: a person typing a message is not made to wait (window and throttle apply to automations and agents), but a person's message still counts toward the cap and is refused over it.

export type SendWindow = "8-20" | "9-17" | "any";
export interface SendLimits { cap: number; window: SendWindow; perMinute: number }

export const DEFAULT_LIMITS: SendLimits = { cap: 2000, window: "8-20", perMinute: 20 };
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const MINUTE = 60_000;
const STEP = 15 * MINUTE;

export const capOk = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
export const throttleOk = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
export const windowOk = (v: unknown): v is SendWindow => v === "8-20" || v === "9-17" || v === "any";

/** The hours a window allows, or null for any time. */
export function windowHours(w: SendWindow): { start: number; end: number } | null {
  if (w === "any") return null;
  return w === "8-20" ? { start: 8, end: 20 } : { start: 9, end: 17 };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** The hour of day (0 to 23) at an instant in a time zone; an unknown zone reads as UTC. */
export function localHour(ms: number, zone: string): number {
  let f = formatters.get(zone);
  if (!f) {
    try { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }); } catch { f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" }); }
    formatters.set(zone, f);
  }
  for (const part of f.formatToParts(new Date(ms))) if (part.type === "hour") return Number(part.value) % 24;
  return 0;
}

export function inWindow(ms: number, zone: string, w: SendWindow): boolean {
  const h = windowHours(w);
  if (!h) return true;
  const hour = localHour(ms, zone);
  return hour >= h.start && hour < h.end;
}

/** The first instant at or after `ms` when the window is open (a quarter hour grid, which lines up with every real time zone). */
export function nextOpen(ms: number, zone: string, w: SendWindow): number {
  if (inWindow(ms, zone, w)) return ms;
  let t = ms - (ms % STEP) + STEP;
  for (let i = 0; i < 4 * 96; i++, t += STEP) if (inWindow(t, zone, w)) return t;
  return ms;
}

/** The first instant at or after `wanted` whose minute holds fewer than `perMinute` of the given send times. */
export function throttleSlot(ticks: readonly number[], wanted: number, perMinute: number): number {
  const counts = new Map<number, number>();
  for (const at of ticks) counts.set(Math.floor(at / MINUTE), (counts.get(Math.floor(at / MINUTE)) ?? 0) + 1);
  let t = wanted;
  while ((counts.get(Math.floor(t / MINUTE)) ?? 0) >= perMinute) t = (Math.floor(t / MINUTE) + 1) * MINUTE;
  return t;
}

export type Plan =
  | { ok: true; at: number; held: "window" | "throttle" | null }
  | { ok: false; reason: "send_cap_reached"; limit: number; resetAt: number };

export interface PlanIn {
  now: number;
  /** when the sender wants it to leave: now, or a time they chose */
  wanted: number;
  /** the recipient's time zone when known, else the Space's */
  zone: string;
  limits: SendLimits;
  /** the send times already used: sent, and slots reserved for messages still waiting */
  ticks: readonly number[];
  /** an automation or an agent; a person is not made to wait */
  bulk: boolean;
}

/** Decides one message: refused over the daily cap, else the time it may leave and what held it, if anything. */
export function planSend(i: PlanIn): Plan {
  const recent = i.ticks.filter((at) => at > i.now - DAY).sort((a, b) => a - b);
  if (recent.length >= i.limits.cap) return { ok: false, reason: "send_cap_reached", limit: i.limits.cap, resetAt: (recent[recent.length - i.limits.cap] ?? i.now) + DAY };
  if (!i.bulk) return { ok: true, at: i.wanted, held: null };
  let at = i.wanted;
  let held: "window" | "throttle" | null = null;
  for (let n = 0; n < 200; n++) {
    const open = nextOpen(at, i.zone, i.limits.window);
    if (open !== at) { at = open; held = "window"; }
    const slot = throttleSlot(i.ticks, at, i.limits.perMinute);
    if (slot === at) break;
    at = slot;
    if (held === null) held = "throttle";
  }
  return { ok: true, at, held };
}

const pad = (n: number): string => String(n).padStart(2, "0");
/** "14:05 UTC on 9 Oct" in plain words for the refusal text. */
export function whenText(ms: number, zone: string): string {
  const d = new Date(ms);
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); } catch { return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`; }
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts["hour"]}:${parts["minute"]} on ${parts["day"]} ${parts["month"]} (${zone})`;
}

export function capMessage(limit: number, resetAt: number, zone: string): string {
  return `This Space reached its limit of ${limit.toLocaleString("en-US")} messages a day. Sending opens again at ${whenText(resetAt, zone)}. An admin can raise the limit in Console, Messaging, Rules.`;
}
export function heldText(held: "window" | "throttle", at: number, zone: string): string {
  return held === "window" ? `Held until the sending window opens at ${whenText(at, zone)}.` : `Waiting its turn under the sending speed limit; it leaves at ${whenText(at, zone)}.`;
}

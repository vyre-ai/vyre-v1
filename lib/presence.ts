// Where a teammate is, for an agent that works for someone (owner ruling 3 Nov): online, away or offline, when they were last seen, their time zone and working hours, and from that when a
// message to them may go. One adapter reads presence (lane l-team1 serves it as `devices.presence`); everything else here is plain arithmetic on a clock, so the same inputs always give the same answer.
//
//   presence     devices.presence { people } -> { people: [{ personId, state, lastSeenAt?, awayUntil? }] }. A server without it answers "unknown" for everyone: nothing is held for a state nobody knows.
//   hours        the teammate's own Profile settings (profile.timezone, profile.working_hours), read through settings.public_of. Hours count only when the person set them: the shipped default of
//                9 to 5 UTC would hold messages to someone in Karachi for half their day.
//   when         now, when they are next online, or at a set time; never during away or outside their hours unless urgent. The latest of the reasons wins, and the reason is said in words.

export type PresenceState = "online" | "away" | "offline" | "unknown";
export interface Presence { personId: string; state: PresenceState; lastSeenAt?: number; awayUntil?: number }
export interface Hours { days: number[]; from: string; to: string }
export interface PublicTime { timezone?: string; hours?: Hours }

type Call = (cap: string, input: unknown) => Promise<unknown>;

const STATES: ReadonlySet<string> = new Set(["online", "away", "offline"]);

/** Presence of people, by id. A person the source does not name, or a source that is not there, reads "unknown". */
export async function readPresence(call: Call, people: readonly string[]): Promise<Map<string, Presence>> {
  const out = new Map<string, Presence>(people.map((p) => [p, { personId: p, state: "unknown" as const }]));
  if (people.length === 0) return out;
  try {
    const r = (await call("devices.presence", { people: [...people] })) as { people?: Array<Record<string, unknown>> } | null;
    for (const row of r?.people ?? []) {
      const id = typeof row["personId"] === "string" ? row["personId"] : "";
      if (!out.has(id)) continue;
      const state = typeof row["state"] === "string" && STATES.has(row["state"]) ? (row["state"] as PresenceState) : "unknown";
      out.set(id, {
        personId: id, state,
        ...(typeof row["lastSeenAt"] === "number" ? { lastSeenAt: row["lastSeenAt"] } : {}),
        ...(typeof row["awayUntil"] === "number" ? { awayUntil: row["awayUntil"] } : {}),
      });
    }
  } catch { /* no presence on this server yet: unknown */ }
  return out;
}

/** A teammate's time zone and working hours as they set them; nothing when they set neither or the read fails. */
export async function readPublicTime(call: Call, personId: string): Promise<PublicTime> {
  try {
    const r = (await call("settings.public_of", { personId })) as { timezone?: unknown; hours?: unknown } | null;
    const out: PublicTime = {};
    if (typeof r?.timezone === "string" && validZone(r.timezone)) out.timezone = r.timezone;
    const h = r?.hours as Partial<Hours> | undefined;
    if (h && Array.isArray(h.days) && typeof h.from === "string" && typeof h.to === "string" && HHMM.test(h.from) && HHMM.test(h.to)) out.hours = { days: h.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6), from: h.from, to: h.to };
    return out;
  } catch { return {}; }
}

const HHMM = /^[0-2][0-9]:[0-5][0-9]$/;
export function validZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Day of week (0 is Sunday) and minutes since midnight at `at` in the zone; an unknown zone reads as UTC. */
export function localClock(at: number, tz: string): { day: number; minutes: number } {
  const zone = validZone(tz) ? tz : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day: day < 0 ? 0 : day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
const mins = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Inside working hours? No hours means always. `to` before `from` is an overnight shift that belongs to the day it starts on. */
export function inHours(t: PublicTime, at: number): boolean {
  const h = t.hours;
  if (!h) return true;
  const { day, minutes } = localClock(at, t.timezone ?? "UTC");
  const from = mins(h.from), to = mins(h.to);
  if (from <= to) return h.days.includes(day) && minutes >= from && minutes < to;
  if (minutes >= from) return h.days.includes(day);
  return h.days.includes((day + 6) % 7) && minutes < to;
}

const STEP = 5 * 60_000;
/** The first moment at or after `at` inside working hours (to the five minutes), or null when none falls within eight days. */
export function nextInHours(t: PublicTime, at: number): number | null {
  if (inHours(t, at)) return at;
  const start = Math.ceil(at / STEP) * STEP;
  for (let x = start; x < at + 8 * 86_400_000; x += STEP) if (inHours(t, x)) return x;
  return null;
}

/** "3:40 PM" in the teammate's zone, for the context line and the tool's answer. */
export function localTime(at: number, tz: string | undefined): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz && validZone(tz) ? tz : "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

export type Timing = "now" | "online" | "at";
export type HoldReason = "away" | "after_hours" | "offline" | "later" | "limit" | "muted";
/** When a message may go. `at` null with `reason` "offline": when they next come online. */
export interface Due { at: number | null; reason?: HoldReason }

/**
 * When a message to a teammate goes. Now, unless: the person asked for a later time; the teammate is away (until their away ends, or until they are back); it is outside their hours (the next start);
 * or the person asked for "when they're next online" and they are not. Urgent skips away and hours, never a time the person picked.
 */
export function dueAt(o: { timing: Timing; at?: number; urgent?: boolean; presence: Presence; time: PublicTime; now: number }): Due {
  let due = o.now;
  let reason: HoldReason | undefined;
  if (o.timing === "at" && typeof o.at === "number" && o.at > due) { due = o.at; reason = "later"; }
  if (!o.urgent) {
    if (o.presence.state === "away") {
      if (o.presence.awayUntil === undefined) return { at: null, reason: "away" };
      if (o.presence.awayUntil > due) { due = o.presence.awayUntil; reason = "away"; }
    }
    const open = nextInHours(o.time, due);
    if (open === null) return { at: null, reason: "after_hours" };
    if (open > due) { due = open; reason = "after_hours"; }
  }
  if (o.timing === "online" && o.presence.state !== "online" && o.presence.state !== "unknown" && due === o.now) return { at: null, reason: o.presence.state === "away" ? "away" : "offline" };
  return reason === undefined ? { at: due } : { at: due, reason };
}

/** The end of the teammate's day in their zone (local midnight), for "Mute for today". */
export function endOfDay(at: number, tz: string | undefined): number {
  const { minutes } = localClock(at, tz ?? "UTC");
  const left = 24 * 60 - minutes;
  return Math.floor((at + left * 60_000) / 60_000) * 60_000;
}

/** Plain words for when it goes: "at 9:00 AM their time (after their hours)". */
export function dueWords(d: Due, name: string, tz: string | undefined, now: number): string {
  const first = name.split(" ")[0] || name;
  const why: Record<HoldReason, string> = {
    away: `${first} is away`, after_hours: `it is outside ${first}'s working hours`, offline: `${first} is offline`, later: "you picked the time", limit: `3 agent messages went to ${first} this hour`, muted: `${first} muted agent messages from you for today`,
  };
  if (d.at === null) return `when ${first} is next online${d.reason ? ` (${why[d.reason]})` : ""}`;
  if (d.at <= now) return "now";
  const day = Math.floor((d.at - now) / 86_400_000) >= 1 || localClock(d.at, tz ?? "UTC").day !== localClock(now, tz ?? "UTC").day;
  const when = `${day ? `${new Intl.DateTimeFormat("en-US", { timeZone: tz && validZone(tz) ? tz : "UTC", weekday: "short" }).format(new Date(d.at))} ` : ""}${localTime(d.at, tz)}${tz ? " their time" : ""}`;
  return `${when}${d.reason ? ` (${why[d.reason]})` : ""}`;
}

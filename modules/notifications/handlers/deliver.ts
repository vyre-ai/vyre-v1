// The notification settings that change delivery (P-CC_22b): Alerts (alert me on replies, routines also when they succeed), While you are away (hand Needs you to), Quiet hours.
// The settings module owns the values; it announces each change as settings.changed and this module keeps its own copy (notifications_setting) because a module may read only its own
// tables and settings.get answers for the caller, not for the person a notification is for. send() reads the copy through these functions.
import { clean, localClock } from "../projections.ts";
import type { Db, KindDef, Level, NotifCtx } from "../projections.ts";

export interface Quiet { on: boolean; from: string; to: string; needs: boolean }
export interface NotifSettings { alertReplies: boolean; routinesAll: boolean; handTo: string | null; quiet: Quiet }
const QUIET_DEFAULT: Quiet = { on: false, from: "22:00", to: "07:00", needs: true };
const KEYS = new Set(["notifications.alert_replies", "notifications.routines_all", "notifications.hand_needs_you_to", "notifications.quiet_hours"]);
const HHMM = /^[0-2][0-9]:[0-5][0-9]$/;

export function readSettings(db: Db, person: string): NotifSettings {
  const rows = db.all("SELECT key, value FROM notifications_setting WHERE person = ?", person) as { key: string; value: string }[];
  const v = new Map<string, unknown>();
  for (const r of rows) { try { v.set(String(r.key), JSON.parse(String(r.value))); } catch { /* an unreadable value is the default */ } }
  const q = v.get("notifications.quiet_hours") as Partial<Quiet> | undefined;
  const quiet: Quiet = q && typeof q === "object"
    ? { on: q.on === true, from: HHMM.test(String(q.from)) ? String(q.from) : QUIET_DEFAULT.from, to: HHMM.test(String(q.to)) ? String(q.to) : QUIET_DEFAULT.to, needs: q.needs !== false }
    : QUIET_DEFAULT;
  const hand = v.get("notifications.hand_needs_you_to");
  return { alertReplies: v.get("notifications.alert_replies") === true, routinesAll: v.get("notifications.routines_all") === true, handTo: typeof hand === "string" && hand ? hand : null, quiet };
}

/** The consumer of settings.changed: keep a copy of a person's notification settings. A reset to the default drops the row. */
export function syncSetting(db: Db, p: Record<string, unknown>): boolean {
  const key = String(p.key ?? "");
  const person = typeof p.person === "string" ? p.person : "";
  if (!KEYS.has(key) || !person || p.scope !== "person") return false;
  if (p.after === undefined) { db.run("DELETE FROM notifications_setting WHERE person = ? AND key = ?", person, key); return true; }
  db.run(
    `INSERT INTO notifications_setting (person, key, value) VALUES (?, ?, ?) ON CONFLICT(person, key) DO UPDATE SET value = excluded.value`, person, key, JSON.stringify(p.after),
  );
  return true;
}

const mins = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Quiet right now? Returns when it ends (the next minute the clock reads `to`) or undefined. Times are read in the person's working-hours zone, else UTC. */
export function quietUntil(q: Quiet, tz: string, at: number): number | undefined {
  if (!q.on) return undefined;
  const { minutes } = localClock(at, tz);
  const from = mins(q.from), to = mins(q.to);
  const inside = from === to ? false : from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  if (!inside) return undefined;
  const wait = (to - minutes + 1440) % 1440 || 1440;
  return at - (at % 60_000) + wait * 60_000;
}

/** Alerts: a followed reply interrupts only when the person asked to be alerted. Their own choice for the kind (kind.set_level) is applied before this. */
export function alertLevel(def: KindDef, level: Level, s: NotifSettings, chosen: boolean): Level {
  if (def.key === "reply.followed" && !chosen && s.alertReplies && level === "badge") return "interrupt";
  return level;
}

/** Quiet hours hold a push or banner (it waits in the digest). Needs you comes through when the person left that on, and calls always do. */
export function heldByQuiet(def: KindDef, level: Level, s: NotifSettings, tz: string, now: number, needsYou: boolean): number | undefined {
  if (level !== "interrupt" || def.key === "call.incoming") return undefined;
  if (needsYou && s.quiet.needs) return undefined;
  return quietUntil(s.quiet, tz, now);
}

/** One summary per person and quiet window, delivered when the window ends. */
export async function scheduleQuietSummary(ctx: NotifCtx, person: string, endsAt: number): Promise<void> {
  if (!ctx.schedule) return;
  const fresh = ctx.db.run("INSERT OR IGNORE INTO notifications_quiet_summary (person, at) VALUES (?, ?)", person, endsAt).changes > 0;
  if (!fresh) return;
  try {
    await ctx.schedule(endsAt, "notifications.send", clean({ to: person, kind: "digest.away", title: "Held while quiet hours were on", collapseKey: `quiet-summary:${person}:${endsAt}` }));
  } catch (e) { ctx.log?.warn("quiet summary not scheduled", (e as Error).message); }
}

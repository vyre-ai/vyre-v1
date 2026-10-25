// Notifications projections (spec 2.24, ARCH 3.5): the kind table, the person's rules, mutes, away and delegate chain, working hours, and the item rows.
// Durable tables: the generated notifications_items plus migrations/0001_notifications_state.sql. Every statement names only notifications_* tables (ctx.db refuses anything else, ARCH B2).
// The KINDS table below mirrors manifests/notifications.ts notificationKinds (frozen, ruling 9); the contract test of this module compares them.
import { fail } from "../../host/src/routes/errors.ts";

export type Level = "interrupt" | "badge" | "digest";
export type Place = "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console";
export type KindKey =
  | "approval.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed"
  | "agent.task_finished" | "campaign.reply" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided"
  | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due";
export type Action = { label: string; cap: string };
export interface KindDef {
  key: KindKey; level: Level; place: Place; title: string; pushTitle?: string; actions: Action[]; agentRateKey?: string; backstopEmailAfterHours?: number; respectHours: boolean;
}
const kind = (key: KindKey, level: Level, place: Place, title: string, o: Partial<Omit<KindDef, "key" | "level" | "place" | "title">> = {}): KindDef =>
  ({ key, level, place, title, actions: [], respectHours: true, ...o });
const a = (label: string, cap: string): Action => ({ label, cap });
const needsYou = (agent = true): Partial<KindDef> => ({ pushTitle: "{{space}} needs you", ...(agent ? { agentRateKey: "agent_interrupt" } : {}) });

export const KINDS: readonly KindDef[] = [
  kind("approval.requested", "interrupt", "chats", "Approval needed: {{title}}", { ...needsYou(), actions: [a("Approve", "tasks.act"), a("Send back", "tasks.act")], backstopEmailAfterHours: 4 }),
  kind("approval.backstop", "interrupt", "chats", "Still waiting on you: {{title}}", { pushTitle: "{{space}} needs you", actions: [a("Open", "tasks.act")], respectHours: false }),
  kind("dm", "interrupt", "chats", "Message from {{from}}", { ...needsYou(), actions: [a("Reply", "chat.post")] }),
  kind("mention", "interrupt", "chats", "{{from}} mentioned you in {{where}}", { ...needsYou(), actions: [a("Reply", "chat.post")] }),
  kind("call.incoming", "interrupt", "inbox", "Incoming call from {{from}}", { pushTitle: "{{space}} is calling", respectHours: false }),
  kind("agent.blocked", "interrupt", "chats", "{{agent}} is blocked: {{reason}}", { ...needsYou(), actions: [a("Unblock", "tasks.act")] }),
  kind("incident.owned", "interrupt", "console", "Incident you own: {{title}}", { pushTitle: "{{space}} needs you", respectHours: false }),
  kind("task.assigned", "badge", "home", "{{from}} gave you a task: {{title}}", { actions: [a("Start", "tasks.transition")] }),
  kind("reply.followed", "badge", "inbox", "New reply on {{where}}"),
  kind("agent.task_finished", "badge", "chats", "{{agent}} finished: {{title}}", { agentRateKey: "agent_interrupt" }),
  kind("campaign.reply", "badge", "apps", "Reply from {{from}} to {{campaign}}"),
  kind("digest.away", "digest", "home", "While you were away"),
  kind("mention.thread", "badge", "chats", "Mentioned in a thread: {{where}}", { actions: [a("Reply", "chat.post")] }),
  kind("run.failed", "badge", "automations", "{{name}} failed: {{message}}", { actions: [a("Retry", "runs.retry")] }),
  kind("conflict.needs_you", "badge", "records", "Two edits conflict on {{title}}", { actions: [a("Resolve", "tasks.act")] }),
  kind("access.requested", "badge", "console", "{{from}} asks for {{level}} access to {{title}}", { actions: [a("Review", "tasks.act")] }),
  kind("access.decided", "badge", "home", "Your access request for {{title}} was {{decision}}"),
  kind("sync.attention", "badge", "settings", "Sync needs attention on {{device}}"),
  kind("health.degraded", "badge", "console", "{{service}} is {{state}}"),
  kind("problem.report", "badge", "console", "Problem report from {{from}}", { actions: [a("Review", "tasks.act")] }),
  kind("member.joined", "digest", "home", "{{name}} joined {{space}}"),
  kind("limit.hit", "badge", "chats", "{{title}} hit its limit", { actions: [a("Raise once", "tasks.act"), a("Stop", "tasks.act")] }),
  kind("vault.rotation_due", "badge", "vault", "Time to rotate {{title}}", { actions: [a("Mark rotated", "vault.item.mark_rotated")] }),
];
export const kindOf = (k: string): KindDef | undefined => KINDS.find((x) => x.key === k);

/** Kinds the rail counts as Needs you (it shows a count only for these and for direct conversations); everything else is a quiet dot on its place. */
export const NEEDS_YOU_KINDS: ReadonlySet<string> = new Set(["approval.requested", "approval.backstop", "agent.blocked", "limit.hit", "conflict.needs_you", "access.requested"]);
export const DIRECT_KINDS: ReadonlySet<string> = new Set(["dm", "mention"]);
/** A mute silences a sender; these two carry a clock the person cannot choose to miss. */
export const UNMUTABLE_KINDS: ReadonlySet<string> = new Set(["approval.backstop", "incident.owned"]);

export const HOUR = 3_600_000;
export const AGENT_INTERRUPTS_PER_HOUR = 3;
export const DEFAULT_PUSH_IDLE_MINUTES = 5;
export const COLLAPSE_WINDOW_MS = 24 * HOUR;
export const DEFAULT_HOURS: Hours = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "UTC" };

export interface Hours { days: number[]; from: string; to: string; tz: string }
export interface Delegate { kind: "person" | "role" | "none"; id?: string }
export interface Target { kind: "person" | "agent" | "channel" | "record" | "thread"; id: string }
export interface Rules { workingHours?: Hours; emailBackstop: boolean; mutedAgents: string[]; mutedChannels: string[]; mutedRecords: string[] }
export interface ResourceRef { type: string; id: string }

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface NotifCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  device?: string;
  run?: string;
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: string; idempotencyKey?: string }): { id: string };
  call?(cap: string, input: unknown): Promise<unknown>;
  schedule?(at: number | string, cap: string, input: unknown): Promise<string>;
  seal?: { seal(v: Uint8Array, scope: string): { keyId: string; nonce: string; bytes: string }; unseal(s: { keyId: string; nonce: string; bytes: string }): Uint8Array };
  log?: { warn(...a: unknown[]): void };
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
/** The person a call is for: an agent acting for someone is that someone; anything else is the caller. */
export const meOf = (ctx: NotifCtx): string => ctx.actingFor ?? ctx.principal.id;
export const isService = (ctx: NotifCtx): boolean => ctx.principal.kind === "service" || ctx.principal.kind === "automation";
const parse = <T>(s: unknown, fallback: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fallback; } };

// ---- text ----

/** {{name}} filled from the data; an unknown name becomes empty and the line is tidied ("Message from " is never shown with a hole). */
export function render(tpl: string, vars: Record<string, unknown>): string {
  const s = tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
  return s.replace(/\s+/g, " ").replace(/\s+([:,.])/g, "$1").replace(/[:,]\s*$/, "").trim();
}

// ---- working hours ----

/** Day of week (0 is Sunday) and minutes since midnight at `at` in the zone; an unknown zone reads as UTC. */
export function localClock(at: number, tz: string): { day: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)); }
  catch { parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)); }
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day: day < 0 ? 0 : day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
const mins = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Inside working hours? `to` before `from` is an overnight shift that belongs to the day it starts on. */
export function withinHours(h: Hours | undefined, at: number): boolean {
  if (!h) return true;
  const { day, minutes } = localClock(at, h.tz);
  const from = mins(h.from), to = mins(h.to);
  if (from <= to) return h.days.includes(day) && minutes >= from && minutes < to;
  if (minutes >= from) return h.days.includes(day);
  return h.days.includes((day + 6) % 7) && minutes < to;
}

// ---- rules ----

export function readRules(db: Db, person: string): Rules {
  const r = db.all("SELECT * FROM notifications_rules WHERE person = ?", person)[0] as Record<string, unknown> | undefined;
  if (!r) return { workingHours: DEFAULT_HOURS, emailBackstop: true, mutedAgents: [], mutedChannels: [], mutedRecords: [] };
  const mode = String(r.hours_mode);
  return clean({
    workingHours: mode === "off" ? undefined : mode === "custom" ? parse<Hours>(r.working_hours, DEFAULT_HOURS) : DEFAULT_HOURS,
    emailBackstop: Number(r.email_backstop) === 1,
    mutedAgents: parse<string[]>(r.muted_agents, []), mutedChannels: parse<string[]>(r.muted_channels, []), mutedRecords: parse<string[]>(r.muted_records, []),
  }) as Rules;
}
export function writeRules(db: Db, person: string, r: Rules): void {
  const mode = r.workingHours === undefined ? "off" : JSON.stringify(r.workingHours) === JSON.stringify(DEFAULT_HOURS) ? "default" : "custom";
  db.run(
    `INSERT INTO notifications_rules (person, hours_mode, working_hours, email_backstop, muted_agents, muted_channels, muted_records) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(person) DO UPDATE SET hours_mode = excluded.hours_mode, working_hours = excluded.working_hours, email_backstop = excluded.email_backstop,
       muted_agents = excluded.muted_agents, muted_channels = excluded.muted_channels, muted_records = excluded.muted_records`,
    person, mode, r.workingHours ? JSON.stringify(r.workingHours) : null, r.emailBackstop ? 1 : 0,
    JSON.stringify(r.mutedAgents), JSON.stringify(r.mutedChannels), JSON.stringify(r.mutedRecords),
  );
}

// ---- mutes ----

export function activeMutes(db: Db, person: string, now: number): { target: Target; until: number }[] {
  db.run("DELETE FROM notifications_mutes WHERE person = ? AND until <= ?", person, now);
  return (db.all("SELECT target_kind, target_id, until FROM notifications_mutes WHERE person = ? ORDER BY until, target_kind, target_id", person) as { target_kind: Target["kind"]; target_id: string; until: number }[])
    .map((m) => ({ target: { kind: m.target_kind, id: m.target_id }, until: Number(m.until) }));
}
/** The senders a notification comes from, as mute targets: the person who wrote, the agent, the channel, the thread, the record. */
export function sourcesOf(data: Record<string, unknown> | undefined, subject: ResourceRef | undefined, principal: { kind: string; id: string }): Target[] {
  const out: Target[] = [];
  const add = (kind: Target["kind"], v: unknown): void => { if (typeof v === "string" && v) out.push({ kind, id: v }); };
  add("person", data?.fromId ?? (typeof data?.from === "string" && /^usr_/.test(data.from) ? data.from : undefined));
  add("agent", data?.agentId ?? (principal.kind === "agent" ? principal.id : undefined));
  add("channel", data?.channelId);
  add("thread", data?.threadId);
  if (subject && subject.type === "record") add("record", subject.id);
  if (subject && subject.type === "thread") add("thread", subject.id);
  if (subject && subject.type === "channel") add("channel", subject.id);
  return out;
}
export function isMuted(db: Db, rules: Rules, person: string, sources: Target[], now: number): boolean {
  const mutes = activeMutes(db, person, now);
  return sources.some((s) => {
    if (mutes.some((m) => m.target.kind === s.kind && m.target.id === s.id)) return true;
    if (s.kind === "agent") return rules.mutedAgents.includes(s.id);
    if (s.kind === "channel") return rules.mutedChannels.includes(s.id);
    if (s.kind === "record") return rules.mutedRecords.includes(s.id);
    return false;
  });
}

// ---- away and delegate ----

export interface Away { until: number; delegate: Delegate; since: number }
export function readAway(db: Db, person: string, now: number): Away | undefined {
  const r = db.all("SELECT until, delegate, since FROM notifications_away WHERE person = ?", person)[0] as { until: number; delegate: string; since: number } | undefined;
  if (!r || Number(r.until) <= now) return undefined;
  return { until: Number(r.until), delegate: parse<Delegate>(r.delegate, { kind: "none" }), since: Number(r.since) };
}
export function readChain(db: Db, person: string): Delegate[] {
  const r = db.all("SELECT chain FROM notifications_delegates WHERE person = ?", person)[0] as { chain: string } | undefined;
  return r ? parse<Delegate[]>(r.chain, []) : [];
}

// ---- rows ----

export interface Row {
  id: string; person: string; kind: KindKey; level: Level; place: Place; title: string; body?: string; subject?: ResourceRef; count: number; at: number; seenAt?: number;
  actions: Action[]; collapseKey?: string; runId?: string; traceId?: string;
}
export function rowOf(r: Record<string, unknown>): Row {
  return clean({
    id: String(r.id), person: String(r.person), kind: String(r.kind) as KindKey, level: String(r.level) as Level, place: String(r.place) as Place, title: String(r.title ?? ""),
    body: r.body == null ? undefined : String(r.body),
    subject: r.subject_type ? { type: String(r.subject_type), id: String(r.subject_id) } : undefined,
    count: Math.max(1, Number(r.count ?? 1)), at: Number(r.at), seenAt: r.seen_at == null ? undefined : Number(r.seen_at),
    actions: parse<Action[]>(r.actions, []), collapseKey: r.collapse_key == null ? undefined : String(r.collapse_key),
    runId: r.run_id == null ? undefined : String(r.run_id), traceId: r.trace_id == null ? undefined : String(r.trace_id),
  }) as Row;
}
export const outRow = (r: Row, spaceId: string): Record<string, unknown> =>
  clean({ id: r.id, kind: r.kind, level: r.level, place: r.place, title: r.title, body: r.body, subject: r.subject, count: r.count, at: r.at, seenAt: r.seenAt, actions: r.actions, spaceId });
export const findRow = (db: Db, id: string): Row | undefined => {
  const r = db.all("SELECT * FROM notifications_items WHERE id = ? AND deleted_at IS NULL", id)[0] as Record<string, unknown> | undefined;
  return r ? rowOf(r) : undefined;
};

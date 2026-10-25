// calendar store helpers (ARCH 7.3). The shared pieces of the calendar handlers: the context subset they use, row readers, id helpers, the row to
// contract mappers, time arithmetic (busy blocks, 15 minute grid, working hours) and the one-time schema apply. calendar keeps no inline projection:
// its two entities are read straight from the tables below, and the Today feed of Home is calendar.list_events over one day.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface CalDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the calendar handlers use; the host Ctx satisfies it. */
export interface CalCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  run?: string;
  now(): number;
  db: CalDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(
    action: { perm: string | null; level: "view" | "use" | "edit" | "manage" },
    resource: { type: string; id: string | null },
  ): { effect: "allow" | "deny" | "hold"; reason: string; decisionId: string };
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Level = "view" | "use" | "edit" | "manage";
export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;
export type Response = "needs_action" | "accepted" | "declined" | "tentative";
export type JoinProvider = "zoom" | "meet" | "teams" | "none";

export interface Attendee {
  email: string;
  name?: string;
  contactId?: string;
  optional?: boolean;
  response?: Response;
}

export const EMAIL = /^[^\s@]+@[^\s@]+$/;
/** Drag in 15 minute steps (spec 2.18, flow 4): the grid the Calendar view snaps to, and the grid Find a time answers on. */
export const STEP_MS = 15 * 60_000;
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

// ---- ids and errors

/** `prefix_` plus 32 lowercase hex digits: the shape every id pattern in the manifests accepts (^prefix_[a-z0-9]+$). */
export function newId(prefix: string, now: number): string {
  return `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
}

export function isId(prefix: string, value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[a-z0-9]+$`).test(value);
}

export function bad(ctx: Pick<CalCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}
export function missing(ctx: Pick<CalCtx, "trace">, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}
export function refuse(ctx: Pick<CalCtx, "trace">, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}
export const codeOf = (e: unknown): string => {
  const shaped = e as { error?: { code?: unknown } } | null;
  return typeof shaped?.error?.code === "string" ? shaped.error.code : "";
};

/** Ask the host to authorize `level` on a resource; used where the capability cannot bind the resource itself. */
export function allow(ctx: CalCtx, level: Level, resource: { type: string; id: string | null }): void {
  const decision = ctx.authorize({ perm: null, level }, resource);
  if (decision.effect === "allow") return;
  if (decision.reason.toLowerCase().includes("clearance")) throw fail("permission.above_clearance", ctx.trace.traceId);
  throw fail("permission.no_grant", ctx.trace.traceId);
}
export function can(ctx: CalCtx, level: Level, resource: { type: string; id: string | null }): boolean {
  return ctx.authorize({ perm: null, level }, resource).effect === "allow";
}

// ---- rows

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
}
export const rowsOf = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof r === "object");
export function str(row: Row | null, key: string): string {
  const v = row?.[key];
  return typeof v === "string" ? v : "";
}
export function num(row: Row | null, key: string): number {
  const v = row?.[key];
  return typeof v === "number" ? v : 0;
}
export function strOrNull(row: Row | null, key: string): string | null {
  const v = row?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");

export const normalizeEmail = (address: string): string => address.trim().toLowerCase();

export function readStrings(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const RESPONSES: readonly Response[] = ["needs_action", "accepted", "declined", "tentative"];

export function readAttendees(value: unknown): Attendee[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Attendee[] = [];
    for (const item of parsed) {
      const rec = obj(item);
      if (typeof rec.email !== "string" || !rec.email) continue;
      const a: Attendee = { email: rec.email };
      if (typeof rec.name === "string" && rec.name) a.name = rec.name;
      if (typeof rec.contactId === "string" && rec.contactId) a.contactId = rec.contactId;
      if (typeof rec.optional === "boolean") a.optional = rec.optional;
      if (typeof rec.response === "string" && (RESPONSES as readonly string[]).includes(rec.response)) a.response = rec.response as Response;
      out.push(a);
    }
    return out;
  } catch {
    return [];
  }
}

/** Attendees in the order given, lower-case addresses, one row per address (the first wins), the answer kept when the address was already on the event. */
export function cleanAttendees(ctx: Pick<CalCtx, "trace">, given: unknown, before: Attendee[] = []): Attendee[] {
  if (!Array.isArray(given)) bad(ctx, "Attendees are a list.");
  if (given.length > 200) bad(ctx, "An event has at most 200 attendees.");
  const had = new Map(before.map((a) => [normalizeEmail(a.email), a] as const));
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const item of given) {
    const rec = obj(item);
    const email = typeof rec.email === "string" ? normalizeEmail(rec.email) : "";
    if (!EMAIL.test(email)) bad(ctx, "Every attendee needs an email address.");
    if (seen.has(email)) continue;
    seen.add(email);
    const a: Attendee = { email };
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (name) a.name = name;
    if (typeof rec.contactId === "string" && rec.contactId) {
      if (!isId("rec", rec.contactId)) bad(ctx, "An attendee's contact is a record id.");
      a.contactId = rec.contactId;
    }
    if (typeof rec.optional === "boolean") a.optional = rec.optional;
    const asked = typeof rec.response === "string" && (RESPONSES as readonly string[]).includes(rec.response) ? (rec.response as Response) : undefined;
    a.response = asked ?? had.get(email)?.response ?? "needs_action";
    out.push(a);
  }
  return out;
}

// ---- contract shapes

export interface CalendarOut {
  id: string;
  title: string;
  color: string;
  provider: "google" | "microsoft" | "local";
  connectionId?: string;
  ownerId: string;
  personal: boolean;
  state: "syncing" | "paused" | "error";
}

export function toCalendar(row: Row): CalendarOut {
  const provider = str(row, "provider");
  const state = str(row, "state");
  const out: CalendarOut = {
    id: str(row, "id"), title: str(row, "title"), color: str(row, "color") || "#4f6bed",
    provider: provider === "google" || provider === "microsoft" ? provider : "local",
    ownerId: str(row, "ownerId"), personal: num(row, "personal") === 1,
    state: state === "paused" || state === "error" ? state : "syncing",
  };
  const connection = strOrNull(row, "connectionId");
  if (connection) out.connectionId = connection;
  return out;
}

export interface EventOut {
  id: string;
  calendarId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  allDay: boolean;
  location?: string;
  joinUrl?: string;
  joinProvider: JoinProvider;
  description?: string;
  agenda?: string;
  attendees: Attendee[];
  organizer?: string;
  recordIds: string[];
  meetingId?: string;
  status: "confirmed" | "tentative" | "canceled";
  bookedByAgentId?: string;
  fromBookingPage?: string;
}

export function toEvent(row: Row): EventOut {
  const join = str(row, "joinProvider");
  const status = str(row, "status");
  const out: EventOut = {
    id: str(row, "id"), calendarId: str(row, "calendarId"), title: str(row, "title"), startsAt: num(row, "startsAt"), endsAt: num(row, "endsAt"), allDay: num(row, "allDay") === 1,
    joinProvider: join === "zoom" || join === "meet" || join === "teams" ? join : "none",
    attendees: readAttendees(row.attendees), recordIds: readStrings(row.recordIds),
    status: status === "tentative" || status === "canceled" ? status : "confirmed",
  };
  for (const key of ["location", "joinUrl", "description", "agenda", "organizer", "meetingId", "bookedByAgentId", "fromBookingPage"] as const) {
    const v = strOrNull(row, key);
    if (v) out[key] = v;
  }
  return out;
}

// ---- time

/** Round a time up to the next 15 minute mark (an exact mark stays). */
export const ceilToStep = (ts: number): number => Math.ceil(ts / STEP_MS) * STEP_MS;
/** Round a time to the nearest 15 minute mark: what a drag on the Week grid lands on. */
export const snapToStep = (ts: number): number => Math.round(ts / STEP_MS) * STEP_MS;

export interface Span { s: number; e: number }

/** Sort and join overlapping or touching spans. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((x) => x.e > x.s).map((x) => ({ ...x })).sort((a, b) => a.s - b.s || a.e - b.e);
  const out: Span[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e);
    else out.push(x);
  }
  return out;
}

export interface Hours { days: number[]; from: string; to: string; timeZone: string }

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(ts: number, timeZone: string): { dow: number; day: string; minute: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ts))) p[part.type] = part.value;
  return { dow: DOW[p.weekday ?? "Sun"] ?? 0, day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True when [start, end) sits inside one working day of the hours: the right weekday, and between the opening and closing minute. */
export function insideHours(start: number, end: number, hours: Hours): boolean {
  const a = localParts(start, hours.timeZone);
  const b = localParts(end - 1, hours.timeZone);
  if (a.day !== b.day || !hours.days.includes(a.dow)) return false;
  return a.minute >= minutesOf(hours.from) && b.minute < minutesOf(hours.to);
}

export const DEFAULT_HOURS: Hours = { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", timeZone: "UTC" };

/**
 * The next free slots: starts on the 15 minute grid, each at least `gap` after the previous one, never over a busy span, and inside working hours when given.
 * `busy` must be merged (mergeSpans). The search stops at `limit` slots or at `to`.
 */
export function freeSlots(busy: readonly Span[], from: number, to: number, durationMs: number, limit: number, hours: Hours | null, gap = 2 * STEP_MS): Span[] {
  const out: Span[] = [];
  let t = ceilToStep(from);
  let at = 0;
  let lastStart = -Infinity;
  while (t + durationMs <= to && out.length < limit) {
    while (at < busy.length && (busy[at]?.e ?? 0) <= t) at++;
    const blocker = busy[at];
    if (blocker && blocker.s < t + durationMs) {
      t = Math.max(t + STEP_MS, ceilToStep(blocker.e));
      continue;
    }
    if (t - lastStart >= gap && (!hours || insideHours(t, t + durationMs, hours))) {
      out.push({ s: t, e: t + durationMs });
      lastStart = t;
    }
    t += STEP_MS;
  }
  return out;
}

// ---- provider times

/** Google Calendar { date } or { dateTime }: milliseconds, and whether it is an all-day value. */
export function googleTime(value: unknown): { ts: number; allDay: boolean } | undefined {
  const r = obj(value);
  const dateTime = text(r.dateTime);
  if (dateTime) {
    const ts = Date.parse(dateTime);
    return Number.isFinite(ts) ? { ts, allDay: false } : undefined;
  }
  const date = text(r.date);
  if (date) {
    const ts = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(ts) ? { ts, allDay: true } : undefined;
  }
  return undefined;
}

/** Graph { dateTime, timeZone }. The connector asks for UTC, so a value with no offset is read as UTC. */
export function graphTime(value: unknown): number | undefined {
  const r = obj(value);
  let dateTime = text(r.dateTime);
  if (!dateTime) return undefined;
  dateTime = dateTime.replace(/(\.\d{3})\d+/, "$1");
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(dateTime)) dateTime += "Z";
  const ts = Date.parse(dateTime);
  return Number.isFinite(ts) ? ts : undefined;
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_calendar_core.sql", import.meta.url)), "utf8");

export function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? "";
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Make sure the calendar tables exist. The probe is one cheap SELECT per call; only when it fails are the CREATE ... IF NOT EXISTS statements applied,
 * so a host that already ran the migration (or the generated schema) pays nothing more.
 */
export function ensure(ctx: Pick<CalCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "calendarId" FROM calendar_sync WHERE "calendarId" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export const inline = {};
export const consumers = {};
export const codecs = {};

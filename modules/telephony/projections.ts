// telephony store helpers (spec 2.18, 3.3; ARCH 7.3, 8.2): the context subset the handlers use, the schema apply, the readers and mappers that turn rows into the frozen shapes, and the small
// rules the handlers share (ids, settings, the person/agent/automation actor, send windows, hours of a number). Rows are read with `SELECT *` and sorted in code; every camelCase column is quoted.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface TelDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the telephony handlers use; the host Ctx satisfies it. */
export interface TelCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  /** where the call came from: 'user' for a person at a screen, anything else for automations, campaigns and other engines */
  origin?: string;
  now(): number;
  db: TelDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown, opts?: { traceId?: string }): Promise<unknown>;
  schedule?(at: number, cap: string, input: unknown): Promise<string>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Val = string | number | null;
export type Row = Record<string, Val>;
export type Json = Record<string, unknown>;

// ---- readers

export const first = (rows: unknown[]): Row | null => {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
};
export const rowsOf = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof r === "object");
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const str = (r: Row | null, k: string): string => (r && typeof r[k] === "string" ? (r[k] as string) : "");
export const strOrNull = (r: Row | null, k: string): string | null => (r && typeof r[k] === "string" && r[k] !== "" ? (r[k] as string) : null);
export const num = (r: Row | null, k: string): number => (r && typeof r[k] === "number" ? (r[k] as number) : 0);
export const numOrNull = (r: Row | null, k: string): number | null => (r && typeof r[k] === "number" ? (r[k] as number) : null);
export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

export function parseJson<T>(v: Val | undefined, fallback: T): T {
  if (typeof v !== "string" || v === "") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

// ---- errors

export function bad(ctx: Pick<TelCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}
export function refuse(ctx: Pick<TelCtx, "trace">, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}
export function missing(ctx: Pick<TelCtx, "trace">, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}

/** The idempotency key of a capability declared `idem: 'key'`; the invoke pipeline has checked it, a direct call without one is a bad input. */
export function keyOf(ctx: Pick<TelCtx, "trace">, input: unknown): string {
  const k = obj(input).idempotencyKey;
  return typeof k === "string" && k !== "" ? k : bad(ctx, "An idempotency key is required.");
}

// ---- ids and shapes

export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export const isId = (prefix: string, v: unknown): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-z0-9]+$`).test(v);
export const E164 = /^\+[1-9][0-9]{6,14}$/;
export function phone(ctx: Pick<TelCtx, "trace">, v: unknown, what: string): string {
  return typeof v === "string" && E164.test(v) ? v : bad(ctx, `${what} must be a phone number with country code, like +14155550123.`);
}
export function need(ctx: Pick<TelCtx, "trace">, id: unknown, prefix: string, what: string): string {
  return isId(prefix, id) ? id : bad(ctx, `${what} id is not valid.`);
}

export interface Party { kind: "person" | "agent" | "group"; id: string }

export function pageOf<T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { page: T[]; next?: string; total: number } {
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit ?? 100;
  return { page: items.slice(start, start + size), ...(start + size < items.length ? { next: String(start + size) } : {}), total: items.length };
}

/** page arguments, validated: a bad cursor or limit is a bad input, not a crash */
export function paging(ctx: Pick<TelCtx, "trace">, o: Json): { cursor: string | undefined; limit: number | undefined } {
  const cursor = o["cursor"];
  const limit = o["limit"];
  if (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor))) bad(ctx, "The cursor is not valid.");
  if (limit !== undefined && (!isInt(limit) || limit < 1 || limit > 500)) bad(ctx, "The limit is 1 to 500.");
  return { cursor: cursor as string | undefined, limit: limit as number | undefined };
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_telephony.sql", import.meta.url)), "utf8");

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

/** Make sure this module's tables exist: one cheap SELECT per call, the CREATE ... IF NOT EXISTS statements only when it fails. */
export function ensure(ctx: Pick<TelCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "key" FROM telephony_state WHERE "key" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function getState(ctx: Pick<TelCtx, "db">, key: string): string | null {
  const row = first(ctx.db.all(`SELECT * FROM telephony_state WHERE "key" = ?`, key));
  return row && typeof row.value === "string" ? row.value : null;
}
export function setState(ctx: Pick<TelCtx, "db">, key: string, value: string): void {
  if (getState(ctx, key) === null) ctx.db.run(`INSERT OR IGNORE INTO telephony_state ("key", "value") VALUES (?, ?)`, key, value);
  else ctx.db.run(`UPDATE telephony_state SET "value" = ? WHERE "key" = ?`, value, key);
}

// ---- settings

/** A Space setting, or the manifest default when the settings service gives nothing usable. */
export async function setting<T>(ctx: TelCtx, key: string, fallback: T, ok: (v: unknown) => v is T): Promise<T> {
  try {
    const value = obj(obj(await ctx.call("settings.get", { key })).row).value;
    return ok(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

// ---- who is acting (the same rule as the single send API)

export type Actor = "person" | "agent" | "automation" | "campaign";
export function actorOf(ctx: Pick<TelCtx, "principal" | "origin">): Actor {
  if (ctx.principal.kind === "agent") return "agent";
  const from = ctx.origin ?? "user";
  if (from.startsWith("campaign")) return "campaign";
  if (from !== "user" || ctx.principal.kind === "service" || ctx.principal.kind === "actor") return "automation";
  return "person";
}
/** The party a call or text is handled by: a person or an agent; anything else cannot hold a call. */
export function partyOf(ctx: Pick<TelCtx, "principal" | "trace">): Party {
  if (ctx.principal.kind === "person" || ctx.principal.kind === "agent") return { kind: ctx.principal.kind, id: ctx.principal.id };
  return refuse(ctx, "Only a person or an agent can take part in a call.");
}

// ---- time

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function validZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Weekday (0 Sunday to 6 Saturday), hour and minute of an instant in a zone. */
export function localTime(ms: number, zone: string): { day: number; hour: number; minute: number } {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
    formatters.set(zone, f);
  }
  let day = 0;
  let hour = 0;
  let minute = 0;
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type === "weekday") day = WEEKDAY[part.value] ?? 0;
    if (part.type === "hour") hour = Number(part.value) % 24;
    if (part.type === "minute") minute = Number(part.value);
  }
  return { day, hour, minute };
}

// ---- numbers

export interface RouteCfg { ring: Party[]; ringSeconds: number; voicemail: boolean; voicemailTranscript: boolean }
export interface HoursCfg { zone: string; weekly: { day: number; start: string; end: string }[]; outsideHours: "voicemail" | "ring" | "reject" }

export const DEFAULT_ROUTE: RouteCfg = { ring: [], ringSeconds: 20, voicemail: true, voicemailTranscript: true };
export const DEFAULT_HOURS: HoursCfg = { zone: "UTC", weekly: [], outsideHours: "voicemail" };

export function formatNumber(e164: string): string {
  const us = /^\+1([2-9][0-9]{2})([2-9][0-9]{2})([0-9]{4})$/.exec(e164);
  return us ? `+1 (${us[1]}) ${us[2]}-${us[3]}` : e164;
}

export function numberOut(r: Row): Json {
  const out: Json = {
    id: str(r, "id"), e164: str(r, "e164"), title: str(r, "title"), displayName: str(r, "title") || formatNumber(str(r, "e164")),
    capabilities: parseJson<string[]>(r["capabilities"], ["voice", "sms"]), assigneeKind: str(r, "assigneeKind") || "inbox",
    route: { ...DEFAULT_ROUTE, ...parseJson<Partial<RouteCfg>>(r["route"], {}) }, hours: { ...DEFAULT_HOURS, ...parseJson<Partial<HoursCfg>>(r["hours"], {}) },
    recording: str(r, "recording") || "off", a2p: str(r, "a2p") || "none", state: str(r, "state") || "active",
  };
  if (str(r, "assigneeId")) out.assigneeId = str(r, "assigneeId");
  return out;
}

export function liveNumber(ctx: TelCtx, id: string): Row {
  const row = first(ctx.db.all(`SELECT * FROM telephony_number WHERE id = ?`, id));
  if (!row || (row.deleted_at !== null && row.deleted_at !== undefined)) return missing(ctx, "That number is not in this Space.");
  return row;
}

export function numberByE164(ctx: TelCtx, e164: string): Row | null {
  return rowsOf(ctx.db.all(`SELECT * FROM telephony_number WHERE "e164" = ?`, e164)).find((r) => r.deleted_at === null || r.deleted_at === undefined) ?? null;
}

// ---- calls and texts

export function callOut(r: Row): Json {
  const out: Json = {
    id: str(r, "id"), numberId: str(r, "numberId"), direction: str(r, "direction"), from: str(r, "from"), to: str(r, "to"), state: str(r, "state"),
    startedAt: num(r, "startedAt"), hasTranscript: strOrNull(r, "transcript") !== null, consentLogged: num(r, "consentLogged") === 1,
  };
  if (strOrNull(r, "contactId")) out.contactId = str(r, "contactId");
  if (numOrNull(r, "answeredAt") !== null) out.answeredAt = num(r, "answeredAt");
  if (numOrNull(r, "endedAt") !== null) out.endedAt = num(r, "endedAt");
  if (numOrNull(r, "durationSec") !== null) out.durationSec = num(r, "durationSec");
  const by = parseJson<Party | null>(r["handledBy"], null);
  if (by) out.handledBy = by;
  if (strOrNull(r, "recordingFileId")) out.recordingFileId = str(r, "recordingFileId");
  if (strOrNull(r, "summary")) out.summary = str(r, "summary");
  return out;
}

export function smsOut(r: Row): Json {
  const out: Json = {
    id: str(r, "id"), numberId: str(r, "numberId"), direction: str(r, "direction"), from: str(r, "from"), to: str(r, "to"), body: str(r, "body"), status: str(r, "status"),
    mediaFileIds: parseJson<string[]>(r["mediaFileIds"], []), at: num(r, "at"),
  };
  if (strOrNull(r, "contactId")) out.contactId = str(r, "contactId");
  if (strOrNull(r, "campaignId")) out.campaignId = str(r, "campaignId");
  return out;
}

export function liveCall(ctx: TelCtx, id: string): Row {
  const row = first(ctx.db.all(`SELECT * FROM telephony_call WHERE id = ?`, id));
  return row ?? missing(ctx, "That call is not in this Space.");
}

export function callMeta(ctx: TelCtx, callId: string): Row {
  const row = first(ctx.db.all(`SELECT * FROM telephony_call_meta WHERE "callId" = ?`, callId));
  if (row) return row;
  ctx.db.run(`INSERT OR IGNORE INTO telephony_call_meta ("callId", "hold", "recording") VALUES (?, ?, ?)`, callId, 0, 0);
  return { callId, hold: 0, recording: 0, recordingSid: null, consent: null, ringing: null, declined: null, ingestedSid: null };
}

export function setMeta(ctx: TelCtx, callId: string, fields: Record<string, Val>): void {
  callMeta(ctx, callId);
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  ctx.db.run(`UPDATE telephony_call_meta SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE "callId" = ?`, ...keys.map((k) => fields[k] ?? null), callId);
}

/** Update columns of a row by id and bump its version and time. */
export function patch(ctx: TelCtx, table: string, id: string, fields: Record<string, Val>): void {
  const row = first(ctx.db.all(`SELECT * FROM ${table} WHERE id = ?`, id));
  const keys = Object.keys(fields);
  ctx.db.run(`UPDATE ${table} SET ${[...keys, "version", "updated_at"].map((k) => `"${k}" = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => fields[k] ?? null), num(row, "version") + 1, ctx.now(), id);
}

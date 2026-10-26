// meetings store helpers (spec 2.18; ARCH 8.3): the context subset the handlers use, the schema apply and the readers. Meeting data itself lives in records; rows here are the merge index,
// the recording and transcript, and the Runs. Rows are read with `SELECT *` and sorted in code; every camelCase column is quoted.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface MeetDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the telephony handlers use; the host Ctx satisfies it. */
export interface MeetCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  /** where the call came from: 'user' for a person at a screen, anything else for automations, campaigns and other engines */
  origin?: string;
  now(): number;
  db: MeetDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  schedule?(at: number, cap: string, input: unknown): Promise<string>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Val = string | number | null;
export type Row = Record<string, Val>;
export type Json = Record<string, unknown>;

// ---- readers

/** A datetime field holds an ISO date (the record store refuses a number); the module works in milliseconds. */
export const isoOf = (ms: number): string => new Date(ms).toISOString();
/** Milliseconds from a datetime field: an ISO string, or a number from a row written before this rule; undefined when it is neither. */
export function msOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : undefined; }
  return undefined;
}

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

export function bad(ctx: Pick<MeetCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}
export function refuse(ctx: Pick<MeetCtx, "trace">, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}
export function missing(ctx: Pick<MeetCtx, "trace">, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}

/** The idempotency key of a capability declared `idem: 'key'`; the invoke pipeline has checked it, a direct call without one is a bad input. */
export function keyOf(ctx: Pick<MeetCtx, "trace">, input: unknown): string {
  const k = obj(input).idempotencyKey;
  return typeof k === "string" && k !== "" ? k : bad(ctx, "An idempotency key is required.");
}

// ---- ids and shapes

export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export const isId = (prefix: string, v: unknown): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-z0-9]+$`).test(v);
export function pageOf<T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { page: T[]; next?: string; total: number } {
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit ?? 100;
  return { page: items.slice(start, start + size), ...(start + size < items.length ? { next: String(start + size) } : {}), total: items.length };
}

/** page arguments, validated: a bad cursor or limit is a bad input, not a crash */
export function paging(ctx: Pick<MeetCtx, "trace">, o: Json): { cursor: string | undefined; limit: number | undefined } {
  const cursor = o["cursor"];
  const limit = o["limit"];
  if (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor))) bad(ctx, "The cursor is not valid.");
  if (limit !== undefined && (!isInt(limit) || limit < 1 || limit > 500)) bad(ctx, "The limit is 1 to 500.");
  return { cursor: cursor as string | undefined, limit: limit as number | undefined };
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_meetings.sql", import.meta.url)), "utf8");

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
export function ensure(ctx: Pick<MeetCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "key" FROM meetings_state WHERE "key" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function getState(ctx: Pick<MeetCtx, "db">, key: string): string | null {
  const row = first(ctx.db.all(`SELECT * FROM meetings_state WHERE "key" = ?`, key));
  return row && typeof row.value === "string" ? row.value : null;
}
export function setState(ctx: Pick<MeetCtx, "db">, key: string, value: string): void {
  if (getState(ctx, key) === null) ctx.db.run(`INSERT OR IGNORE INTO meetings_state ("key", "value") VALUES (?, ?)`, key, value);
  else ctx.db.run(`UPDATE meetings_state SET "value" = ? WHERE "key" = ?`, value, key);
}

// ---- meetings

export type Provider = "zoom" | "meet" | "teams" | "none";
export type SourceKind = "zoom" | "meet" | "teams" | "upload";

/** The provider a join link belongs to, by its host. */
export function providerOfUrl(url: string | undefined): Provider {
  if (!url) return "none";
  let host = "";
  try { host = new URL(url).host.toLowerCase(); } catch { return "none"; }
  if (host.endsWith("zoom.us") || host.endsWith("zoom.com")) return "zoom";
  if (host === "meet.google.com") return "meet";
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) return "teams";
  return "none";
}

/** A join link compared without the query: the same room with a different password or tracking tail is the same link. */
export function linkKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export interface Link {
  recordId: string; providerRef: string | null; joinUrl: string | null; startsAt: number; endsAt: number | null; emails: string[]; eventIds: string[]; provider: Provider;
  recordingFileId: string | null; recordingDurationSec: number | null; folderId: string | null; mergedBy: string | null; createdAt: number;
}

export function linkOf(r: Row): Link {
  return {
    recordId: str(r, "recordId"), providerRef: strOrNull(r, "providerRef"), joinUrl: strOrNull(r, "joinUrl"), startsAt: num(r, "startsAt"), endsAt: numOrNull(r, "endsAt"),
    emails: parseJson<string[]>(r["emails"], []), eventIds: parseJson<string[]>(r["eventIds"], []), provider: (str(r, "provider") || "none") as Provider,
    recordingFileId: strOrNull(r, "recordingFileId"), recordingDurationSec: numOrNull(r, "recordingDurationSec"), folderId: strOrNull(r, "folderId"), mergedBy: strOrNull(r, "mergedBy"), createdAt: num(r, "createdAt"),
  };
}

export const links = (ctx: MeetCtx): Link[] => rowsOf(ctx.db.all(`SELECT * FROM meetings_link`)).map(linkOf);
export const linkFor = (ctx: MeetCtx, recordId: string): Link | null => {
  const r = first(ctx.db.all(`SELECT * FROM meetings_link WHERE "recordId" = ?`, recordId));
  return r ? linkOf(r) : null;
};

export function saveLink(ctx: MeetCtx, l: Link): void {
  const have = first(ctx.db.all(`SELECT * FROM meetings_link WHERE "recordId" = ?`, l.recordId));
  const vals = [l.providerRef, l.joinUrl, l.startsAt, l.endsAt, JSON.stringify(l.emails), JSON.stringify(l.eventIds), l.provider, l.recordingFileId, l.recordingDurationSec, l.folderId, l.mergedBy];
  if (have) {
    ctx.db.run(
      `UPDATE meetings_link SET "providerRef" = ?, "joinUrl" = ?, "startsAt" = ?, "endsAt" = ?, "emails" = ?, "eventIds" = ?, "provider" = ?, "recordingFileId" = ?, "recordingDurationSec" = ?, "folderId" = ?, "mergedBy" = ? WHERE "recordId" = ?`,
      ...vals, l.recordId,
    );
  } else {
    ctx.db.run(
      `INSERT INTO meetings_link ("recordId", "providerRef", "joinUrl", "startsAt", "endsAt", "emails", "eventIds", "provider", "recordingFileId", "recordingDurationSec", "folderId", "mergedBy", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      l.recordId, ...vals, l.createdAt,
    );
  }
}

export interface MeetingRecord { id: string; fields: Json }

/** The Meeting record, through records. A record that is not a meeting, or not there, is not found. */
export async function meetingRecord(ctx: MeetCtx, recordId: string): Promise<MeetingRecord> {
  if (!isId("rec", recordId)) bad(ctx, "Meeting id is not valid.");
  let rec: Json;
  try {
    rec = obj(obj(await ctx.call("records.get", { type: "meeting", recordId })).record);
  } catch (e) {
    if (codeOf(e) === "validation.not_found") return missing(ctx, "That meeting is not in this Space.");
    throw e;
  }
  if (rec["deletedAt"] !== undefined && rec["deletedAt"] !== null) return missing(ctx, "That meeting is not in this Space.");
  return { id: recordId, fields: obj(rec["fields"]) };
}

export async function patchMeeting(ctx: MeetCtx, recordId: string, patch: Json): Promise<Json> {
  const res = obj(obj(await ctx.call("records.update", { type: "meeting", recordId, patch })).record);
  return obj(res["fields"]);
}

export function meetingRow(ctx: Pick<MeetCtx, "trace">, id: string, f: Json, l: Link | null): Json {
  void ctx;
  const out: Json = {
    id, title: text(f["title"]), startsAt: msOf(f["starts_at"]) ?? (l?.startsAt ?? 0), provider: text(f["provider"]) || l?.provider || "none",
    status: text(f["status"]) || "scheduled", attendeeIds: list(f["attendees"]).filter((x): x is string => typeof x === "string"),
    recordingState: text(f["recording_state"]) || "none", hasTranscript: text(f["transcript"]) !== "", hasSummary: text(f["summary"]) !== "",
  };
  const endsAt = msOf(f["ends_at"]);
  if (endsAt !== undefined) out["endsAt"] = endsAt;
  if (text(f["join_url"])) out["joinUrl"] = text(f["join_url"]);
  if (text(f["organizer"])) out["organizer"] = text(f["organizer"]);
  const ev = l?.eventIds[0] ?? text(f["calendar_event_id"]);
  if (ev) out["calendarEventId"] = ev;
  return out;
}

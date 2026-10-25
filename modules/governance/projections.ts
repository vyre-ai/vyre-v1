// governance store helpers (spec 2.26; ARCH 4.11): the context subset the handlers use, the schema apply and the readers. Rows are read with `SELECT *` and sorted in code; every camelCase column is quoted.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface GovDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the governance handlers use; the host Ctx satisfies it. */
export interface GovCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  now(): number;
  db: GovDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
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

export function bad(ctx: Pick<GovCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}
export function refuse(ctx: Pick<GovCtx, "trace">, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}
export function missing(ctx: Pick<GovCtx, "trace">, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}

/** The idempotency key of a capability declared `idem: 'key'`; the invoke pipeline has checked it, a direct call without one is a bad input. */
export function keyOf(ctx: Pick<GovCtx, "trace">, input: unknown): string {
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
export function paging(ctx: Pick<GovCtx, "trace">, o: Json): { cursor: string | undefined; limit: number | undefined } {
  const cursor = o["cursor"];
  const limit = o["limit"];
  if (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor))) bad(ctx, "The cursor is not valid.");
  if (limit !== undefined && (!isInt(limit) || limit < 1 || limit > 500)) bad(ctx, "The limit is 1 to 500.");
  return { cursor: cursor as string | undefined, limit: limit as number | undefined };
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_governance.sql", import.meta.url)), "utf8");

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
export function ensure(ctx: Pick<GovCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "key" FROM gov_state WHERE "key" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function getState(ctx: Pick<GovCtx, "db">, key: string): string | null {
  const row = first(ctx.db.all(`SELECT * FROM gov_state WHERE "key" = ?`, key));
  return row && typeof row.value === "string" ? row.value : null;
}
export function setState(ctx: Pick<GovCtx, "db">, key: string, value: string): void {
  if (getState(ctx, key) === null) ctx.db.run(`INSERT OR IGNORE INTO gov_state ("key", "value") VALUES (?, ?)`, key, value);
  else ctx.db.run(`UPDATE gov_state SET "value" = ? WHERE "key" = ?`, value, key);
}

// ---- retention definitions (a copy of manifests/governance.ts; the retention test compares the two)

export const KINDS = ["trash", "run_logs", "transcripts", "audit", "file_versions", "logs", "events", "backups", "memory", "records"] as const;
export type Kind = (typeof KINDS)[number];
export const ERASE_KINDS = ["records", "files", "chats", "inbox", "mail", "calls", "memory", "runs"] as const;
export type EraseKind = (typeof ERASE_KINDS)[number];
export const HOLD_KINDS = ["file", "channel", "thread", "folder", "person"] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export interface Def { key: Kind; title: string; default: string; holdable: boolean; tombstone: boolean }
export const DEFS: readonly Def[] = [
  { key: "trash", title: "Trash (records, files)", default: "30d", holdable: true, tombstone: false },
  { key: "run_logs", title: "Run logs and run chats", default: "90d", holdable: true, tombstone: false },
  { key: "transcripts", title: "Chat transcripts", default: "1y", holdable: true, tombstone: true },
  { key: "audit", title: "Audit entries (then archived, never edited)", default: "2y", holdable: true, tombstone: false },
  { key: "file_versions", title: "File versions (all for 30 days, then daily for 90 days, then monthly unless named)", default: "30d+daily90d+monthly", holdable: true, tombstone: false },
  { key: "logs", title: "Logs (full 30 days, aggregates 180 days)", default: "30d", holdable: false, tombstone: false },
  { key: "events", title: "Events (state-bearing forever; other payloads compacted after 30 days)", default: "forever", holdable: true, tombstone: true },
  { key: "backups", title: "Backups (rotation per policy; an erase purges the next rotation)", default: "per_policy", holdable: false, tombstone: false },
  { key: "memory", title: "Memory notes and facts", default: "forever", holdable: true, tombstone: true },
  { key: "records", title: "Records (per record type)", default: "forever", holdable: true, tombstone: true },
];

const DAY = 86_400_000;
const UNIT: Record<string, number> = { d: DAY, w: 7 * DAY, m: 30 * DAY, y: 365 * DAY };
/** The age a retention value means in milliseconds, or null when it is not an age (forever, per_policy, the compound file-version rule). */
export function ageOf(value: string): number | null {
  const m = /^([0-9]+)([dwmy])$/.exec(value);
  return m ? Number(m[1]) * (UNIT[m[2] as string] as number) : null;
}

// ---- holds

export function holdRow(ctx: Pick<GovCtx, "db">, kind: string, targetId: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM gov_hold WHERE "kind" = ? AND "targetId" = ?`, kind, targetId));
}

// ---- small shared pieces

/** A run, started and finished through runs (kind other; the run kind named in the manifest is its name). */
export async function startRun(ctx: GovCtx, name: string, key: string): Promise<string> {
  const started = obj(await ctx.call("runs.start", { kind: "other", name, owner: ctx.principal.id, subject: { type: "space", id: ctx.space }, idempotencyKey: key }));
  const runId = text(started["runId"]);
  if (!isId("run", runId)) throw new Error("runs.start answered no id");
  return runId;
}
export async function finishRun(ctx: GovCtx, runId: string, ok: { summary: string } | { code: string; message: string }): Promise<void> {
  await ctx.call("runs.finish", "summary" in ok ? { runId, status: "succeeded", summary: ok.summary } : { runId, status: "failed", error: { code: ok.code, message: ok.message } });
}

// @reads /modules/import/migrations/0001_import.sql
// Import: sessions, plans and the ports to the modules an import works through (spec 2.9 Lifecycle, 2.10; ARCH 7.4).
// Flow: a parse stages the source as a session (importId) that expires after 24 hours; suggest_mapping proposes a mapping; preview checks the rows against a record type and keeps the plan it
// checked under a token; commit writes the rows as an import Run through records.bulk_upsert. Nothing a parse or a preview does changes a record or a record type.
// DECISION: a staged session is the only thing a parse or a preview writes. It holds the rows until the import is done or discarded, then the rows are dropped and the counts stay.
// DECISION: the preview token is a plain 128-bit hash of the staged data and the plan (this module may not use crypto primitives, boundary B3); it only has to change when either changes.
// DECISION: the import Run is started with kind `other` because the frozen Run kinds have no `import`; its name is "Import <type>".
// DECISION: a row that fails to convert is not written and is counted as failed; the first 1,000 are kept with the import for the errors list.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintId as mint } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface Principal { kind: "person" | "agent" | "actor" | "service"; id: string }

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface ImportCtx {
  space: string;
  principal: Principal;
  actingFor?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call?(cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<unknown>;
  /**
   * The shell owns the user's space directory and cross-space invoke path.  An
   * import never guesses that its ambient Space is Personal: it asks this port
   * for an authorized concrete destination, then re-enters there before any
   * archive, Project, binding, or continuation write.
   */
  sessionDestination?: {
    resolve(owner: string, request: { kind: "personal" } | { kind: "team"; spaceId: string }): Promise<{ kind: "personal" | "team"; spaceId: string }>;
    invoke(spaceId: string, cap: "sessions.import" | "sessions.continue", input: unknown): Promise<unknown>;
  };
  http?(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string> }>;
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type In = Record<string, any>;

export function raise(ctx: Pick<ImportCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}
export const newId = (prefix: string, now: number): string => mint(prefix, now).replaceAll("-", "");
const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
const num = (v: unknown): number => Number(v);
const parseJson = <T>(raw: unknown, fallback: T): T => { try { return raw === null || raw === undefined ? fallback : (JSON.parse(str(raw)) as T); } catch { return fallback; } };
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
export const me = (ctx: Pick<ImportCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;
export const HOUR = 3_600_000;
export const SESSION_TTL = 24 * HOUR;
export const MAX_ROWS = 100_000;

// ---- schema ----

const SCHEMA = readFileSync(new URL("./migrations/0001_import.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

/** Make sure the import tables exist. One cheap probe per handle; the IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT key FROM import_key WHERE key = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

// ---- ports ----

export async function call<T>(ctx: ImportCtx, cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
  if (!ctx.call) raise(ctx, "internal.unexpected", "That part of the app is not available right now.", { cap });
  return (await ctx.call(cap, input, opts)) as T;
}
export async function tolerant<T>(ctx: ImportCtx, cap: string, input: unknown, fallback: T): Promise<T> {
  if (!ctx.call) return fallback;
  try { return ((await ctx.call(cap, input)) as T | null | undefined) ?? fallback; } catch (e) {
    ctx.log.warn("import: a neighbour did not answer", { cap, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    return fallback;
  }
}
export const codeOf = (e: unknown): string => { const x = e as { error?: { code?: string }; code?: string }; return x?.error?.code ?? x?.code ?? "unknown"; };

/** What the host gives this module beyond ctx: the value behind a Vault handle, for one call. Unset in a bare setup, and then the providers answer provider.unavailable. */
export interface ImportHost { secret(ctx: ImportCtx, handle: string): Promise<string> }
let host: ImportHost | undefined;
export function setHost(h: ImportHost | undefined): void { host = h; }
export function needHost(ctx: Pick<ImportCtx, "trace">): ImportHost {
  if (!host) raise(ctx, "provider.unavailable", "Importing from an app is not set up on this server.");
  return host;
}

// ---- hashing (not security: a token that changes when the data or the plan does) ----

function fnv(s: string, seed: bigint): bigint {
  let h = seed;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h;
}
export function hashOf(s: string): string {
  return fnv(s, 0xcbf29ce484222325n).toString(16).padStart(16, "0") + fnv(s, 0x84222325cbf29ce4n).toString(16).padStart(16, "0");
}
/** JSON with sorted keys, so the same plan always gives the same text. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

// ---- staged data ----

export interface Column { name: string; inferred: string; sample: string[]; distinct: number; empty: number }
export interface Table { name: string; columns: Column[]; rows: string[][] }
export interface Mapping { column: string; field: string; transform?: string | undefined }
export interface NewField { key: string; type: string; title: string }
export interface RowError { row: number; column?: string | undefined; message: string }
export interface Plan {
  table: string; type: string; mapping: Mapping[]; match: string[]; onMatch: "update" | "skip" | "create"; createFields: boolean; runAutomations: boolean;
  newFields: NewField[];
  /** One letter per data row: c create, u update, s skip, e error. */
  actions: string;
}
export type State = "staged" | "running" | "done" | "failed" | "canceled";
export interface Session {
  importId: string; source: string; tables: Table[]; dataHash: string; state: State; createdBy: string; createdAt: number; expiresAt: number; type?: string | undefined;
  previewToken?: string | undefined; plan?: Plan | undefined; runId?: string | undefined; created: number; updated: number; skipped: number; failed: number; ranAutomations: boolean;
  errors: RowError[]; errorsFileId?: string | undefined;
}
const toSession = (r: Row): Session => ({
  importId: str(r["importId"]), source: str(r["source"]), tables: parseJson<Table[]>(r["tables"], []), dataHash: str(r["dataHash"]), state: str(r["state"]) as State, createdBy: str(r["createdBy"]),
  createdAt: num(r["createdAt"]), expiresAt: num(r["expiresAt"]), type: optStr(r["type"]), previewToken: optStr(r["previewToken"]), plan: parseJson<Plan | undefined>(r["plan"], undefined),
  runId: optStr(r["runId"]), created: num(r["created"]), updated: num(r["updated"]), skipped: num(r["skipped"]), failed: num(r["failed"]), ranAutomations: num(r["ranAutomations"]) === 1,
  errors: parseJson<RowError[]>(r["errors"], []), errorsFileId: optStr(r["errorsFileId"]),
});
export function createSession(ctx: ImportCtx, source: string, tables: Table[]): Session {
  const now = ctx.now();
  const total = tables.reduce((n, t) => n + t.rows.length, 0);
  if (total > MAX_ROWS) raise(ctx, "validation.bad_input", `An import takes up to ${MAX_ROWS.toLocaleString("en-US")} rows at a time; this has ${total.toLocaleString("en-US")}.`, { rows: total });
  const s: Session = { importId: newId("imp", now), source, tables, dataHash: hashOf(stable(tables)), state: "staged", createdBy: me(ctx), createdAt: now, expiresAt: now + SESSION_TTL, created: 0, updated: 0, skipped: 0, failed: 0, ranAutomations: false, errors: [] };
  ctx.db.run(
    "INSERT INTO import_session (importId, source, tables, dataHash, state, createdBy, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    s.importId, s.source, JSON.stringify(s.tables), s.dataHash, s.state, s.createdBy, s.createdAt, s.expiresAt,
  );
  return s;
}
export function saveSession(db: Db, s: Session): void {
  db.run(
    `UPDATE import_session SET tables = ?, state = ?, type = ?, previewToken = ?, plan = ?, runId = ?, created = ?, updated = ?, skipped = ?, failed = ?, ranAutomations = ?, errors = ?, errorsFileId = ?
     WHERE importId = ?`,
    JSON.stringify(s.tables), s.state, s.type ?? null, s.previewToken ?? null, s.plan ? JSON.stringify(s.plan) : null, s.runId ?? null, s.created, s.updated, s.skipped, s.failed, s.ranAutomations ? 1 : 0,
    JSON.stringify(s.errors), s.errorsFileId ?? null, s.importId,
  );
}
export function findSession(db: Db, importId: string): Session | undefined {
  const r = (db.all("SELECT * FROM import_session WHERE importId = ?", importId) as Row[])[0];
  return r ? toSession(r) : undefined;
}
export function listSessions(db: Db, type?: string): Session[] {
  const rows = (type === undefined
    ? db.all("SELECT * FROM import_session ORDER BY createdAt DESC, importId DESC")
    : db.all("SELECT * FROM import_session WHERE type = ? ORDER BY createdAt DESC, importId DESC", type)) as Row[];
  return rows.map(toSession);
}
export function dropSession(db: Db, importId: string): boolean { return db.run("DELETE FROM import_session WHERE importId = ?", importId).changes > 0; }

/** A staged import that is still good: it exists, has not expired and has not been written. */
export function staged(ctx: ImportCtx, importId: string, code: ErrorCode): Session {
  ensure(ctx.db);
  const s = findSession(ctx.db, importId);
  if (!s) raise(ctx, code, "That import does not exist or has expired.", { importId });
  if (s.state === "staged" && s.expiresAt <= ctx.now()) {
    dropSession(ctx.db, importId);
    raise(ctx, code, "That import expired. Parse the file again.", { importId, reason: "expired" });
  }
  return s;
}
export function tableOf(ctx: ImportCtx, s: Session, name: string | undefined): Table {
  if (name === undefined) {
    if (s.tables.length === 1) return s.tables[0] as Table;
    raise(ctx, "validation.bad_input", `This import has ${s.tables.length} tables. Say which one.`, { tables: s.tables.map((t) => t.name) });
  }
  const t = s.tables.find((x) => x.name === name);
  if (!t) raise(ctx, "validation.bad_input", `This import has no table called ${name}.`, { table: name });
  return t;
}

// ---- keyed calls ----

export function keyed<T>(db: Db, key: string | undefined, cap: string): T | undefined {
  if (key === undefined) return undefined;
  const r = (db.all("SELECT result FROM import_key WHERE key = ? AND cap = ?", key, cap) as Row[])[0];
  return r ? parseJson<T | undefined>(r["result"], undefined) : undefined;
}
export function remember(db: Db, key: string | undefined, cap: string, result: unknown): void {
  if (key === undefined) return;
  db.run("INSERT OR REPLACE INTO import_key (key, cap, result) VALUES (?, ?, ?)", key, cap, JSON.stringify(result));
}

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

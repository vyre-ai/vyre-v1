// vault store helpers (spec 2.17, 3.8; ARCH 7.8): the context subset the handlers use, the schema apply, row readers and the shapes of item metadata, folders and history. No value passes through here:
// rows hold names, kinds and field keys; sealed values live in vault_secret and are opened only in handlers/crypto.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface VaultDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export type Level = "use" | "view" | "edit" | "manage";
export const LADDER: readonly Level[] = ["use", "view", "edit", "manage"];

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the vault handlers use; the host Ctx satisfies it. */
export interface VaultCtx {
  depth?: number;
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: VaultDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: Level }, resource: { type: string; id: string | null; parent?: string }): { effect: "allow" | "deny" | "hold"; reason: string; decisionId: string };
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Val = string | number | null;
export type Row = Record<string, Val>;
export type Json = Record<string, unknown>;

export const first = (rows: unknown[]): Row | null => {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
};
export const rowsOf = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof r === "object");
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
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

export const bad = (ctx: Pick<VaultCtx, "trace">, message: string): never => { throw fail("validation.bad_input", ctx.trace.traceId, { message }); };
export const refuse = (ctx: Pick<VaultCtx, "trace">, message: string): never => { throw fail("validation.precondition_failed", ctx.trace.traceId, { message }); };
export const missing = (ctx: Pick<VaultCtx, "trace">, message: string): never => { throw fail("validation.not_found", ctx.trace.traceId, { message }); };
export const denied = (ctx: Pick<VaultCtx, "trace">, message: string): never => { throw fail("permission.no_grant", ctx.trace.traceId, { message }); };

export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export const isId = (prefix: string, v: unknown): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-z0-9]+$`).test(v);
export function keyOf(ctx: Pick<VaultCtx, "trace">, input: unknown): string {
  const k = obj(input).idempotencyKey;
  return typeof k === "string" && k !== "" ? k : bad(ctx, "An idempotency key is required.");
}

export function pageOf<T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { page: T[]; next?: string; total: number } {
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit ?? 100;
  return { page: items.slice(start, start + size), ...(start + size < items.length ? { next: String(start + size) } : {}), total: items.length };
}
export function paging(ctx: Pick<VaultCtx, "trace">, o: Json): { cursor: string | undefined; limit: number | undefined } {
  const cursor = o["cursor"];
  const limit = o["limit"];
  if (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor))) bad(ctx, "The cursor is not valid.");
  if (limit !== undefined && (!isInt(limit) || limit < 1 || limit > 500)) bad(ctx, "The limit is 1 to 500.");
  return { cursor: cursor as string | undefined, limit: limit as number | undefined };
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_vault.sql", import.meta.url)), "utf8");

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

export function ensure(ctx: Pick<VaultCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "id" FROM vault_history WHERE "id" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- levels

/** The highest level the caller holds on a resource, or null. The vault ladder is use < view < edit < manage. */
export function levelOn(ctx: VaultCtx, type: "vault_item" | "vault_folder", id: string): Level | null {
  let best: Level | null = null;
  for (const level of LADDER) if (ctx.authorize({ perm: null, level }, { type, id }).effect === "allow") best = level;
  return best;
}
export const atLeast = (have: Level | null, need: Level): boolean => have !== null && LADDER.indexOf(have) >= LADDER.indexOf(need);

// ---- shapes

export function handleOf(name: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `#${base || "item"}`;
}

export function metaOut(ctx: VaultCtx, r: Row): Json {
  const x = first(ctx.db.all(`SELECT * FROM vault_item_x WHERE "itemId" = ?`, str(r, "id")));
  const level = str(r, "owner") === ctx.principal.id ? "manage" : (levelOn(ctx, "vault_item", str(r, "id")) ?? "use");
  const out: Json = {
    id: str(r, "id"), name: str(r, "name"), kind: str(r, "kind"), folderId: str(r, "folderId"), owner: str(r, "owner"), scope: str(r, "scope"),
    fieldKeys: parseJson<string[]>(r["fieldKeys"], []), handle: str(r, "handle"), spaceOnly: num(r, "spaceOnly") === 1, injectIntoDeployments: num(r, "injectIntoDeployments") === 1,
    yourLevel: level, label: 0, createdAt: num(x, "createdAt"), updatedAt: num(r, "updatedAt"),
  };
  if (numOrNull(r, "rotateEveryDays") !== null) out["rotateEveryDays"] = num(r, "rotateEveryDays");
  if (numOrNull(x, "lastRotatedAt") !== null) out["lastRotatedAt"] = num(x, "lastRotatedAt");
  if (numOrNull(r, "lastUsedAt") !== null) out["lastUsedAt"] = num(r, "lastUsedAt");
  return out;
}

export function liveItem(ctx: VaultCtx, id: string): Row {
  const row = first(ctx.db.all(`SELECT * FROM vault_meta WHERE id = ?`, id));
  if (!row || (row["deleted_at"] !== null && row["deleted_at"] !== undefined)) return missing(ctx, "That item is not in this Vault.");
  return row;
}

export function anyItem(ctx: VaultCtx, id: string): Row {
  return first(ctx.db.all(`SELECT * FROM vault_meta WHERE id = ?`, id)) ?? missing(ctx, "That item is not in this Vault.");
}

export function liveFolder(ctx: VaultCtx, id: string): Row {
  const row = first(ctx.db.all(`SELECT * FROM vault_folder WHERE id = ?`, id));
  if (!row || (row["deleted_at"] !== null && row["deleted_at"] !== undefined)) return missing(ctx, "That folder is not in this Vault.");
  return row;
}

export function patchMeta(ctx: VaultCtx, id: string, fields: Record<string, Val>): void {
  const row = first(ctx.db.all(`SELECT * FROM vault_meta WHERE id = ?`, id));
  const keys = Object.keys(fields);
  ctx.db.run(
    `UPDATE vault_meta SET ${[...keys, "version", "updated_at", "updatedAt"].map((k) => `"${k}" = ?`).join(", ")} WHERE id = ?`,
    ...keys.map((k) => fields[k] ?? null), num(row, "version") + 1, ctx.now(), ctx.now(), id,
  );
}

export type HistoryAction = "created" | "used" | "revealed" | "edited" | "moved" | "rotated" | "shared" | "unshared" | "exported" | "deleted" | "restored";

/** One row of the item's history: who, what, which field names. Never a value. */
export function record(ctx: VaultCtx, itemId: string, action: HistoryAction, o: { field?: string; detail?: string } = {}): void {
  ctx.db.run(
    `INSERT INTO vault_history ("id", "itemId", "at", "actor", "onBehalfOf", "action", "field", "via", "detail") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("vhs", ctx.now()), itemId, ctx.now(), JSON.stringify({ kind: ctx.principal.kind, id: ctx.principal.id }),
    ctx.actingFor ? JSON.stringify({ kind: "person", id: ctx.actingFor }) : null, action, o.field ?? null, null, o.detail ?? null,
  );
}

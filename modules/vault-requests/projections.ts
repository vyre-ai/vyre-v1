// Vault requests (lane L7a): the row, the context the handlers use, and the small helpers they share. The module owns one table (migrations/0001_vault_requests.sql). It holds requests,
// who may decide them and the ids of their cards. It never holds a key: a value typed by a manager goes in the fulfil call, straight to vault.item.put, and nowhere else.
import { fail } from "../../host/src/routes/errors.ts";

export type PKind = "person" | "agent" | "actor" | "service";
export interface Ref { kind: PKind; id: string }
export type State = "waiting" | "fulfilled" | "declined" | "canceled";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx these handlers use. */
export interface VaultReqCtx {
  space: string;
  principal: { kind: string; id: string };
  /** The person an agent acts for. */
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

export interface RequestRow {
  id: string; name: string; fields_json: string; reason: string; requester_kind: PKind; requester_id: string; for_run: string | null; folder_id: string | null; state: State;
  item_id: string | null; note: string | null; idem_key: string; managers_json: string; task_ids_json: string; at: number; decided_by: string | null; decided_at: number | null;
}

type Code = Parameters<typeof fail>[0];
export function raise(traceId: string, code: Code, message?: string): never {
  throw fail(code, traceId, message ? { message } : {});
}

export function nid(prefix: string): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return `${prefix}_${s}`;
}

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const out: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) out.next = String(start + rows.length);
  return out;
}

export const TABLE = "vault_requests_requests";
export const asRow = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const strOf = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
export const idsOf = (json: string): string[] => JSON.parse(json) as string[];

/** The request as the contract returns it: names, never values. */
export function requestOut(r: RequestRow) {
  const tasks = idsOf(r.task_ids_json);
  return {
    id: r.id, name: r.name, fields: idsOf(r.fields_json), reason: r.reason, requester: { kind: r.requester_kind, id: r.requester_id },
    ...(r.for_run ? { forRun: r.for_run } : {}), ...(r.folder_id ? { folderId: r.folder_id } : {}), state: r.state,
    ...(r.item_id ? { itemId: r.item_id } : {}), ...(r.note ? { note: r.note } : {}), taskId: tasks[0] ?? "", at: r.at, ...(r.decided_at !== null ? { decidedAt: r.decided_at } : {}),
  };
}

export const requestById = (ctx: { db: Db }, id: string): RequestRow | undefined => ctx.db.all(`SELECT * FROM ${TABLE} WHERE id = ?`, id)[0] as RequestRow | undefined;

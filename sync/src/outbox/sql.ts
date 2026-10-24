// The outbox over the replica's `pending_ops` and `rejected` tables (ARCH 5.10). Any SQL handle with these three calls will do: node:sqlite, expo-sqlite and wa-sqlite all reach it through the replica driver.
// `base_seq` holds {"baseSeq": {...}, "after": {...}} (a bare map from an older writer is read as baseSeq); `input` holds the op input as JSON text.
import type { Op } from "../protocol.ts";
import type { OutboxRow, OutboxState, OutboxStore, RejectedRow } from "./types.ts";

export interface OutboxSql {
  run(sql: string, params: readonly (string | number | null)[]): void;
  all(sql: string, params: readonly (string | number | null)[]): Record<string, unknown>[];
}

const text = (v: unknown): string => (typeof v === "string" ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : v === null || v === undefined ? "" : String(v));
const int = (v: unknown): number => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : 0);

function parseBase(raw: string): { baseSeq: Record<string, number>; after?: Record<string, string>; enc?: { key: string; nonce: string } } {
  if (!raw) return { baseSeq: {} };
  const v = JSON.parse(raw) as Record<string, unknown>;
  if ("baseSeq" in v && typeof v["baseSeq"] === "object") {
    return { baseSeq: v["baseSeq"] as Record<string, number>, ...(v["after"] ? { after: v["after"] as Record<string, string> } : {}), ...(v["enc"] ? { enc: v["enc"] as { key: string; nonce: string } } : {}) };
  }
  return { baseSeq: v as Record<string, number> };
}

function toRow(r: Record<string, unknown>): OutboxRow {
  const base = parseBase(text(r["base_seq"]));
  const entity = r["entity"], id = r["id"];
  const op: Op = {
    opId: text(r["op_id"]), traceId: text(r["trace_id"]), hlc: text(r["hlc"]), cap: text(r["cap"]), v: int(r["v"]),
    ...(typeof entity === "string" ? { entity } : {}), ...(typeof id === "string" ? { id } : {}),
    input: JSON.parse(text(r["input"]) || "null"), baseSeq: base.baseSeq, ...(base.after ? { after: base.after } : {}),
    ...(base.enc ? { enc: base.enc } : {}),
  };
  return { n: int(r["n"]), op, state: (text(r["state"]) as OutboxState) || "queued", tries: int(r["tries"]), lastError: r["last_error"] === null || r["last_error"] === undefined ? null : text(r["last_error"]), at: int(r["at"]) };
}

const COLS = "n, op_id, trace_id, hlc, cap, v, entity, id, input, base_seq, state, tries, last_error, at";

export function sqlOutboxStore(db: OutboxSql): OutboxStore {
  return {
    insert(op, at) {
      const had = db.all("SELECT n FROM pending_ops WHERE op_id = ?", [op.opId])[0];
      if (had) return int(had["n"]);
      db.run(
        "INSERT INTO pending_ops (op_id, trace_id, hlc, cap, v, entity, id, input, base_seq, state, tries, last_error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, ?)",
        [op.opId, op.traceId, op.hlc, op.cap, op.v, op.entity ?? null, op.id ?? null, JSON.stringify(op.input ?? null), JSON.stringify({ baseSeq: op.baseSeq, ...(op.after ? { after: op.after } : {}), ...(op.enc ? { enc: op.enc } : {}) }), at]);
      return int(db.all("SELECT n FROM pending_ops WHERE op_id = ?", [op.opId])[0]?.["n"]);
    },
    queued: () => db.all(`SELECT ${COLS} FROM pending_ops WHERE state = 'queued' ORDER BY n`, []).map(toRow),
    forRow: (entity, id) => db.all(`SELECT ${COLS} FROM pending_ops WHERE entity = ? AND id = ? ORDER BY n`, [entity, id]).map(toRow),
    remove(opId) { db.run("DELETE FROM pending_ops WHERE op_id = ?", [opId]); },
    setHeld(opId, taskId) { db.run("UPDATE pending_ops SET state = 'held', last_error = ? WHERE op_id = ?", [taskId, opId]); },
    bump(opId, error) { db.run("UPDATE pending_ops SET tries = tries + 1, last_error = ? WHERE op_id = ?", [error, opId]); },
    reject(r) {
      db.run("INSERT INTO rejected (op_id, error, copy_out, at) VALUES (?, ?, ?, ?) ON CONFLICT(op_id) DO UPDATE SET error = excluded.error, copy_out = excluded.copy_out, at = excluded.at",
        [r.opId, JSON.stringify(r.error), JSON.stringify(r.copyOut ?? null), r.at]);
    },
    rejected: () => db.all("SELECT op_id, error, copy_out, at FROM rejected ORDER BY at, op_id", []).map((r): RejectedRow => ({
      opId: text(r["op_id"]), error: JSON.parse(text(r["error"]) || "null"), copyOut: JSON.parse(text(r["copy_out"]) || "null"), at: int(r["at"]),
    })),
    count: () => int(db.all("SELECT count(*) AS n FROM pending_ops", [])[0]?.["n"]),
  };
}

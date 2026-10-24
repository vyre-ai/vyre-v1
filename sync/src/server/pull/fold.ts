// The `sync.changes` fold (ARCH 5.1): one event becomes one row of `sync_changes` (the change feed pull scans) and an update of `sync_rows` (the server's current copy of the row, with a clock per field).
// `sync_rows` is what snapshot pages and full upserts are cut from, so pull and snapshot never replay events and never read another module's tables.
// DECISION: module tables are not readable from the sync lane (boundary B1), so the sync lane keeps its own row index. It folds the kernel record events (record.created, updated, removed, restored)
// and two events any module may emit for its own entities: `sync.row` { entity, id, op, fields, owner? } and `sync.row_rescan` { entity, id } (ask pull to re-evaluate who can see a row after a grant or label change).
// An encrypted event (enc 1 or 2) cannot be read by the server: it travels as one opaque field `$sealed` that carries the ciphertext and the key and nonce, and only the owner device receives an enc 2 row.
import { payloadOf } from "../../../../kernel/src/store/projection.ts";
import type { Tx } from "../../../../kernel/src/store/projection.ts";
import type { StoredEvent } from "../../../../kernel/src/log/types.ts";

export const SEALED_FIELD = "$sealed";

export interface Cell { v: unknown; hlc: string; actor: string; seq: number; enc?: { key: string; nonce: string } }
export type Cells = Record<string, Cell>;
export type RowOp = "upsert" | "patch" | "delete" | "rescan";

/** What one event says about one row. */
export interface RowChange {
  entity: string;
  id: string;
  op: RowOp;
  /** Field values the event set (upsert: all of them, patch: the changed ones). */
  fields: Record<string, unknown>;
  owner?: string | null;
  /** A restore brings a deleted row back with the values it kept. */
  restore?: boolean;
  at: number;
}

export type OwnerFieldOf = (entity: string) => string | null;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const at = (p: Record<string, unknown>, e: StoredEvent): number => (typeof p["at"] === "number" ? p["at"] : e.at);

function sealed(e: StoredEvent): RowChange | null {
  if (!e.entity || !e.entity_id) return null;
  return { entity: e.entity, id: e.entity_id, op: "upsert", fields: { [SEALED_FIELD]: Buffer.from(e.payload).toString("base64") }, at: e.at };
}

/** Read one event as a row change; null when the sync lane has nothing to say about it. */
export function mapEvent(e: StoredEvent): RowChange | null {
  if (e.enc > 0) return e.type.startsWith("record.") || e.type === "sync.row" ? sealed(e) : null;
  switch (e.type) {
    case "record.created": {
      const p = payloadOf<Record<string, unknown>>(e);
      const type = str(p["type"]), id = str(p["id"]);
      if (!type || !id || !isObj(p["data"])) return null;
      return { entity: type, id, op: "upsert", fields: p["data"], at: at(p, e) };
    }
    case "record.updated": {
      const p = payloadOf<Record<string, unknown>>(e);
      const type = str(p["type"]), id = str(p["id"]);
      if (!type || !id || !isObj(p["data"])) return null;
      const before = isObj(p["before"]) ? p["before"] : {};
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p["data"])) if (!same(v, before[k])) fields[k] = v;
      for (const k of Object.keys(before)) if (!(k in p["data"])) fields[k] = null;
      return { entity: type, id, op: "patch", fields, at: at(p, e) };
    }
    case "record.removed": {
      const p = payloadOf<Record<string, unknown>>(e);
      const type = str(p["type"]), id = str(p["id"]);
      return type && id ? { entity: type, id, op: "delete", fields: {}, at: at(p, e) } : null;
    }
    case "record.restored": {
      const p = payloadOf<Record<string, unknown>>(e);
      const type = str(p["type"]), id = str(p["id"]);
      return type && id ? { entity: type, id, op: "upsert", fields: {}, restore: true, at: at(p, e) } : null;
    }
    case "sync.row": {
      const p = payloadOf<Record<string, unknown>>(e);
      const entity = str(p["entity"]), id = str(p["id"]), op = p["op"];
      if (!entity || !id || (op !== "upsert" && op !== "patch" && op !== "delete")) return null;
      const owner = p["owner"] === null ? null : str(p["owner"]);
      return { entity, id, op, fields: isObj(p["fields"]) ? p["fields"] : {}, ...(owner !== null || p["owner"] === null ? { owner } : {}), at: at(p, e) };
    }
    case "sync.row_rescan": {
      const p = payloadOf<Record<string, unknown>>(e);
      const entity = str(p["entity"]), id = str(p["id"]);
      return entity && id ? { entity, id, op: "rescan", fields: {}, at: e.at } : null;
    }
    default: return null;
  }
}

interface RowRec { owner_id: string | null; label: number; deleted: number; enc: number; fields: string }

const INSERT_CHANGE = "INSERT INTO sync_changes (seq, entity, id, op, fields, hlc, actor, vis, label, enc, trace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
const UPSERT_ROW = `INSERT INTO sync_rows (entity, id, owner_id, label, holds, deleted, enc, vis, seq, updated_at, fields) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(entity, id) DO UPDATE SET owner_id = excluded.owner_id, label = excluded.label, deleted = excluded.deleted, enc = excluded.enc, vis = excluded.vis, seq = excluded.seq, updated_at = excluded.updated_at, fields = excluded.fields`;

const wire = (c: Cell): Omit<Cell, "seq"> => ({ v: c.v, hlc: c.hlc, actor: c.actor, ...(c.enc ? { enc: c.enc } : {}) });

/** Apply one event to `sync_rows` and append its change. Runs inside the append transaction (inline projection), so it is pure SQL. */
export function foldEvent(tx: Tx, e: StoredEvent, ownerFieldOf: OwnerFieldOf): void {
  const m = mapEvent(e);
  if (!m) return;
  const row = tx.get<RowRec>("SELECT owner_id, label, deleted, enc, fields FROM sync_rows WHERE entity = ? AND id = ?", m.entity, m.id);
  const change = (op: RowOp, fields: Record<string, Omit<Cell, "seq">>): void => {
    tx.run(INSERT_CHANGE, e.seq, m.entity, m.id, op, JSON.stringify(fields), e.hlc, e.actor, e.vis, e.label, e.enc, e.trace_id);
  };
  if (m.op === "rescan") { if (row) change("rescan", {}); return; }
  if (m.op === "delete") {
    if (!row) return;
    tx.run("UPDATE sync_rows SET deleted = 1, seq = ?, updated_at = ? WHERE entity = ? AND id = ?", e.seq, m.at, m.entity, m.id);
    change("delete", {});
    return;
  }
  const enc = e.enc > 0 ? { key: e.key_id ?? "", nonce: e.nonce ?? "" } : undefined;
  const cells: Cells = row && !(e.enc > 0 && m.op === "upsert") ? (JSON.parse(row.fields) as Cells) : {};
  const changed: Record<string, Omit<Cell, "seq">> = {};
  for (const [k, v] of Object.entries(m.fields)) {
    const cell: Cell = { v, hlc: e.hlc, actor: e.actor, seq: e.seq, ...(enc ? { enc } : {}) };
    cells[k] = cell;
    changed[k] = wire(cell);
  }
  if (m.restore) for (const [k, c] of Object.entries(cells)) changed[k] = wire(c);
  const ownerField = ownerFieldOf(m.entity);
  let owner: string | null = row?.owner_id ?? null;
  if (m.owner !== undefined) owner = m.owner;
  else if (ownerField && ownerField in m.fields) owner = typeof m.fields[ownerField] === "string" ? (m.fields[ownerField] as string) : null;
  else if (!row && e.enc === 2) owner = e.actor;
  tx.run(UPSERT_ROW, m.entity, m.id, owner, e.label, 0, e.enc, e.vis, e.seq, m.at, JSON.stringify(cells));
  change(m.restore ? "upsert" : m.op, changed);
}

// records.field_meta (ARCH 4.3). One rt_<type>__fm clock table per record type, plus the module history and row meta tables.
// Inline, same transaction as the append. The kernel records.rows projection keeps the row; this one keeps the field clock.
import { canonical } from "../../lib/canonical.ts";
import { payloadOf } from "../../kernel/src/store/projection.ts";
import type { InlineProjection, Tx } from "../../kernel/src/store/projection.ts";

export const TYPE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

export function fieldMetaTable(type: string): string {
  if (!TYPE_NAME.test(type)) throw new Error(`bad record type ${type}`);
  return `rt_${type}__fm`;
}

/** History text. A sealed field is masked: the plaintext and the handle stay out of history. */
export function historyText(kind: string | undefined, field: string, value: unknown): string {
  if (kind === "sealed") return JSON.stringify({ sealed: field, masked: true });
  try { return JSON.stringify(value ?? null); } catch { return "null"; }
}

const HISTORY = `CREATE TABLE IF NOT EXISTS records_field_history (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT,
  hlc TEXT NOT NULL,
  actor TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT NOT NULL
)`;
const HISTORY_IX = "CREATE INDEX IF NOT EXISTS records_field_history_row ON records_field_history (type, id, field)";
const META = `CREATE TABLE IF NOT EXISTS records_row_meta (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT,
  label INTEGER NOT NULL DEFAULT 0,
  holds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type, id)
)`;

/** Clock tables already created on a connection: the DDL is parsed once, not on every append. Dropped names are forgotten. */
const made = new WeakMap<object, Set<string>>();
const forget = (tx: Tx, type?: string): void => { const s = made.get(tx); if (!s) return; if (type === undefined) s.clear(); else s.delete(type); };

function ensureFm(tx: Tx, type: string): void {
  let have = made.get(tx);
  if (!have) { have = new Set(); made.set(tx, have); }
  if (have.has(type)) return;
  have.add(type);
  tx.exec(`CREATE TABLE IF NOT EXISTS "${fieldMetaTable(type)}" (
    id TEXT NOT NULL,
    field TEXT NOT NULL,
    hlc TEXT NOT NULL,
    actor TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (id, field)
  )`);
}

function dropFm(tx: Tx): void {
  forget(tx);
  const rows = tx.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rt\\_%\\_\\_fm' ESCAPE '\\'");
  for (const row of rows) {
    if (!/^rt_[a-z0-9_]+__fm$/.test(row.name)) continue;
    tx.exec(`DROP TABLE IF EXISTS "${row.name}"`);
  }
}

interface LooseField { name?: string; kind?: string }
function kinds(tx: Tx, type: string): Map<string, string> {
  const out = new Map<string, string>();
  const row = tx.get<{ def: string }>("SELECT def FROM rs_types WHERE name = ?", type);
  if (!row) return out;
  try {
    const def = JSON.parse(row.def) as { fields?: LooseField[] };
    for (const f of def.fields ?? []) if (typeof f.name === "string" && typeof f.kind === "string") out.set(f.name, f.kind);
  } catch { /* a bad def masks nothing; the row write still stands */ }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return canonical(a) === canonical(b); } catch { return false; }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

/** `records.field_meta`: clocks beside rt_<type>, rebuildable from the log. */
export const recordsFieldMeta: InlineProjection = {
  name: "records.field_meta",
  version: 1,
  mode: "inline",
  rebuild: "replay",
  init(tx) {
    tx.exec(HISTORY);
    tx.exec(HISTORY_IX);
    tx.exec(META);
  },
  reset(tx) {
    dropFm(tx);
    tx.exec("DELETE FROM records_field_history");
    tx.exec("DELETE FROM records_row_meta");
  },
  on: {
    "schema.applied"(tx, e) {
      const p = payloadOf<{ set?: { name?: string }[]; removed?: string[] }>(e);
      for (const d of p.set ?? []) if (typeof d?.name === "string" && TYPE_NAME.test(d.name)) ensureFm(tx, d.name);
      for (const name of p.removed ?? []) {
        if (typeof name !== "string" || !TYPE_NAME.test(name)) continue;
        forget(tx, name);
        tx.exec(`DROP TABLE IF EXISTS "${fieldMetaTable(name)}"`);
        tx.run("DELETE FROM records_field_history WHERE type = ?", name);
        tx.run("DELETE FROM records_row_meta WHERE type = ?", name);
      }
    },
    "record.created"(tx, e) {
      const p = payloadOf<{ type?: string; id?: string; data?: unknown }>(e);
      if (typeof p.type !== "string" || typeof p.id !== "string" || !TYPE_NAME.test(p.type)) return;
      ensureFm(tx, p.type);
      const table = fieldMetaTable(p.type);
      const data = asRecord(p.data);
      const names = Object.keys(data);
      if (names.length) {
        // One statement for every field of the row; the text depends only on the field count, so the statement cache hits.
        const marks = names.map(() => "(?, ?, ?, ?, 1)").join(", ");
        const args = names.flatMap((field) => [p.id, field, e.hlc, e.actor]);
        tx.run(`INSERT INTO "${table}" (id, field, hlc, actor, seq) VALUES ${marks} ON CONFLICT(id, field) DO UPDATE SET hlc = excluded.hlc, actor = excluded.actor, seq = excluded.seq`, ...args);
      }
      tx.run(
        "INSERT INTO records_row_meta (type, id, owner, label, holds) VALUES (?, ?, ?, 0, 0) ON CONFLICT(type, id) DO NOTHING",
        p.type, p.id, e.actor,
      );
    },
    "record.updated"(tx, e) {
      const p = payloadOf<{ type?: string; id?: string; data?: unknown; before?: unknown }>(e);
      if (typeof p.type !== "string" || typeof p.id !== "string" || !TYPE_NAME.test(p.type)) return;
      ensureFm(tx, p.type);
      const table = fieldMetaTable(p.type);
      const before = asRecord(p.before);
      const after = asRecord(p.data);
      const kind = kinds(tx, p.type);
      const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const field of fields) {
        const had = Object.prototype.hasOwnProperty.call(before, field);
        const has = Object.prototype.hasOwnProperty.call(after, field);
        if (had && has && same(before[field], after[field])) continue;
        if (!had && !has) continue;
        const prev = tx.get<{ seq: number }>(`SELECT seq FROM "${table}" WHERE id = ? AND field = ?`, p.id, field);
        const seq = (prev?.seq ?? 0) + 1;
        if (had) {
          tx.run(
            "INSERT INTO records_field_history (type, id, field, value, hlc, actor, seq, reason) VALUES (?, ?, ?, ?, ?, ?, ?, 'previous')",
            p.type, p.id, field, historyText(kind.get(field), field, before[field]), e.hlc, e.actor, seq,
          );
        }
        tx.run(
          `INSERT INTO "${table}" (id, field, hlc, actor, seq) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id, field) DO UPDATE SET hlc = excluded.hlc, actor = excluded.actor, seq = excluded.seq`,
          p.id, field, e.hlc, e.actor, seq,
        );
      }
    },
  },
};

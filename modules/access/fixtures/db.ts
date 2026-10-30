// In-memory db for access tests. Tables appear on the first DELETE or INSERT, which is how the store persists.
import type { AccessCtx, Db } from "../projections.ts";

export const NOW = 1_700_000_000_000;

/** The primary key of each table the store persists, as the migrations declare them: an upsert replaces the row with the same key. */
const PKS: Readonly<Record<string, readonly string[]>> = {
  access_meta: ["id"], access_roles: ["id"], access_role_changes: ["role_id"], access_groups: ["id"], access_principals: ["id"], access_assignments: ["holder", "role_id"],
  access_grants: ["id"], access_resources: ["id"], access_policies: ["key", "scope"], access_actors: ["id"], access_fields: ["k"],
};

const unquote = (c: string): string => c.trim().replace(/^"(.*)"$/, "$1");

export class MemoryDb implements Db {
  tables = new Map<string, Record<string, unknown>[]>();

  // the tables the migrations create exist, empty, from the start; any other table appears on its first write
  constructor() { for (const name of Object.keys(PKS)) this.tables.set(name, []); }

  all(sql: string, ..._args: unknown[]): unknown[] {
    const name = tableOf(sql);
    const rows = this.tables.get(name);
    if (!rows) throw new Error(`no table ${name}`);
    return rows.map((row) => ({ ...row }));
  }

  run(sql: string, ...args: unknown[]): { changes: number } {
    if (/^CREATE\s+/i.test(sql)) return { changes: 0 };
    const del = /^DELETE\s+FROM\s+([A-Za-z0-9_]+)(?:\s+WHERE\s+(.+))?$/i.exec(sql.trim());
    if (del) {
      const name = del[1]!;
      const rows = this.tables.get(name) ?? [];
      if (!del[2]) { this.tables.set(name, []); return { changes: rows.length }; }
      const cols = del[2].split(/\s+AND\s+/i).map((c) => unquote(c.split("=")[0]!));
      const keep = rows.filter((row) => !cols.every((c, i) => row[c] === (args[i] ?? null)));
      this.tables.set(name, keep);
      return { changes: rows.length - keep.length };
    }
    const ins = /^INSERT\s+(OR\s+REPLACE\s+)?INTO\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)(?:\s*ON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+UPDATE\s+SET\s+(\w+)\s*=\s*max\()?/i.exec(sql);
    if (!ins) throw new Error(`unsupported sql: ${sql}`);
    const name = ins[2]!;
    const cols = ins[3]!.split(",").map(unquote).filter((c) => c.length > 0);
    const row: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]!] = args[i] ?? null;
    const list = this.tables.get(name) ?? [];
    const pk = PKS[name];
    const at = pk ? list.findIndex((r) => pk.every((c) => r[c] === row[c])) : -1;
    if (at >= 0 && ins[6]) { const c = ins[6]; list[at]![c] = Math.max(Number(list[at]![c]), Number(row[c])); }   // ON CONFLICT DO UPDATE SET c = max(c, excluded.c)
    else if (at >= 0 && ins[1]) list[at] = row;                                                                      // OR REPLACE
    else list.push(row);
    this.tables.set(name, list);
    return { changes: 1 };
  }
}

function tableOf(sql: string): string {
  const m = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(sql);
  if (!m) throw new Error(`no table in ${sql}`);
  return m[1]!;
}

export function harness(now = NOW) {
  const db = new MemoryDb();
  const events: { name: string; subject: string; payload: unknown }[] = [];
  let clock = now;
  const ctx: AccessCtx = {
    space: "spc_test",
    principal: { kind: "person", id: "usr_admin" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db,
    emit(name, subject, payload) { events.push({ name, subject, payload }); },
  };
  return { db, ctx, events, setNow(n: number) { clock = n; } };
}

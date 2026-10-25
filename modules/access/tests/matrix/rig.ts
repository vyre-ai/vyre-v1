// A rig for the matrix and trace tests: the access store over an in-memory SQL stand-in that runs the statement shapes the share handlers use, a fixed clock, five people who are Members, and an
// owner. (Modules may not import node:sqlite, so the real handlers run against this, as share.test.ts does.)
import { putPrincipal } from "../../handlers/roles.ts";
import type { ShareCtx } from "../../handlers/share.ts";
import type { Db } from "../../projections.ts";
import { EVERYONE, storeOf } from "../../projections.ts";

export const NOW = 1_700_000_000_000;

export class SqlDb implements Db {
  tables = new Map<string, Record<string, unknown>[]>();
  all(sql: string): unknown[] {
    const name = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(sql)?.[1] ?? "";
    const rows = this.tables.get(name);
    if (!rows) throw new Error(`no table ${name}`);
    return rows.map((r) => ({ ...r }));
  }
  run(sql: string, ...args: unknown[]): { changes: number } {
    if (/^CREATE\s+/i.test(sql)) return { changes: 0 };
    const del = /^DELETE\s+FROM\s+([A-Za-z0-9_]+)(\s+WHERE\s+id\s*=\s*\?)?/i.exec(sql);
    if (del) {
      const name = del[1]!;
      const rows = this.tables.get(name) ?? [];
      const keep = del[2] ? rows.filter((r) => r["id"] !== args[0]) : [];
      this.tables.set(name, keep);
      return { changes: rows.length - keep.length };
    }
    const ins = /^INSERT\s+INTO\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
    if (!ins) throw new Error(`unsupported sql: ${sql}`);
    const cols = ins[2]!.split(",").map((c) => c.trim());
    const row: Record<string, unknown> = {};
    cols.forEach((c, i) => { row[c] = args[i] ?? null; });
    const list = this.tables.get(ins[1]!) ?? [];
    list.push(row);
    this.tables.set(ins[1]!, list);
    return { changes: 1 };
  }
}

export function rig() {
  const db = new SqlDb();
  const events: { name: string; subject: string; payload: unknown }[] = [];
  const ctx: ShareCtx = {
    space: "spc_test", principal: { kind: "person", id: "usr_admin" }, trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => NOW, db, emit(name, subject, payload) { events.push({ name, subject, payload }); },
  };
  const store = storeOf(ctx);
  const everyone = store.groups.get(EVERYONE)!;
  for (const id of ["usr_admin", "usr_a", "usr_b", "usr_c"]) {
    putPrincipal(store, { id, kind: "person", name: id });
    store.setRoles(id, [id === "usr_admin" ? "rol_owner" : "rol_member"]);
    everyone.members.push({ kind: "person", id });
  }
  store.bump();
  const as = (id: string): ShareCtx => ({ ...ctx, principal: { kind: "person", id } });
  const item = (id: string, owner: string | null, type = "site"): void => {
    store.resources.set(id, { id, type, parentId: null, label: "public", ownerId: owner, holds: 0, row: { title: id } });
    store.bump();
  };
  return { db, ctx, events, store, as, item };
}

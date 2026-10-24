// In-memory db for access tests. Tables appear on the first DELETE or INSERT, which is how the store persists.
import type { AccessCtx, Db } from "../projections.ts";

export const NOW = 1_700_000_000_000;

export class MemoryDb implements Db {
  private tables = new Map<string, Record<string, unknown>[]>();

  all(sql: string, ..._args: unknown[]): unknown[] {
    const name = tableOf(sql);
    const rows = this.tables.get(name);
    if (!rows) throw new Error(`no table ${name}`);
    return rows.map((row) => ({ ...row }));
  }

  run(sql: string, ...args: unknown[]): { changes: number } {
    if (/^CREATE\s+/i.test(sql)) return { changes: 0 };
    const del = /^DELETE\s+FROM\s+([A-Za-z0-9_]+)/i.exec(sql);
    if (del) {
      const name = del[1]!;
      const prev = this.tables.get(name)?.length ?? 0;
      this.tables.set(name, []);
      return { changes: prev };
    }
    const ins = /^INSERT\s+INTO\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
    if (!ins) throw new Error(`unsupported sql: ${sql}`);
    const name = ins[1]!;
    const cols = ins[2]!.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
    const row: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]!] = args[i] ?? null;
    const list = this.tables.get(name) ?? [];
    list.push(row);
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

// An in-memory stand-in for ctx.db that runs the statement shapes this module uses (INSERT, SELECT with an optional equality WHERE, UPDATE ... WHERE id = ?). It reads the module's own migration
// for the columns and NOT NULL rules, and every statement also has to pass the host's module table guard, so a handler cannot drift into SQL the tests never ran or a table it does not own.
// (Modules may not import node:sqlite, ARCH B2.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkSql } from "../../../host/src/ctx/db.ts";
import type { Db } from "../projections.ts";

export const MIGRATION = fileURLToPath(new URL("../migrations/0001_vault_requests.sql", import.meta.url));
type Cell = string | number | null;
type Row = Record<string, Cell>;
interface Col { name: string; notNull: boolean }

export function columns(sql: string): Map<string, { cols: Col[]; pk: string }> {
  const out = new Map<string, { cols: Col[]; pk: string }>();
  const text = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/"/g, "");
  for (const m of text.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const cols: Col[] = [];
    let pk = "id";
    for (const part of m[2]!.split(",").map((p) => p.trim()).filter(Boolean)) {
      const name = /^(\w+)/.exec(part)![1]!;
      if (/PRIMARY KEY/i.test(part)) pk = name;
      cols.push({ name, notNull: /NOT NULL/i.test(part) || /PRIMARY KEY/i.test(part) });
    }
    out.set(m[1]!, { cols, pk });
  }
  return out;
}

export class MemoryDb implements Db {
  private tables = new Map<string, Row[]>();
  private schema = columns(readFileSync(MIGRATION, "utf8"));
  /** every statement seen, for the tests that check what was run */
  statements: string[] = [];

  private guard(sql: string): string {
    const r = checkSql("vault-requests", sql);
    if (!r.ok) throw new Error(`module table guard: ${r.why}`);
    this.statements.push(sql);
    const name = r.tables[0]!;
    if (!this.schema.has(name)) throw new Error(`no such table ${name}`);
    return name;
  }

  all(sql: string, ...args: unknown[]): unknown[] {
    const name = this.guard(sql);
    const m = /^SELECT \* FROM \w+(?:\s+WHERE\s+(\w+)\s*=\s*\?)?\s*$/i.exec(sql.trim());
    if (!m) throw new Error(`unsupported select: ${sql}`);
    const rows = this.tables.get(name) ?? [];
    const col = m[1];
    return rows.filter((r) => !col || r[col] === (args[0] as Cell)).map((r) => ({ ...r }));
  }

  run(sql: string, ...args: unknown[]): { changes: number } {
    const name = this.guard(sql);
    const t = this.schema.get(name)!;
    const ins = /^INSERT INTO \w+\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)\s*$/i.exec(sql.trim());
    if (ins) {
      const cols = ins[1]!.split(",").map((c) => c.trim());
      const marks = ins[2]!.split(",").length;
      if (marks !== cols.length || args.length !== cols.length) throw new Error(`${cols.length} columns, ${marks} marks, ${args.length} values`);
      const row: Row = {};
      for (const c of t.cols) row[c.name] = null;
      cols.forEach((c, i) => {
        if (!t.cols.some((x) => x.name === c)) throw new Error(`no column ${c}`);
        row[c] = args[i] as Cell;
      });
      for (const c of t.cols) if (c.notNull && row[c.name] === null) throw new Error(`NOT NULL constraint failed: ${name}.${c.name}`);
      const rows = this.tables.get(name) ?? [];
      if (rows.some((r) => r[t.pk] === row[t.pk])) throw new Error(`UNIQUE constraint failed: ${name}.${t.pk}`);
      rows.push(row);
      this.tables.set(name, rows);
      return { changes: 1 };
    }
    const upd = /^UPDATE \w+ SET\s+([\s\S]+?)\s+WHERE\s+(\w+)\s*=\s*\?\s*$/i.exec(sql.trim());
    if (upd) {
      const sets = upd[1]!.split(",").map((s) => /^\s*(\w+)\s*=\s*\?\s*$/.exec(s)?.[1] ?? "");
      if (sets.some((s) => !s || !t.cols.some((c) => c.name === s))) throw new Error(`unsupported update: ${sql}`);
      if (args.length !== sets.length + 1) throw new Error(`${sets.length + 1} marks, ${args.length} values`);
      const rows = this.tables.get(name) ?? [];
      let changes = 0;
      for (const r of rows) {
        if (r[upd[2]!] !== (args[sets.length] as Cell)) continue;
        sets.forEach((s, i) => { r[s] = args[i] as Cell; });
        for (const c of t.cols) if (c.notNull && r[c.name] === null) throw new Error(`NOT NULL constraint failed: ${name}.${c.name}`);
        changes++;
      }
      return { changes };
    }
    throw new Error(`unsupported statement: ${sql}`);
  }

  /** every stored cell as one string, for "no value anywhere" checks */
  dump(): string { return JSON.stringify([...this.tables.entries()]); }
}

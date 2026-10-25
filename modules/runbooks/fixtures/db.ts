// An in-memory database for the runbooks tests that understands the few SQL shapes the handlers use (INSERT, UPDATE and DELETE by equality, SELECT * with equality filters).
// Any other statement fails loudly so a handler cannot quietly use a table or a clause the migration and this fixture do not cover.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";

type Row = Record<string, unknown>;

export function memoryDb(): Ctx["db"] & { rows(table: string): Row[] } {
  const tables = new Map<string, Row[]>();
  const bag = (name: string): Row[] => {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  };
  const take = (args: unknown[], at: { i: number }): unknown => {
    if (at.i >= args.length) throw new Error("sql is missing a value");
    const value = args[at.i];
    at.i += 1;
    return value;
  };
  const compile = (where: string | undefined, args: unknown[], at: { i: number }): ((row: Row) => boolean) => {
    if (!where) return () => true;
    const preds: ((row: Row) => boolean)[] = [];
    for (const part of where.split(" AND ")) {
      const isNull = /^(\w+) IS NULL$/.exec(part);
      if (isNull) {
        const col = isNull[1];
        if (col === undefined) throw new Error(`bad predicate ${part}`);
        preds.push((row) => row[col] === null || row[col] === undefined);
        continue;
      }
      const eq = /^(\w+) = \?$/.exec(part);
      if (!eq) throw new Error(`bad predicate ${part}`);
      const col = eq[1];
      if (col === undefined) throw new Error(`bad predicate ${part}`);
      const val = take(args, at);
      preds.push((row) => {
        const cur = row[col];
        if (cur === null || cur === undefined) return false;
        return cur === val;
      });
    }
    return (row) => preds.every((pred) => pred(row));
  };
  const all = (sql: string, ...args: unknown[]): unknown[] => {
    const text = sql.replace(/\s+/g, " ").trim();
    const sel = /^SELECT \* FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (!sel) throw new Error(`unsupported sql: ${text}`);
    const name = sel[1];
    if (name === undefined) throw new Error(`unsupported sql: ${text}`);
    const at = { i: 0 };
    const pred = compile(sel[2], args, at);
    if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
    return bag(name).filter(pred).map((row) => ({ ...row }));
  };
  const run = (sql: string, ...args: unknown[]): { changes: number } => {
    const text = sql.replace(/\s+/g, " ").trim();
    const at = { i: 0 };
    const insert = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(text);
    if (insert) {
      const name = insert[1];
      const colSql = insert[2];
      const valSql = insert[3];
      if (name === undefined || colSql === undefined || valSql === undefined) throw new Error(`unsupported sql: ${text}`);
      const cols = colSql.split(",").map((col) => col.trim());
      const marks = valSql.split(",").map((mark) => mark.trim());
      if (marks.some((mark) => mark !== "?") || marks.length !== cols.length) throw new Error(`unsupported sql: ${text}`);
      const row: Row = {};
      for (const col of cols) row[col] = take(args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      bag(name).push(row);
      return { changes: 1 };
    }
    const update = /^UPDATE (\w+) SET (.+) WHERE (.+)$/.exec(text);
    if (update) {
      const name = update[1];
      const setSql = update[2];
      const where = update[3];
      if (name === undefined || setSql === undefined || where === undefined) throw new Error(`unsupported sql: ${text}`);
      const assigns: { col: string; val: unknown }[] = [];
      for (const part of setSql.split(", ")) {
        const m = /^(\w+) = \?$/.exec(part);
        if (!m || m[1] === undefined) throw new Error(`bad assignment ${part}`);
        assigns.push({ col: m[1], val: take(args, at) });
      }
      const pred = compile(where, args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      let changes = 0;
      for (const row of bag(name)) {
        if (!pred(row)) continue;
        for (const assign of assigns) row[assign.col] = assign.val;
        changes += 1;
      }
      return { changes };
    }
    const del = /^DELETE FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (!del || del[1] === undefined) throw new Error(`unsupported sql: ${text}`);
    const name = del[1];
    const pred = compile(del[2], args, at);
    if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
    const kept: Row[] = [];
    let changes = 0;
    for (const row of bag(name)) {
      if (pred(row)) changes += 1;
      else kept.push(row);
    }
    tables.set(name, kept);
    return { changes };
  };
  return { all, run, rows: (table) => bag(table).map((row) => ({ ...row })) };
}

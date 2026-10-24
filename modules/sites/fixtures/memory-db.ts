// In-memory ctx.db for sites tests. Accepts only the statement shape the handlers emit.
// No node:sqlite (boundary B2): modules other than search do not open SQLite themselves.

export type SqlVal = string | number | null;
type Row = Record<string, SqlVal>;

export interface MemoryDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

function asVal(v: unknown): SqlVal {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  throw new Error(`bad sql value ${typeof v}`);
}

function names(list: string): string[] {
  return list.split(",").map((part) => {
    const name = part.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad sql name ${part}`);
    return name;
  });
}

function assignments(body: string): string[] {
  return body.split(",").map((part) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\?$/.exec(part.trim());
    const col = match?.[1];
    if (!col) throw new Error(`bad sql assignment ${part}`);
    return col;
  });
}

function predicate(body: string, args: SqlVal[], at: { i: number }): (row: Row) => boolean {
  if (!body.trim()) return () => true;
  const checks = body.split(/\s+AND\s+/).map((part) => {
    const col = assignments(part)[0];
    if (!col) throw new Error(`bad sql where ${part}`);
    const val = args[at.i];
    at.i += 1;
    if (val === undefined) throw new Error("sql is missing a bound value");
    return (row: Row) => row[col] === val;
  });
  return (row) => checks.every((check) => check(row));
}

function orderOf(body: string): { col: string; dir: "ASC" | "DESC" } {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+(ASC|DESC)$/.exec(body.trim());
  const col = match?.[1];
  const dir = match?.[2];
  if (!col || (dir !== "ASC" && dir !== "DESC")) throw new Error(`bad sql order ${body}`);
  return { col, dir };
}

function copy(row: Row): Row {
  return { ...row };
}

export function memoryDb(): MemoryDb {
  const tables = new Map<string, Row[]>();
  const bag = (table: string): Row[] => {
    let rows = tables.get(table);
    if (!rows) {
      rows = [];
      tables.set(table, rows);
    }
    return rows;
  };

  return {
    all(sql, ...raw) {
      const args = raw.map(asVal);
      const text = sql.trim();
      const from = text.indexOf(" FROM ");
      if (!text.startsWith("SELECT ") || from < 0) throw new Error(`unsupported sql: ${text}`);
      const cols = names(text.slice("SELECT ".length, from));
      let rest = text.slice(from + " FROM ".length);
      let where = "";
      let order = "";
      const whereAt = rest.indexOf(" WHERE ");
      const orderAt = rest.indexOf(" ORDER BY ");
      let table = rest;
      if (whereAt >= 0) {
        table = rest.slice(0, whereAt);
        const after = rest.slice(whereAt + " WHERE ".length);
        const split = after.indexOf(" ORDER BY ");
        if (split >= 0) {
          where = after.slice(0, split);
          order = after.slice(split + " ORDER BY ".length);
        } else where = after;
      } else if (orderAt >= 0) {
        table = rest.slice(0, orderAt);
        order = rest.slice(orderAt + " ORDER BY ".length);
      }
      const name = table.trim();
      const at = { i: 0 };
      const match = predicate(where, args, at);
      if (at.i !== args.length) throw new Error(`sql bound ${args.length} values, used ${at.i}`);
      let rows = bag(name).filter(match).map(copy);
      if (order) {
        const { col, dir } = orderOf(order);
        rows.sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          const less = av < bv ? -1 : 1;
          return dir === "ASC" ? less : -less;
        });
      }
      return rows.map((row) => {
        const out: Row = {};
        for (const col of cols) out[col] = row[col] ?? null;
        return out;
      });
    },
    run(sql, ...raw) {
      const args = raw.map(asVal);
      const text = sql.trim();
      if (text.startsWith("INSERT INTO ")) {
        const match = /^INSERT INTO ([A-Za-z_][A-Za-z0-9_]*) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(text);
        if (!match?.[1] || !match[2] || !match[3]) throw new Error(`unsupported sql: ${text}`);
        const cols = names(match[2]);
        const marks = match[3].split(",").map((part) => part.trim());
        if (marks.some((mark) => mark !== "?") || marks.length !== cols.length || cols.length !== args.length) {
          throw new Error(`sql insert arity mismatch: ${text}`);
        }
        const row: Row = {};
        cols.forEach((col, i) => {
          row[col] = args[i] ?? null;
        });
        bag(match[1]).push(row);
        return { changes: 1 };
      }
      if (text.startsWith("UPDATE ")) {
        const setAt = text.indexOf(" SET ");
        const whereAt = text.indexOf(" WHERE ");
        if (setAt < 0 || whereAt < 0) throw new Error(`unsupported sql: ${text}`);
        const table = text.slice("UPDATE ".length, setAt).trim();
        const cols = assignments(text.slice(setAt + " SET ".length, whereAt));
        const at = { i: cols.length };
        const match = predicate(text.slice(whereAt + " WHERE ".length), args, at);
        if (at.i !== args.length) throw new Error(`sql bound ${args.length} values, used ${at.i}`);
        let changes = 0;
        for (const row of bag(table)) {
          if (!match(row)) continue;
          cols.forEach((col, i) => {
            row[col] = args[i] ?? null;
          });
          changes += 1;
        }
        return { changes };
      }
      if (text.startsWith("DELETE FROM ")) {
        const whereAt = text.indexOf(" WHERE ");
        if (whereAt < 0) throw new Error(`unsupported sql: ${text}`);
        const table = text.slice("DELETE FROM ".length, whereAt).trim();
        const at = { i: 0 };
        const match = predicate(text.slice(whereAt + " WHERE ".length), args, at);
        if (at.i !== args.length) throw new Error(`sql bound ${args.length} values, used ${at.i}`);
        const rows = bag(table);
        const kept = rows.filter((row) => !match(row));
        const changes = rows.length - kept.length;
        tables.set(table, kept);
        return { changes };
      }
      throw new Error(`unsupported sql: ${text}`);
    },
  };
}

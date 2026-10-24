// In-memory ctx.db for twilio tests. Statements are the ones the handlers issue: one table, placeholders, AND equals.
export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

type Row = Record<string, unknown>;

const csv = (s: string): string[] => s.split(",").map((p) => p.trim()).filter((p) => p.length > 0);

function matchWhere(row: Row, where: string | undefined, args: unknown[]): boolean {
  if (!where) return args.length === 0;
  const parts = where.split(/\s+AND\s+/i).map((p) => p.trim());
  if (parts.length !== args.length) throw new Error(`where arity: ${where}`);
  return parts.every((p, i) => {
    const m = /^(\w+) = \?$/.exec(p);
    if (!m) throw new Error(`bad where: ${p}`);
    return row[m[1]!] === args[i];
  });
}

export function memoryDb(): Db {
  const tables = new Map<string, Row[]>();
  const table = (name: string): Row[] => {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  };
  return {
    all(sql, ...args) {
      const text = sql.replace(/\s+/g, " ").trim();
      const sel = /^SELECT (.+) FROM (\w+)(?: WHERE (.+))?$/i.exec(text);
      if (!sel) throw new Error(`unsupported sql: ${text}`);
      const name = sel[2]!;
      let rows = table(name).filter((r) => matchWhere(r, sel[3], args)).map((r) => ({ ...r }));
      if (sel[1] !== "*") {
        const cols = csv(sel[1]!);
        rows = rows.map((r) => {
          const o: Row = {};
          for (const c of cols) o[c] = r[c];
          return o;
        });
      }
      return rows;
    },
    run(sql, ...args) {
      const text = sql.replace(/\s+/g, " ").trim();
      const ins = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i.exec(text);
      if (ins) {
        const cols = csv(ins[2]!);
        const marks = csv(ins[3]!);
        if (marks.length !== cols.length || marks.some((m) => m !== "?")) throw new Error(`bad insert: ${text}`);
        const row: Row = {};
        cols.forEach((c, i) => { row[c] = args[i]; });
        table(ins[1]!).push(row);
        return { changes: 1 };
      }
      const upd = /^UPDATE (\w+) SET (.+) WHERE (.+)$/i.exec(text);
      if (upd) {
        const sets = csv(upd[2]!).map((p) => {
          const m = /^(\w+) = \?$/.exec(p.trim());
          if (!m) throw new Error(`bad set: ${p}`);
          return m[1]!;
        });
        const whereArgs = args.slice(sets.length);
        let changes = 0;
        for (const row of table(upd[1]!)) {
          if (!matchWhere(row, upd[3], whereArgs)) continue;
          sets.forEach((c, i) => { row[c] = args[i]; });
          changes += 1;
        }
        return { changes };
      }
      const del = /^DELETE FROM (\w+) WHERE (.+)$/i.exec(text);
      if (del) {
        const rows = table(del[1]!);
        const keep = rows.filter((r) => !matchWhere(r, del[2], args));
        const changes = rows.length - keep.length;
        tables.set(del[1]!, keep);
        return { changes };
      }
      throw new Error(`unsupported sql: ${text}`);
    },
  };
}

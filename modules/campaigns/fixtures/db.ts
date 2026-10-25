// In-memory ScopedDb for campaigns tests. It reads the real migration, so a column or table the SQL names that the migration lacks fails here,
// and it enforces the primary keys and NOT NULL columns the migration declares.
// Supported SQL: SELECT * FROM t [WHERE c = ? | c IS NULL | c IS NOT NULL [AND ...]], INSERT INTO t (cols) VALUES (?, ...), UPDATE t SET c = ?, ... [WHERE ...], DELETE FROM t [WHERE ...].

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Row = Record<string, unknown>;

interface TableDef {
  columns: string[];
  primary: string[];
  unique: string[][];
  required: Set<string>;
  defaults: Map<string, unknown>;
}

const here = dirname(fileURLToPath(import.meta.url));

export function readMigration(): string {
  return readFileSync(join(here, "../migrations/0001_campaigns.sql"), "utf8");
}

function parseDefault(text: string): unknown {
  const t = text.trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  const quoted = /^'(.*)'$/.exec(t);
  return quoted ? quoted[1] : t;
}

export function parseSchema(sql: string): Map<string, TableDef> {
  const tables = new Map<string, TableDef>();
  const re = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const name = m[1];
    const body = m[2];
    if (name === undefined || body === undefined) continue;
    const def: TableDef = { columns: [], primary: [], unique: [], required: new Set(), defaults: new Map() };
    for (const raw of body.split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      if (!line) continue;
      const pk = /^PRIMARY KEY \(([^)]+)\)$/.exec(line);
      if (pk && pk[1]) {
        def.primary = pk[1].split(",").map((c) => c.trim());
        continue;
      }
      const col = /^(\w+) (TEXT|INTEGER)\b(.*)$/.exec(line);
      const colName = col?.[1];
      if (!col || colName === undefined) throw new Error(`cannot read column line: ${line}`);
      const rest = col[3] ?? "";
      def.columns.push(colName);
      if (/PRIMARY KEY/.test(rest)) def.primary = [colName];
      const dflt = /DEFAULT (\S+)/.exec(rest);
      if (dflt && dflt[1]) def.defaults.set(colName, parseDefault(dflt[1]));
      if (/NOT NULL/.test(rest) || /PRIMARY KEY/.test(rest)) def.required.add(colName);
    }
    tables.set(name, def);
  }
  const idx = /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON (\w+) \(([^)]+)\);/g;
  for (let m = idx.exec(sql); m; m = idx.exec(sql)) {
    const def = m[1] ? tables.get(m[1]) : undefined;
    if (!def || !m[2]) throw new Error("unique index on an unknown table");
    def.unique.push(m[2].split(",").map((c) => c.trim()));
  }
  return tables;
}

export class MemoryDb {
  readonly schema: Map<string, TableDef>;
  private readonly data = new Map<string, Row[]>();
  statements = 0;

  constructor(sql: string = readMigration()) {
    this.schema = parseSchema(sql);
    for (const name of this.schema.keys()) this.data.set(name, []);
  }

  rows(table: string): Row[] {
    const rows = this.data.get(table);
    if (!rows) throw new Error(`no table ${table}`);
    return rows.map((r) => ({ ...r }));
  }

  private table(name: string): { def: TableDef; rows: Row[] } {
    const def = this.schema.get(name);
    const rows = this.data.get(name);
    if (!def || !rows) throw new Error(`no table ${name}`);
    return { def, rows };
  }

  private predicate(def: TableDef, where: string | undefined, args: unknown[], at: { i: number }): (row: Row) => boolean {
    if (!where) return () => true;
    const preds: ((row: Row) => boolean)[] = [];
    for (const part of where.split(" AND ")) {
      const notNull = /^(\w+) IS NOT NULL$/.exec(part);
      const isNull = /^(\w+) IS NULL$/.exec(part);
      const eq = /^(\w+) = \?$/.exec(part);
      const col = (notNull ?? isNull ?? eq)?.[1];
      if (!col) throw new Error(`bad predicate ${part}`);
      if (!def.columns.includes(col)) throw new Error(`no column ${col}`);
      if (notNull) preds.push((row) => row[col] !== null && row[col] !== undefined);
      else if (isNull) preds.push((row) => row[col] === null || row[col] === undefined);
      else {
        if (at.i >= args.length) throw new Error("sql is missing a value");
        const val = args[at.i];
        at.i += 1;
        if (val === undefined) throw new Error(`undefined bound to ${col}`);
        preds.push((row) => row[col] === val);
      }
    }
    return (row) => preds.every((p) => p(row));
  }

  all(sql: string, ...args: unknown[]): unknown[] {
    this.statements += 1;
    const text = sql.replace(/\s+/g, " ").trim();
    const sel = /^SELECT \* FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (!sel || !sel[1]) throw new Error(`unsupported sql: ${text}`);
    const { def, rows } = this.table(sel[1]);
    const at = { i: 0 };
    const pred = this.predicate(def, sel[2], args, at);
    if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
    return rows.filter(pred).map((r) => ({ ...r }));
  }

  run(sql: string, ...args: unknown[]): { changes: number } {
    this.statements += 1;
    const text = sql.replace(/\s+/g, " ").trim();
    const ins = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(text);
    if (ins && ins[1] && ins[2] && ins[3]) {
      const { def, rows } = this.table(ins[1]);
      const cols = ins[2].split(",").map((c) => c.trim());
      if (ins[3].split(",").length !== cols.length || args.length !== cols.length) throw new Error(`value count does not match columns: ${text}`);
      const row: Row = {};
      for (const c of def.columns) row[c] = def.defaults.has(c) ? def.defaults.get(c) : null;
      cols.forEach((c, i) => {
        if (!def.columns.includes(c)) throw new Error(`no column ${c}`);
        const v = args[i];
        if (v === undefined) throw new Error(`undefined bound to ${c}`);
        row[c] = v;
      });
      for (const c of def.required) if (row[c] === null) throw new Error(`NOT NULL constraint failed: ${ins[1]}.${c}`);
      if (def.primary.length > 0 && rows.some((r) => def.primary.every((c) => r[c] === row[c]))) {
        throw new Error(`UNIQUE constraint failed: ${ins[1]}.${def.primary.join(",")}`);
      }
      for (const cols2 of def.unique) {
        if (rows.some((r) => cols2.every((c) => r[c] === row[c]))) throw new Error(`UNIQUE constraint failed: ${ins[1]}.${cols2.join(",")}`);
      }
      rows.push(row);
      return { changes: 1 };
    }
    const upd = /^UPDATE (\w+) SET (.+?)(?: WHERE (.+))?$/.exec(text);
    if (upd && upd[1] && upd[2]) {
      const { def, rows } = this.table(upd[1]);
      const sets = upd[2].split(", ").map((s) => {
        const m = /^(\w+) = \?$/.exec(s);
        if (!m || !m[1]) throw new Error(`bad assignment ${s}`);
        if (!def.columns.includes(m[1])) throw new Error(`no column ${m[1]}`);
        return m[1];
      });
      const at = { i: sets.length };
      const pred = this.predicate(def, upd[3], args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      let changes = 0;
      for (const row of rows) {
        if (!pred(row)) continue;
        sets.forEach((c, i) => {
          const v = args[i];
          if (v === undefined) throw new Error(`undefined bound to ${c}`);
          if (v === null && def.required.has(c)) throw new Error(`NOT NULL constraint failed: ${upd[1]}.${c}`);
          row[c] = v;
        });
        changes += 1;
      }
      return { changes };
    }
    const del = /^DELETE FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (del && del[1]) {
      const { def, rows } = this.table(del[1]);
      const at = { i: 0 };
      const pred = this.predicate(def, del[2], args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      const keep = rows.filter((r) => !pred(r));
      const changes = rows.length - keep.length;
      rows.length = 0;
      rows.push(...keep);
      return { changes };
    }
    throw new Error(`unsupported sql: ${text}`);
  }
}

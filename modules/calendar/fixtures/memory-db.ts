// In-memory SQL for calendar tests. Covers the statements the handlers emit (AND-ed =, <, <=, >, >=, !=, LIKE, IS [NOT] NULL; one ORDER BY column). Not a SQLite.
import type { CalDb } from "../projections.ts";

type Val = string | number | null;
type Row = Record<string, Val>;

interface Table {
  pk: string[];
  rows: Row[];
}

export function memoryDb(): CalDb {
  const tables = new Map<string, Table>();

  const exec = (sql: string, args: unknown[]): { changes: number } | Row[] => {
    const s = sql.trim().replace(/;+\s*$/, "");
    const head = s.slice(0, 24).toLowerCase();
    if (head.startsWith("create table")) return createTable(tables, s);
    if (head.startsWith("create index") || head.startsWith("create unique index")) return { changes: 0 };
    if (head.startsWith("insert")) return insert(tables, s, args);
    if (head.startsWith("update")) return update(tables, s, args);
    if (head.startsWith("delete")) return remove(tables, s, args);
    if (head.startsWith("select")) return select(tables, s, args);
    throw new Error(`unsupported sql: ${s}`);
  };

  return {
    all(sql, ...args) {
      const out = exec(sql, args);
      if (Array.isArray(out)) return out;
      return [];
    },
    run(sql, ...args) {
      const out = exec(sql, args);
      if (Array.isArray(out)) return { changes: 0 };
      return out;
    },
  };
}

function createTable(tables: Map<string, Table>, sql: string): { changes: number } {
  const m = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(\S+)\s*\(([\s\S]*)\)\s*$/i.exec(sql);
  if (!m) throw new Error(`bad create: ${sql}`);
  const name = ident(m[1] ?? "");
  if (tables.has(name)) return { changes: 0 };
  const inline: string[] = [];
  let tablePk: string[] = [];
  for (const part of splitCommas(m[2] ?? "")) {
    const t = part.trim();
    const pk = /^primary\s+key\s*\(([\s\S]+)\)$/i.exec(t);
    if (pk) {
      tablePk = splitCommas(pk[1] ?? "").map((c) => ident(c));
      continue;
    }
    const col = ident(t.split(/\s+/)[0] ?? "");
    if (/primary\s+key/i.test(t)) inline.push(col);
  }
  tables.set(name, { pk: inline.length ? inline : tablePk, rows: [] });
  return { changes: 0 };
}

function insert(tables: Map<string, Table>, sql: string, args: unknown[]): { changes: number } {
  const m = /^insert\s+(or\s+ignore\s+)?into\s+(\S+)\s*\(([\s\S]+)\)\s*values\s*\(([\s\S]+)\)\s*$/i.exec(sql);
  if (!m) throw new Error(`bad insert: ${sql}`);
  const ignore = Boolean(m[1]);
  const table = must(tables, ident(m[2] ?? ""));
  const cols = splitCommas(m[3] ?? "").map((c) => ident(c));
  const marks = splitCommas(m[4] ?? "").map((v) => v.trim());
  if (marks.some((v) => v !== "?") || marks.length !== args.length || cols.length !== args.length) throw new Error(`insert arity: ${sql}`);
  const row: Row = {};
  cols.forEach((col, i) => { row[col] = norm(args[i]); });
  if (table.pk.length) {
    const clash = table.rows.some((have) => table.pk.every((col) => have[col] === row[col]));
    if (clash) {
      if (ignore) return { changes: 0 };
      throw new Error(`duplicate ${ident(m[2] ?? "")}`);
    }
  }
  table.rows.push(row);
  return { changes: 1 };
}

function update(tables: Map<string, Table>, sql: string, args: unknown[]): { changes: number } {
  const m = /^update\s+(\S+)\s+set\s+([\s\S]+)\s+where\s+([\s\S]+)$/i.exec(sql);
  if (!m) throw new Error(`bad update: ${sql}`);
  const table = must(tables, ident(m[1] ?? ""));
  const cols = splitCommas(m[2] ?? "").map((part) => {
    const eq = /^([\s\S]+?)\s*=\s*\?$/.exec(part.trim());
    if (!eq) throw new Error(`bad set: ${part}`);
    return ident(eq[1] ?? "");
  });
  const pred = compileWhere(m[3] ?? "", args.slice(cols.length));
  let changes = 0;
  for (const row of table.rows) {
    if (!pred(row)) continue;
    cols.forEach((col, i) => { row[col] = norm(args[i]); });
    changes++;
  }
  return { changes };
}

function remove(tables: Map<string, Table>, sql: string, args: unknown[]): { changes: number } {
  const m = /^delete\s+from\s+(\S+)\s+where\s+([\s\S]+)$/i.exec(sql);
  if (!m) throw new Error(`bad delete: ${sql}`);
  const table = must(tables, ident(m[1] ?? ""));
  const pred = compileWhere(m[2] ?? "", args);
  const before = table.rows.length;
  table.rows = table.rows.filter((row) => !pred(row));
  return { changes: before - table.rows.length };
}

function select(tables: Map<string, Table>, sql: string, args: unknown[]): Row[] {
  let order: { col: string; dir: number } | null = null;
  let body = sql.trim();
  const om = /\s+order\s+by\s+(\S+)\s+(asc|desc)\s*$/i.exec(body);
  if (om) {
    order = { col: ident(om[1] ?? ""), dir: (om[2] ?? "").toLowerCase() === "asc" ? 1 : -1 };
    body = body.slice(0, om.index);
  }
  const m = /^select\s+([\s\S]+)\s+from\s+(\S+)(?:\s+where\s+([\s\S]+))?$/i.exec(body.trim());
  if (!m) throw new Error(`bad select: ${sql}`);
  const table = must(tables, ident(m[2] ?? ""));
  const pred = m[3] ? compileWhere(m[3], args) : () => true;
  let rows = table.rows.filter(pred);
  if (order) {
    const { col, dir } = order;
    rows = [...rows].sort((a, b) => {
      const av = a[col] ?? null;
      const bv = b[col] ?? null;
      if (av === bv) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av < bv ? -dir : dir;
    });
  }
  const list = (m[1] ?? "").trim();
  if (list === "*") return rows.map((row) => ({ ...row }));
  const count = /^count\(\*\)\s+as\s+(\S+)$/i.exec(list);
  if (count) return [{ [ident(count[1] ?? "n")]: rows.length }];
  const cols = splitCommas(list).map((c) => ident(c));
  return rows.map((row) => {
    const out: Row = {};
    for (const col of cols) out[col] = row[col] ?? null;
    return out;
  });
}

function compileWhere(src: string, args: unknown[]): (row: Row) => boolean {
  const preds: ((row: Row) => boolean)[] = [];
  let i = 0;
  for (const term of src.split(/\s+AND\s+/i)) {
    const t = term.trim();
    let m: RegExpExecArray | null;
    if ((m = /^([\s\S]+?)\s+is\s+not\s+null$/i.exec(t))) {
      const col = ident(m[1] ?? "");
      preds.push((row) => row[col] !== null && row[col] !== undefined);
    } else if ((m = /^([\s\S]+?)\s+is\s+null$/i.exec(t))) {
      const col = ident(m[1] ?? "");
      preds.push((row) => row[col] === null || row[col] === undefined);
    } else if ((m = /^([\s\S]+?)\s+like\s+\?$/i.exec(t))) {
      const col = ident(m[1] ?? "");
      const pattern = likeToRegExp(String(args[i++] ?? ""));
      preds.push((row) => pattern.test(String(row[col] ?? "")));
    } else if ((m = /^([\s\S]+?)\s*(<=|>=|!=|<>|<|>)\s*\?$/i.exec(t))) {
      const col = ident(m[1] ?? "");
      const op = m[2] ?? "<";
      const value = norm(args[i++]);
      preds.push((row) => {
        const have = row[col] ?? null;
        if (have === null || value === null) return false;   // SQL: a comparison with NULL is never true
        if (op === "<") return have < value;
        if (op === "<=") return have <= value;
        if (op === ">") return have > value;
        if (op === ">=") return have >= value;
        return have !== value;
      });
    } else if ((m = /^([\s\S]+?)\s*=\s*\?$/i.exec(t))) {
      const col = ident(m[1] ?? "");
      const value = norm(args[i++]);
      preds.push((row) => row[col] === value);
    } else throw new Error(`bad where: ${t}`);
  }
  if (i !== args.length) throw new Error(`where arity: ${src}`);
  return (row) => preds.every((pred) => pred(row));
}

function likeToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const c of pattern) {
    if (c === "%") out += "[\\s\\S]*";
    else if (c === "_") out += "[\\s\\S]";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

function must(tables: Map<string, Table>, name: string): Table {
  const table = tables.get(name);
  if (!table) throw new Error(`no table ${name}`);
  return table;
}

function ident(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1).replaceAll('""', '"');
  return t.toLowerCase();
}

function norm(v: unknown): Val {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new Error("bad bind");
}

function splitCommas(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

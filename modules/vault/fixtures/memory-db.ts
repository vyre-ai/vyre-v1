// In-memory SQL for the vault tests (the same fixture the other L5 modules keep, one copy per module: modules are leaf nodes, B1). It covers the statements the handlers emit and nothing more: CREATE TABLE and INDEX, INSERT
// (OR IGNORE), UPDATE and DELETE with AND-joined terms, and SELECT with the same terms, ORDER BY several columns, LIMIT and OFFSET, and
// count(*). A term is `col IS [NOT] NULL`, `col = ?`, `col LIKE ?` or `col IN (?, ...)`. Not a SQLite: a statement outside this list throws,
// so a handler that drifts into new SQL fails its test loudly instead of passing on a wrong answer.
import type { VaultDb } from "../projections.ts";

type Val = string | number | null;
type Row = Record<string, Val>;
interface Table { pk: string[]; rows: Row[] }

export interface WriteLog { statements: string[] }

export function memoryDb(log?: WriteLog): VaultDb & { dump(): string } {
  const tables = new Map<string, Table>();
  const exec = (sql: string, args: unknown[]): { changes: number } | Row[] => {
    const s = sql.trim().replace(/;+\s*$/, "");
    const head = s.slice(0, 24).toLowerCase();
    if (head.startsWith("create table")) return createTable(tables, s);
    if (head.startsWith("create index") || head.startsWith("create unique index")) return { changes: 0 };
    if (head.startsWith("select")) return select(tables, s, args);
    log?.statements.push(s);
    if (head.startsWith("insert")) return insert(tables, s, args);
    if (head.startsWith("update")) return update(tables, s, args);
    if (head.startsWith("delete")) return remove(tables, s, args);
    throw new Error(`unsupported sql: ${s}`);
  };
  return {
    /** Every table and row as text, for a before and after comparison. */
    dump: () => JSON.stringify([...tables.entries()].sort(([a], [b]) => a.localeCompare(b))),
    all(sql, ...args) {
      const out = exec(sql, args);
      return Array.isArray(out) ? out : [];
    },
    run(sql, ...args) {
      const out = exec(sql, args);
      return Array.isArray(out) ? { changes: 0 } : out;
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
    if (/primary\s+key/i.test(t)) inline.push(ident(t.split(/\s+/)[0] ?? ""));
  }
  tables.set(name, { pk: inline.length ? inline : tablePk, rows: [] });
  return { changes: 0 };
}

function insert(tables: Map<string, Table>, sql: string, args: unknown[]): { changes: number } {
  const m = /^insert\s+(or\s+ignore\s+)?into\s+(\S+)\s*\(([\s\S]+?)\)\s*values\s*\(([\s\S]+)\)\s*$/i.exec(sql);
  if (!m) throw new Error(`bad insert: ${sql}`);
  const table = must(tables, ident(m[2] ?? ""));
  const cols = splitCommas(m[3] ?? "").map((c) => ident(c));
  const marks = splitCommas(m[4] ?? "").map((v) => v.trim());
  if (marks.some((v) => v !== "?") || marks.length !== args.length || cols.length !== args.length) throw new Error(`insert arity: ${sql}`);
  const row: Row = {};
  cols.forEach((col, i) => { row[col] = norm(args[i]); });
  if (table.pk.length && table.rows.some((have) => table.pk.every((col) => have[col] === row[col]))) {
    if (m[1]) return { changes: 0 };
    throw new Error(`duplicate key in ${ident(m[2] ?? "")}`);
  }
  table.rows.push(row);
  return { changes: 1 };
}

function update(tables: Map<string, Table>, sql: string, args: unknown[]): { changes: number } {
  const m = /^update\s+(\S+)\s+set\s+([\s\S]+?)\s+where\s+([\s\S]+)$/i.exec(sql);
  if (!m) throw new Error(`bad update: ${sql}`);
  const table = must(tables, ident(m[1] ?? ""));
  const cols = splitCommas(m[2] ?? "").map((part) => {
    const eq = /^([\s\S]+?)\s*=\s*\?$/.exec(part.trim());
    if (!eq) throw new Error(`bad set: ${part}`);
    return ident(eq[1] ?? "");
  });
  const where = compileWhere(m[3] ?? "", args.slice(cols.length));
  let changes = 0;
  for (const row of table.rows) {
    if (!where.pred(row)) continue;
    cols.forEach((col, i) => { row[col] = norm(args[i]); });
    changes++;
  }
  return { changes };
}

function remove(tables: Map<string, Table>, sql: string, args: unknown[]): { changes: number } {
  const m = /^delete\s+from\s+(\S+)\s+where\s+([\s\S]+)$/i.exec(sql);
  if (!m) throw new Error(`bad delete: ${sql}`);
  const table = must(tables, ident(m[1] ?? ""));
  const where = compileWhere(m[2] ?? "", args);
  const before = table.rows.length;
  table.rows = table.rows.filter((row) => !where.pred(row));
  return { changes: before - table.rows.length };
}

function select(tables: Map<string, Table>, sql: string, args: unknown[]): Row[] {
  let body = sql.trim();
  let limit: number | null = null;
  let offset = 0;
  const lm = /\s+limit\s+\?(?:\s+offset\s+\?)?\s*$/i.exec(body);
  if (lm) {
    const hasOffset = /offset/i.test(lm[0]);
    const tail = args.slice(args.length - (hasOffset ? 2 : 1));
    limit = Number(tail[0]);
    offset = hasOffset ? Number(tail[1]) : 0;
    args = args.slice(0, args.length - tail.length);
    body = body.slice(0, lm.index);
  }
  let order: { col: string; dir: number }[] = [];
  const om = /\s+order\s+by\s+([\s\S]+)$/i.exec(body);
  if (om) {
    order = splitCommas(om[1] ?? "").map((part) => {
      const p = /^\s*(\S+)(?:\s+(asc|desc))?\s*$/i.exec(part);
      if (!p) throw new Error(`bad order: ${part}`);
      return { col: ident(p[1] ?? ""), dir: (p[2] ?? "asc").toLowerCase() === "desc" ? -1 : 1 };
    });
    body = body.slice(0, om.index);
  }
  const m = /^select\s+([\s\S]+?)\s+from\s+(\S+)(?:\s+where\s+([\s\S]+))?$/i.exec(body.trim());
  if (!m) throw new Error(`bad select: ${sql}`);
  const table = must(tables, ident(m[2] ?? ""));
  const where = m[3] ? compileWhere(m[3], args) : { pred: () => true };
  let rows = table.rows.filter(where.pred);
  if (order.length) {
    rows = [...rows].sort((a, b) => {
      for (const { col, dir } of order) {
        const av = a[col] ?? null;
        const bv = b[col] ?? null;
        if (av === bv) continue;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av < bv ? -dir : dir;
      }
      return 0;
    });
  }
  const list = (m[1] ?? "").trim();
  const count = /^count\(\*\)\s+as\s+(\S+)$/i.exec(list);
  if (count) return [{ [ident(count[1] ?? "n")]: rows.length }];
  if (limit !== null) rows = rows.slice(offset, offset + limit);
  if (list === "*") return rows.map((row) => ({ ...row }));
  const cols = splitCommas(list).map((c) => ident(c));
  return rows.map((row) => {
    const out: Row = {};
    for (const col of cols) out[col] = row[col] ?? null;
    return out;
  });
}

function compileWhere(src: string, args: unknown[]): { pred: (row: Row) => boolean } {
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
    } else if ((m = /^([\s\S]+?)\s+in\s*\(([\s\S]*)\)$/i.exec(t))) {
      const col = ident(m[1] ?? "");
      const n = splitCommas(m[2] ?? "").length;
      const set = args.slice(i, i + n).map(norm);
      i += n;
      preds.push((row) => set.includes(row[col] ?? null));
    } else if ((m = /^([\s\S]+?)\s*=\s*\?$/i.exec(t))) {
      const col = ident(m[1] ?? "");
      const value = norm(args[i++]);
      preds.push((row) => row[col] === value);
    } else throw new Error(`bad where: ${t}`);
  }
  if (i !== args.length) throw new Error(`where arity: ${src}`);
  return { pred: (row) => preds.every((pred) => pred(row)) };
}

function likeToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const c of pattern) {
    if (c === "%") out += "[\\s\\S]*";
    else if (c === "_") out += "[\\s\\S]";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`, "i");
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

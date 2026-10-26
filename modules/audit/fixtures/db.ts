// A small in-memory SQL engine for the audit tests. Modules may not import node:sqlite (B2), so the tests run the real handlers
// against this: it reads the module's own migration for table, column, NOT NULL and primary key rules, and runs the statement
// shapes the module uses (INSERT, SELECT with WHERE / ORDER BY / LIMIT / COUNT(*), UPDATE, DELETE). A statement outside that shape throws, so a handler
// cannot drift into SQL the tests never ran. The host's own table guard (host/src/ctx/db.ts) wraps it, so a table outside audit_* is refused as in production.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import type { AuditCtx, AuditSeams } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_test";
export const MIGRATION = fileURLToPath(new URL("../migrations/0001_audit.sql", import.meta.url));

type Cell = string | number | null;
export type Row = Record<string, Cell>;

interface Col { name: string; notNull: boolean }
interface Table { name: string; cols: Col[]; pk: string[]; auto: string | null; rows: Row[]; nextId: number }

function stripComments(sql: string): string {
  return sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}

/** Split on commas that are not inside parentheses. */
function topLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const c of body) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function parseMigration(sql: string): Map<string, Table> {
  const tables = new Map<string, Table>();
  const text = stripComments(sql).replace(/"/g, "");
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1, i = re.lastIndex;
    while (i < text.length && depth > 0) { if (text[i] === "(") depth++; else if (text[i] === ")") depth--; i++; }
    const body = text.slice(re.lastIndex, i - 1);
    const t: Table = { name: m[1]!, cols: [], pk: [], auto: null, rows: [], nextId: 1 };
    for (const part of topLevel(body)) {
      const tablePk = /^PRIMARY KEY\s*\(([^)]*)\)$/i.exec(part);
      if (tablePk) { t.pk = tablePk[1]!.split(",").map((c) => c.trim()); continue; }
      const name = /^(\w+)/.exec(part)![1]!;
      const isPk = /PRIMARY KEY/i.test(part);
      t.cols.push({ name, notNull: /NOT NULL/i.test(part) || isPk });
      if (isPk) { t.pk = [name]; if (/INTEGER\s+PRIMARY KEY/i.test(part)) t.auto = name; }
    }
    tables.set(t.name, t);
  }
  return tables;
}

/** Order two non-null cells: numbers numerically, anything else as text. */
function cmp(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a), y = String(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

// ---- tokens and a recursive-descent parser over one statement

type Tok = { k: "id" | "num" | "str" | "q" | "p"; v: string };

function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(<=|>=|<>|!=)|([(),=<>*])|(\?)|('(?:[^']|'')*')|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*))/y;
  let pos = 0;
  while (pos < sql.length) {
    if (/^\s*$/.test(sql.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(sql);
    if (!m) throw new Error(`cannot read SQL near: ${sql.slice(pos, pos + 20)}`);
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ k: "p", v: m[1] });
    else if (m[2] !== undefined) out.push({ k: "p", v: m[2] });
    else if (m[3] !== undefined) out.push({ k: "q", v: "?" });
    else if (m[4] !== undefined) out.push({ k: "str", v: m[4].slice(1, -1).replace(/''/g, "'") });
    else if (m[5] !== undefined) out.push({ k: "num", v: m[5] });
    else out.push({ k: "id", v: m[6]! });
  }
  return out;
}

class Parser {
  private i = 0;
  private bound = 0;
  private toks: Tok[];
  private args: unknown[];
  constructor(toks: Tok[], args: unknown[]) { this.toks = toks; this.args = args; }

  done(): boolean { return this.i >= this.toks.length; }
  peekWord(): string { const t = this.toks[this.i]; return t && t.k === "id" ? t.v.toUpperCase() : ""; }
  peekP(): string { const t = this.toks[this.i]; return t && t.k === "p" ? t.v : ""; }
  word(w: string): boolean { if (this.peekWord() === w) { this.i++; return true; } return false; }
  need(w: string): void { if (!this.word(w)) throw new Error(`expected ${w}`); }
  p(v: string): boolean { if (this.peekP() === v) { this.i++; return true; } return false; }
  needP(v: string): void { if (!this.p(v)) throw new Error(`expected ${v}`); }
  ident(): string { const t = this.toks[this.i++]; if (!t || t.k !== "id") throw new Error("expected a name"); return t.v; }
  unused(): number { return this.args.length - this.bound; }

  /** A value: a bound parameter, a number or a quoted string. */
  value(): Cell {
    const t = this.toks[this.i++];
    if (!t) throw new Error("expected a value");
    if (t.k === "q") {
      if (this.bound >= this.args.length) throw new Error("statement has more ? than arguments");
      const v = this.args[this.bound++];
      if (v === undefined || v === null) return null;
      if (typeof v === "string" || typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      throw new Error("unsupported argument type");
    }
    if (t.k === "num") return Number(t.v);
    if (t.k === "str") return t.v;
    if (t.k === "id" && t.v.toUpperCase() === "NULL") return null;
    throw new Error(`expected a value, got ${t.v}`);
  }

  where(): (row: Row) => boolean { return this.orExpr(); }

  private orExpr(): (row: Row) => boolean {
    const parts = [this.andExpr()];
    while (this.word("OR")) parts.push(this.andExpr());
    return (row) => parts.some((f) => f(row));
  }
  private andExpr(): (row: Row) => boolean {
    const parts = [this.atom()];
    while (this.word("AND")) parts.push(this.atom());
    return (row) => parts.every((f) => f(row));
  }
  private atom(): (row: Row) => boolean {
    if (this.p("(")) { const f = this.orExpr(); this.needP(")"); return f; }
    const col = this.ident();
    if (this.word("IS")) {
      const not = this.word("NOT");
      this.need("NULL");
      return (row) => (row[col] === null || row[col] === undefined) !== not;
    }
    const op = this.toks[this.i++];
    if (!op || op.k !== "p") throw new Error(`expected an operator after ${col}`);
    const v = this.value();
    return (row) => {
      const a = row[col];
      if (a === null || a === undefined || v === null) return false;
      switch (op.v) {
        case "=": return a === v;
        case "!=": case "<>": return a !== v;
        case "<": return cmp(a, v) < 0;
        case "<=": return cmp(a, v) <= 0;
        case ">": return cmp(a, v) > 0;
        case ">=": return cmp(a, v) >= 0;
        default: throw new Error(`unsupported operator ${op.v}`);
      }
    };
  }
}

export class FakeAuditDb implements RawDb {
  readonly tables: Map<string, Table>;
  /** every statement that ran, for tests that look at what the module sent */
  readonly log: string[] = [];

  constructor(migrationPath: string = MIGRATION) {
    this.tables = parseMigration(readFileSync(migrationPath, "utf8"));
  }

  rows(table: string): Row[] { return this.table(table).rows.map((r) => ({ ...r })); }

  private table(name: string): Table {
    const t = this.tables.get(name);
    if (!t) throw new Error(`no such table: ${name}`);
    return t;
  }

  all(sql: string, ...args: unknown[]): unknown[] {
    this.log.push(sql);
    const p = new Parser(tokenize(sql), args);
    p.need("SELECT");
    let count = false;
    let countAs = "n";
    let cols: string[] | null = null;
    if (p.p("*")) cols = null;
    else if (p.word("COUNT")) { p.needP("("); p.needP("*"); p.needP(")"); p.need("AS"); countAs = p.ident(); count = true; }
    else { cols = [p.ident()]; while (p.p(",")) cols.push(p.ident()); }
    p.need("FROM");
    const t = this.table(p.ident());
    const pred = p.word("WHERE") ? p.where() : () => true;
    const order: { col: string; desc: boolean }[] = [];
    if (p.word("ORDER")) {
      p.need("BY");
      do {
        const col = p.ident();
        const desc = p.word("DESC");
        if (!desc) p.word("ASC");
        order.push({ col, desc });
      } while (p.p(","));
    }
    let limit: number | null = null, offset = 0;
    if (p.word("LIMIT")) limit = Number(p.value());
    if (p.word("OFFSET")) offset = Number(p.value());
    if (!p.done()) throw new Error("unsupported SELECT shape");
    if (p.unused() !== 0) throw new Error("more arguments than ? in statement");
    for (const c of cols ?? []) if (!t.cols.some((x) => x.name === c)) throw new Error(`no such column: ${c}`);
    let rows = t.rows.filter(pred);
    if (count) return [{ [countAs]: rows.length }];
    rows = rows.slice();
    for (let k = order.length - 1; k >= 0; k--) {
      const { col, desc } = order[k]!;
      rows.sort((a, b) => {
        const x = a[col] ?? null, y = b[col] ?? null;
        if (x === y) return 0;
        if (x === null) return desc ? 1 : -1;
        if (y === null) return desc ? -1 : 1;
        return cmp(x, y) * (desc ? -1 : 1);
      });
    }
    rows = rows.slice(offset, limit === null ? undefined : offset + limit);
    return rows.map((r) => {
      if (!cols) return { ...r };
      const o: Row = {};
      for (const c of cols) o[c] = r[c] ?? null;
      return o;
    });
  }

  run(sql: string, ...args: unknown[]): { changes: number } {
    this.log.push(sql);
    const p = new Parser(tokenize(sql), args);
    if (p.word("INSERT")) return this.insert(p);
    if (p.word("DELETE")) {
      p.need("FROM");
      const t = this.table(p.ident());
      const pred = p.word("WHERE") ? p.where() : () => true;
      if (!p.done() || p.unused() !== 0) throw new Error("unsupported DELETE shape");
      const keep = t.rows.filter((r) => !pred(r));
      const changes = t.rows.length - keep.length;
      t.rows = keep;
      return { changes };
    }
    if (p.word("UPDATE")) {
      const t = this.table(p.ident());
      p.need("SET");
      const sets: { col: string; v: Cell }[] = [];
      do {
        const col = p.ident();
        p.needP("=");
        sets.push({ col, v: p.value() });
      } while (p.p(","));
      const pred = p.word("WHERE") ? p.where() : () => true;
      if (!p.done() || p.unused() !== 0) throw new Error("unsupported UPDATE shape");
      let changes = 0;
      for (const r of t.rows) {
        if (!pred(r)) continue;
        for (const s of sets) {
          const c = t.cols.find((x) => x.name === s.col);
          if (!c) throw new Error(`no such column: ${s.col}`);
          if (c.notNull && s.v === null) throw new Error(`NOT NULL constraint failed: ${t.name}.${s.col}`);
          r[s.col] = s.v;
        }
        changes++;
      }
      return { changes };
    }
    throw new Error("unsupported statement");
  }

  private insert(p: Parser): { changes: number } {
    let replace = false;
    if (p.word("OR")) { p.need("REPLACE"); replace = true; }
    p.need("INTO");
    const t = this.table(p.ident());
    p.needP("(");
    const names = [p.ident()];
    while (p.p(",")) names.push(p.ident());
    p.needP(")");
    p.need("VALUES");
    p.needP("(");
    const vals = [p.value()];
    while (p.p(",")) vals.push(p.value());
    p.needP(")");
    if (!p.done() || p.unused() !== 0) throw new Error("unsupported INSERT shape");
    if (names.length !== vals.length) throw new Error("column and value counts differ");
    const row: Row = {};
    for (const c of t.cols) row[c.name] = null;
    names.forEach((n, i) => {
      if (!t.cols.some((c) => c.name === n)) throw new Error(`no such column: ${n}`);
      row[n] = vals[i]!;
    });
    let fresh = false;
    if (t.auto) {
      fresh = row[t.auto] === null;
      if (fresh) row[t.auto] = t.nextId;
      t.nextId = Math.max(t.nextId, Number(row[t.auto]) + 1);
    }
    for (const c of t.cols) if (c.notNull && row[c.name] === null) throw new Error(`NOT NULL constraint failed: ${t.name}.${c.name}`);
    const same = (r: Row): boolean => t.pk.length > 0 && t.pk.every((k) => r[k] === row[k]);
    const at = fresh ? -1 : t.rows.findIndex(same);
    if (at >= 0) {
      if (!replace) throw new Error(`UNIQUE constraint failed: ${t.name}`);
      t.rows[at] = row;
    } else t.rows.push(row);
    return { changes: 1 };
  }
}


export interface Event { name: string; subject: string; payload: unknown }
export interface Harness {
  raw: FakeAuditDb;
  events: Event[];
  /** The ctx of a call by `id` (a person unless `kind`), with the host seams given. */
  as(id: string, seams?: AuditSeams, kind?: "person" | "agent" | "service"): AuditCtx;
  advance(ms: number): void;
  now(): number;
}

export function harness(now = NOW): Harness {
  const raw = new FakeAuditDb();
  const db = scopedDb("audit", raw, TRACE);
  const events: Event[] = [];
  let clock = now;
  const base = {
    space: SPACE,
    trace: { traceId: TRACE, spanId: "abcdef0123456789" },
    depth: 1,   // a call another capability made: the system halves refuse a direct call (P-SEC_10)
    now: () => clock,
    db,
    emit(name: string, subject: string, payload: unknown) { events.push({ name, subject, payload }); return {} as never; },
  };
  return {
    raw, events,
    as: (id, seams = {}, kind = "person") => ({ ...base, principal: { kind, id }, ...seams }) as AuditCtx,
    advance(ms) { clock += ms; },
    now: () => clock,
  };
}

export function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object" || !("error" in e)) return undefined;
  return (e as { error?: { code?: string } }).error?.code;
}

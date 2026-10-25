// ctx.db: a module's window onto the database (ARCH B2). Every table a statement touches must be named `<module>_...`; anything else is refused before it reaches SQLite.
// This is a guard on the SQL text, not a parser: it strips strings and comments, allows one statement of a short list of kinds, and checks each FROM / JOIN / INTO / UPDATE / TABLE / INDEX ... ON target.
import { fail } from "../routes/errors.ts";

export interface RawDb { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }

const KINDS = new Set(["select", "insert", "update", "delete", "with", "replace", "create", "drop", "alter"]);
const BANNED = /\b(attach|detach|pragma|vacuum|load_extension|readfile|writefile|sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_sequence)\b/i;
const FUNCS = new Set(["json_each", "json_tree"]);
const STOP = new Set(["where", "group", "order", "limit", "having", "union", "intersect", "except", "on", "using", "window", "returning", "set", "values", "select", "natural", "left", "right", "inner", "outer", "cross", "full", "join", "offset"]);

/** Remove comments and the contents of string literals so keywords inside them are not read as SQL. */
export function strip(sql: string): string {
  let out = "", i = 0;
  while (i < sql.length) {
    const c = sql[i]!, n = sql[i + 1];
    if (c === "-" && n === "-") { while (i < sql.length && sql[i] !== "\n") i++; out += " "; continue; }
    if (c === "/" && n === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? sql.length : e + 2; out += " "; continue; }
    if (c === "'") { i++; while (i < sql.length) { if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } break; } i++; } i++; out += "''"; continue; }
    out += c; i++;
  }
  return out;
}

type Tok = { t: "id"; v: string; quoted: boolean } | { t: "p"; v: string };
function tokens(sql: string): Tok[] {
  const out: Tok[] = [];
  const re = /"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|([A-Za-z_][A-Za-z0-9_$]*)|(\.)|([(),;])|(\S)/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    if (m[1] !== undefined) out.push({ t: "id", v: m[1].replace(/""/g, '"'), quoted: true });
    else if (m[2] !== undefined) out.push({ t: "id", v: m[2], quoted: true });
    else if (m[3] !== undefined) out.push({ t: "id", v: m[3], quoted: true });
    else if (m[4] !== undefined) out.push({ t: "id", v: m[4], quoted: false });
    else out.push({ t: "p", v: (m[5] ?? m[6] ?? m[7])! });
  }
  return out;
}

/** The tables a statement reads or writes, or an error string. Pure, so it is testable without a database. */
/** Modules whose tables carry a shorter name than the module id (their migrations created them before the prefix rule); the module id's own prefix always applies too. */
const PREFIX_ALIASES: Readonly<Record<string, readonly string[]>> = { "contacts-link": ["contacts_"], microsoft: ["ms_"] };

export function checkSql(moduleId: string, sql: string): { ok: true; tables: string[] } | { ok: false; why: string } {
  const prefix = `${moduleId.replace(/-/g, "_")}_`;
  const prefixes = [prefix, ...(PREFIX_ALIASES[moduleId] ?? [])];
  const owned = (name: string): boolean => prefixes.some((p) => name.toLowerCase().startsWith(p));
  const s = strip(sql);
  if (BANNED.test(s)) return { ok: false, why: "that statement is not allowed" };
  const toks = tokens(s);
  const semi = toks.findIndex((t) => t.t === "p" && t.v === ";");
  if (semi >= 0 && toks.slice(semi + 1).length > 0) return { ok: false, why: "one statement at a time" };
  const body = semi >= 0 ? toks.slice(0, semi) : toks;
  const first = body[0];
  if (!first || first.t !== "id" || first.quoted || !KINDS.has(first.v.toLowerCase())) return { ok: false, why: "that kind of statement is not allowed" };
  const low = (t: Tok | undefined): string => (t && t.t === "id" && !t.quoted ? t.v.toLowerCase() : "");
  // CTE names defined by this statement are not tables
  const ctes = new Set<string>();
  if (low(first) === "with") {
    for (let i = 1; i < body.length; i++) {
      const t = body[i]!;
      const prev = body[i - 1]!;
      const startsCte = (prev.t === "p" && prev.v === ",") || low(prev) === "with" || low(prev) === "recursive";
      if (t.t === "id" && startsCte) {
        let j = i + 1;
        if (body[j]?.t === "p" && body[j]!.v === "(") { while (j < body.length && !(body[j]!.t === "p" && body[j]!.v === ")")) j++; j++; }
        if (low(body[j]) === "as") ctes.add(t.v.toLowerCase());
      }
    }
  }
  const tables: string[] = [];
  const target = (j: number): number => {
    const t = body[j];
    if (!t || t.t !== "id") return j;                       // a subselect: its own FROM is scanned on its own
    if (body[j + 1]?.t === "p" && body[j + 1]!.v === ".") return -1;   // schema.table
    if (body[j + 1]?.t === "p" && body[j + 1]!.v === "(" && FUNCS.has(t.v.toLowerCase())) return j + 1;
    const name = t.v;
    if (!ctes.has(name.toLowerCase())) tables.push(name);
    return j + 1;
  };
  for (let i = 0; i < body.length; i++) {
    const w = low(body[i]);
    let j = -2;
    if (w === "from" || w === "join" || w === "into" || w === "update") j = i + 1;
    else if (w === "table" || w === "view" || w === "trigger") { j = i + 1; while (["if", "not", "exists"].includes(low(body[j]))) j++; }
    else if (w === "index") { // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table; DROP INDEX name
      j = i + 1; while (["if", "not", "exists"].includes(low(body[j]))) j++;
      const k = body.findIndex((t, x) => x > j && low(t) === "on");
      if (k > 0) { const r = target(k + 1); if (r < 0) return { ok: false, why: "schema-qualified names are not allowed" }; }
      const idx = body[j]; if (idx?.t === "id" && !owned(idx.v)) return { ok: false, why: `index ${idx.v} is not in ${prefix}*` };
      continue;
    }
    else if (w === "to" && low(body[i - 1]) === "rename") j = i + 1;   // ALTER TABLE a RENAME TO b: b must stay in the module too
    if (w === "update" && low(body[i - 1]) === "do") { j = -2; }
    if (j < 0) continue;
    let k = target(j);
    if (k < 0) return { ok: false, why: "schema-qualified names are not allowed" };
    if (w === "from") {            // FROM a [AS] x, b [AS] y
      for (;;) {
        let m = k;
        if (low(body[m]) === "as") m += 2; else if (body[m]?.t === "id" && !STOP.has(low(body[m]))) m += 1;
        if (body[m]?.t === "p" && body[m]!.v === ",") { const r = target(m + 1); if (r < 0) return { ok: false, why: "schema-qualified names are not allowed" }; k = r; continue; }
        break;
      }
    }
  }
  for (const t of tables) if (!owned(t)) return { ok: false, why: `table ${t} is not in ${prefix}*` };
  return { ok: true, tables };
}

/** A db handle limited to one module's tables. */
export function scopedDb(moduleId: string, raw: RawDb, traceId: string): RawDb {
  const guard = (sql: string): void => {
    const r = checkSql(moduleId, sql);
    if (!r.ok) throw fail("permission.no_grant", traceId, { message: "A module may only use its own tables.", details: { module: moduleId, why: r.why } });
  };
  return {
    all(sql, ...args) { guard(sql); return raw.all(sql, ...args); },
    run(sql, ...args) { guard(sql); return raw.run(sql, ...args); },
  };
}

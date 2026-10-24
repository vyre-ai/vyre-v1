// scopeFor: the same rules as authorize (roles, grants with flow-down, owner, clearance, holds) compiled to a predicate over an entity table, for lists, search and sync (ARCH 4.5 "Scope compilation").
// Record-level and folder flow-down grants come from the acl_index (here built from the snapshot; the kernel keeps the real table as an inline projection); type-wide grants become row filters over columns.
// Policies (provider label, spend, Gate) are not part of a scope: they act per call. Time windows and expiry are evaluated at `now`, so a scope is valid for the instant it was compiled.
import { evalExpr, safeIdent } from "./expr.ts";
import type { AccessSnapshot, GrantRec, SubjectInfo } from "./snapshot.ts";
import { LEVEL_BY_RANK, rankOf } from "./types.ts";
import type { Expr, Level } from "./types.ts";

export type Pred =
  | { t: "true" } | { t: "false" }
  | { t: "and" | "or"; a: Pred[] }
  | { t: "expr"; e: Expr; me: string }
  | { t: "acl"; person: string; entityType: string; rank: number; ids: ReadonlySet<string> }
  | { t: "owner"; me: string }
  | { t: "label_le"; n: number }
  | { t: "no_hold" };

const TRUE: Pred = { t: "true" }, FALSE: Pred = { t: "false" };

export function and(a: Pred[]): Pred {
  const out: Pred[] = [];
  for (const p of a) { if (p.t === "false") return FALSE; if (p.t === "true") continue; if (p.t === "and") out.push(...p.a); else out.push(p); }
  return out.length === 0 ? TRUE : out.length === 1 ? out[0]! : { t: "and", a: out };
}
export function or(a: Pred[]): Pred {
  const out: Pred[] = [];
  for (const p of a) { if (p.t === "true") return TRUE; if (p.t === "false") continue; if (p.t === "or") out.push(...p.a); else out.push(p); }
  return out.length === 0 ? FALSE : out.length === 1 ? out[0]! : { t: "or", a: out };
}

export interface ScopeForReq {
  principal: string;
  actingFor?: string | undefined;
  entityType: string;
  level: Level;
  perm?: string | null | undefined;
  destructive?: boolean | undefined;
  now: number;
}
export interface ScopeResult {
  /** false predicate when the principal can see nothing */
  predicate: Pred;
  /** the lowest level any subject holds over what the predicate keeps is at least `level`; this is the requested level */
  level: Level;
  hiddenFields: readonly string[];
  labelCeiling: number;
  /** why it is empty, when it is (first failing subject) */
  emptyBecause?: string | undefined;
}

const live = (g: GrantRec, now: number): boolean => g.exp > now && now >= g.nb && now <= g.na;

/** acl_index, in memory: ids of `entityType` records a subject reaches through a record-level grant or a grant on an ancestor, at `rank` or above. */
export function aclIds(snap: AccessSnapshot, info: SubjectInfo, entityType: string, rank: number, now: number): Set<string> {
  const out = new Set<string>();
  for (const r of snap.allResources()) {
    if (r.type !== entityType) continue;
    const chain = snap.chain(r.id);
    if (!chain) continue;
    let ok = false;
    for (const anc of chain) {
      for (const g of snap.grantsOn(anc.id) ?? []) {
        if (!info.keys.has(g.key) || g.rank < rank || !live(g, now)) continue;
        if (g.filter) {
          const row = snap.rowSource?.(r.id);
          if (!row || !evalExpr(g.filter, row, r.owner_id, info.p.id)) continue;
        }
        ok = true; break;
      }
      if (ok) break;
    }
    if (ok) out.add(r.id);
  }
  return out;
}

function subjectPred(snap: AccessSnapshot, s: SubjectInfo, q: ScopeForReq): Pred {
  if (s.p.status !== "active") return FALSE;
  if (q.perm && !s.perms.has(q.perm)) return FALSE;
  const rank = rankOf(q.level);
  const parts: Pred[] = [];
  for (const g of snap.typeWide(q.entityType) ?? []) {
    if (!s.keys.has(g.key) || g.rank < rank || !live(g, q.now)) continue;
    parts.push(g.filter ? { t: "expr", e: g.filter, me: s.p.id } : TRUE);
  }
  const ids = aclIds(snap, s, q.entityType, rank, q.now);
  if (ids.size) parts.push({ t: "acl", person: s.p.id, entityType: q.entityType, rank, ids });
  parts.push({ t: "owner", me: s.p.id });
  return and([or(parts), { t: "label_le", n: s.clearance }, ...(q.destructive ? [{ t: "no_hold" } as Pred] : [])]);
}

/** The predicate for "every row of entityType this principal (acting for someone) may touch at this level". */
export function scopeFor(snap: AccessSnapshot, q: ScopeForReq): ScopeResult {
  const empty = (why: string): ScopeResult => ({ predicate: FALSE, level: q.level, hiddenFields: [], labelCeiling: -1, emptyBecause: why });
  const me = snap.info(q.principal);
  if (!me) return empty("not_a_member");
  const subjects: SubjectInfo[] = [me];
  if (me.p.kind === "agent") {
    const a = q.actingFor && q.actingFor !== q.principal ? snap.info(q.actingFor) : null;
    if (!a || a.p.kind !== "person") return empty("agent_needs_actor");
    subjects.push(a);
  } else {
    if (me.p.kind === "svc") { const o = me.p.owner ? snap.info(me.p.owner) : null; if (!o) return empty("not_a_member"); subjects.push(o); }
    if (q.actingFor && q.actingFor !== q.principal) { const a = snap.info(q.actingFor); if (!a) return empty("not_a_member"); if (!subjects.includes(a)) subjects.push(a); }
  }
  const preds = subjects.map((s) => subjectPred(snap, s, q));
  const hidden = new Set<string>();
  for (const g of snap.typeWide(q.entityType) ?? []) for (const f of g.hidden) hidden.add(f);
  return { predicate: and(preds), level: q.level, hiddenFields: [...hidden], labelCeiling: Math.min(...subjects.map((s) => s.clearance)) };
}

export const levelName = (rank: number): Level => LEVEL_BY_RANK[rank] ?? "view";

/** Evaluate a predicate on one row (id, owner_id, label, holds and the filter fields). The reference the SQL must match. */
export function evalPred(p: Pred, row: Readonly<Record<string, unknown>>): boolean {
  switch (p.t) {
    case "true": return true;
    case "false": return false;
    case "and": return p.a.every((x) => evalPred(x, row));
    case "or": return p.a.some((x) => evalPred(x, row));
    case "expr": return evalExpr(p.e, row, (row["owner_id"] as string | null | undefined) ?? null, p.me);
    case "acl": return p.ids.has(row["id"] as string);
    case "owner": return row["owner_id"] === p.me;
    case "label_le": return (row["label"] as number) <= p.n;
    case "no_hold": return (row["holds"] as number) === 0;
  }
}

export interface Sql { sql: string; params: (string | number | null)[] }
const q = (c: string): string => `"${safeIdent(c)}"`;

function exprSql(e: Expr, me: string, params: Sql["params"], t: string): string {
  switch (e.op) {
    case "owner_me": params.push(me); return `${t}"owner_id" = ?`;
    case "in":
      if (e.values.length === 0) return "0";
      for (const v of e.values) params.push(v);
      return `${t}${q(e.field)} IN (${e.values.map(() => "?").join(", ")})`;
    case "and": return e.args.length ? `(${e.args.map((a) => exprSql(a, me, params, t)).join(" AND ")})` : "1";
    case "or": return e.args.length ? `(${e.args.map((a) => exprSql(a, me, params, t)).join(" OR ")})` : "0";
    default: {
      if (e.value === null) return `${t}${q(e.field)} IS ${e.op === "eq" ? "" : "NOT "}NULL`;
      const op = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" }[e.op];
      params.push(typeof e.value === "boolean" ? (e.value ? 1 : 0) : e.value);
      return `${t}${q(e.field)} ${op} ?`;
    }
  }
}

/** Compile a predicate to a WHERE fragment over the entity table (columns id, owner_id, label, holds and the filter fields) using `acl_index(person, entity_type, entity_id, level_rank)`. */
export function toSql(p: Pred, opts: { table?: string } = {}): Sql {
  const t = opts.table ? `${q(opts.table)}.` : "";
  const params: Sql["params"] = [];
  const go = (x: Pred): string => {
    switch (x.t) {
      case "true": return "1";
      case "false": return "0";
      case "and": return `(${x.a.map(go).join(" AND ")})`;
      case "or": return `(${x.a.map(go).join(" OR ")})`;
      case "expr": return exprSql(x.e, x.me, params, t);
      case "acl": params.push(x.person, x.entityType, x.rank); return `${t}"id" IN (SELECT entity_id FROM acl_index WHERE person = ? AND entity_type = ? AND level_rank >= ?)`;
      case "owner": params.push(x.me); return `${t}"owner_id" = ?`;
      case "label_le": params.push(x.n); return `${t}"label" <= ?`;
      case "no_hold": return `${t}"holds" = 0`;
    }
  };
  return { sql: go(p), params };
}

/** The acl_index rows the kernel would hold for these subjects (test and rebuild helper). */
export function aclRows(p: Pred, entityType: string): { person: string; entity_type: string; entity_id: string; level_rank: number }[] {
  const out: { person: string; entity_type: string; entity_id: string; level_rank: number }[] = [];
  const walk = (x: Pred): void => {
    if (x.t === "and" || x.t === "or") x.a.forEach(walk);
    else if (x.t === "acl") for (const id of x.ids) out.push({ person: x.person, entity_type: entityType, entity_id: id, level_rank: x.rank });
  };
  walk(p);
  return out;
}

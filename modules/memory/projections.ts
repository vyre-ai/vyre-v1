// @reads /modules/memory/migrations/0001_init.sql
// Durable rows and shared helpers of the memory module (spec 2.15, 4.15; ARCH 6.10): the context type the handlers use, the schema bootstrap, fact rows and their
// contract shape, the sealing of person-layer text, layer access, and the local ranking (BM25 over words, trigram similarity, recency) that search and the pointer block share.
// Every statement names a memory_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { Sealed } from "../../packages/contracts/src/ctx.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

/** What the module needs of ctx.db (the host's ScopedDb has this shape). */
export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export type Layer = "person" | "agent" | "project" | "space";
export type FactStatus = "proposed" | "current" | "closed" | "removed";
export type SourceKind = "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
export type Level = "view" | "use" | "edit" | "manage";

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface MemCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: Level }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  seal: { seal(v: Uint8Array, scope: string): Sealed; unseal(s: Sealed): Uint8Array };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

/** Throw the catalogue error for this call. */
export function raise(ctx: Pick<MemCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Who did it: the person an agent acts for, else the caller. */
export const actorOf = (ctx: Pick<MemCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- schema

const SCHEMA = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);

const ready = new WeakSet<object>();

/** Make sure the memory tables exist. One cheap probe per handle; the CREATE ... IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try {
    db.all("SELECT agent_id FROM memory_maps WHERE agent_id = ?", "probe");
  } catch {
    for (const stmt of SCHEMA) db.run(stmt);
  }
  ready.add(db);
}

export type Row = Record<string, unknown>;
export const rowsOf = (db: Db, sql: string, ...args: unknown[]): Row[] => db.all(sql, ...args) as Row[];
export const str = (v: unknown): string => String(v ?? "");
export const num = (v: unknown): number => Number(v ?? 0);
export const orNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Contract ids are `<prefix>_<lowercase alphanumerics>`. */
export const mintId = (prefix: string, now: number = Date.now()): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

// ---- sealing of person-layer text (enc = 2)

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Each person has their own seal scope, so one person's memory never opens under another's key. */
export const sealScope = (owner: string): string => `mem.${owner}`.toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 64);
export const sealText = (ctx: Pick<MemCtx, "seal">, owner: string, text: string): string => JSON.stringify(ctx.seal.seal(enc.encode(text), sealScope(owner)));
export const openText = (ctx: Pick<MemCtx, "seal">, sealed: string): string => dec.decode(ctx.seal.unseal(JSON.parse(sealed) as Sealed));

// ---- facts

export interface Fact {
  id: string;
  layer: Layer;
  ownerRef: string;
  agentId: string | null;
  projectId: string | null;
  noteId: string | null;
  kind: string | null;
  /** Plain text. Empty for a sealed row the caller does not own. */
  text: string;
  enc: number;
  validFrom: number;
  validTo: number | null;
  learnedAt: number;
  closedAt: number | null;
  sourceKind: SourceKind;
  sourceRef: string;
  sourceLink: string | null;
  sourcePerson: string;
  proposedBy: string;
  status: FactStatus;
  lowRisk: boolean;
  subject: string | null;
  replaces: string | null;
  promotedFrom: string | null;
}

/** Row to Fact. A person-layer row opens only for its owner; for anyone else its text stays empty and callers drop it before it reaches an answer. */
export function readFact(ctx: Pick<MemCtx, "seal" | "principal" | "actingFor">, r: Row): Fact {
  const layer = str(r["layer"]) as Layer;
  const owner = str(r["owner_ref"]);
  const sealed = orNull(r["sealed"]);
  let text = str(r["text"]);
  if (num(r["enc"]) === 2 && sealed !== null) {
    if (owner === actorOf(ctx)) {
      try { text = openText(ctx, sealed); } catch { text = ""; }
    } else text = "";
  }
  return {
    id: str(r["id"]), layer, ownerRef: owner, agentId: orNull(r["agent_id"]), projectId: orNull(r["project_id"]), noteId: orNull(r["note_id"]), kind: orNull(r["kind"]), text,
    enc: num(r["enc"]), validFrom: num(r["valid_from"]), validTo: numOrNull(r["valid_to"]), learnedAt: num(r["learned_at"]), closedAt: numOrNull(r["closed_at"]),
    sourceKind: str(r["source_kind"]) as SourceKind, sourceRef: str(r["source_ref"]), sourceLink: orNull(r["source_link"]), sourcePerson: str(r["source_person"]),
    proposedBy: str(r["proposed_by"]), status: str(r["status"]) as FactStatus, lowRisk: num(r["low_risk"]) === 1, subject: orNull(r["subject"]), replaces: orNull(r["replaces"]),
    promotedFrom: orNull(r["promoted_from"]),
  };
}

/** The contract's fact row. */
export function factOut(f: Fact) {
  return {
    factId: f.id, layer: f.layer, ownerRef: f.ownerRef, ...(f.agentId ? { agentId: f.agentId } : {}), ...(f.noteId ? { noteId: f.noteId } : {}), text: f.text,
    validFrom: f.validFrom, ...(f.validTo !== null ? { validTo: f.validTo } : {}), learnedAt: f.learnedAt, ...(f.closedAt !== null ? { closedAt: f.closedAt } : {}),
    sourceKind: f.sourceKind, sourceRef: f.sourceRef, ...(f.sourceLink ? { sourceLink: f.sourceLink } : {}), status: f.status, lowRisk: f.lowRisk,
  };
}

export function loadFact(ctx: MemCtx, id: string): Fact | null {
  const r = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE id = ?", id)[0];
  return r ? readFact(ctx, r) : null;
}

/** True now: current and not past its end date. */
export const liveNow = (f: Pick<Fact, "status" | "validTo">, now: number): boolean => f.status === "current" && (f.validTo === null || f.validTo > now);

/** The link to the exact chat, task or record a fact came from. */
export function sourceLinkOf(kind: SourceKind, ref: string): string | null {
  switch (kind) {
    case "chat": case "channel": return `/chats/${ref}`;
    case "task": return `/tasks/${ref}`;
    case "record": return `/records/${ref}`;
    case "run": return `/runs/${ref}`;
    case "journey": return `/journeys/${ref}`;
    default: return null;
  }
}

/** The owner reference of a layer: the person, the agent, the project or the Space. */
export function ownerOfLayer(ctx: MemCtx, layer: Layer, actor: string, agentId: string | null, projectId: string | null): string {
  if (layer === "person") return actor;
  if (layer === "agent") return agentId ?? "";
  if (layer === "project") return projectId ?? "";
  return ctx.space;
}

// ---- access

type Resource = { type: string; id: string | null };

export interface Access {
  /** May the caller see (view) or change (edit) this layer of this agent or project? A person layer belongs to its owner alone. */
  can(layer: Layer, ownerRef: string, agentId: string | null, projectId: string | null, level: "view" | "edit"): Promise<boolean>;
  /** May the caller administer memory (memory.admin at manage)? */
  isAdmin(): boolean;
}

/**
 * Layer access is decided by authorize on the layer's folder resource (the agent's folder, the project's folder, the Space), memoised per call.
 * DECISION: the agent's memory folder sits inside the agent folder and folder grants flow down, so authorize runs on the agent folder.
 */
export function makeAccess(ctx: MemCtx): Access {
  const me = actorOf(ctx);
  const folders = new Map<string, Promise<string | null>>();
  const memo = new Map<string, boolean>();
  const folderOf = (kind: "agent" | "project", id: string): Promise<string | null> => {
    const key = `${kind}:${id}`;
    let p = folders.get(key);
    if (!p) {
      p = (async (): Promise<string | null> => {
        try {
          if (kind === "agent") return str(((await ctx.call("agents.get", { agentId: id })) as { agent?: { folderId?: string } }).agent?.folderId) || null;
          return str(((await ctx.call("projects.get", { projectId: id })) as { project?: { folderId?: string } }).project?.folderId) || null;
        } catch { return null; }
      })();
      folders.set(key, p);
    }
    return p;
  };
  /** the asker owns the agent, or the folder's own shares (not what it inherits from the Space) give them Edit or Manage */
  const ownsOrShared = async (agentId: string, folder: string): Promise<boolean> => {
    try {
      const owner = str(((await ctx.call("agents.get", { agentId })) as { agent?: { ownerId?: string } }).agent?.ownerId);
      if (owner !== "" && owner === me) return true;
      const got = (await ctx.call("access.shares_of", { resource: { type: "folder", id: folder } })) as { shares?: { grant?: { subject?: { kind?: string; id?: string }; level?: string }; through?: string }[] };
      return (got.shares ?? []).some((r) => (r.through === "owner" || r.through === "direct") && r.grant?.subject?.kind === "person" && r.grant.subject.id === me && (r.grant.level === "edit" || r.grant.level === "manage"));
    } catch { return false; }
  };
  const allow = (level: "view" | "edit", res: Resource): boolean => ctx.authorize({ perm: null, level }, res).effect === "allow";
  return {
    async can(layer, ownerRef, agentId, projectId, level) {
      if (layer === "person") return ownerRef === me;
      const key = `${layer}:${ownerRef}:${agentId ?? ""}:${projectId ?? ""}:${level}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      let ok = false;
      if (layer === "space") ok = allow(level, { type: "space", id: ctx.space });
      else {
        const target = layer === "agent" ? agentId ?? ownerRef : projectId ?? ownerRef;
        const folder = target ? await folderOf(layer, target) : null;
        ok = folder !== null && allow(level, { type: "folder", id: folder });
        // an agent's memory is not every member's to edit (ruling 88): a member's Space-wide Edit reaches the folder by inheritance, and that alone does not count. Editing is for the agent's
        // owner, an admin (memory.admin), and anyone the owner shared the folder with (a direct Edit or Manage grant of their own).
        if (ok && layer === "agent" && level === "edit" && folder !== null) ok = (await ownsOrShared(target as string, folder)) || ctx.authorize({ perm: "memory.admin", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";
      }
      memo.set(key, ok);
      return ok;
    },
    isAdmin: () => ctx.authorize({ perm: "memory.admin", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow",
  };
}

/** The setting memory.auto_merge_kinds (Space scope); the default is preferences only. */
export async function autoMergeKinds(ctx: MemCtx): Promise<string[]> {
  try {
    const res = (await ctx.call("settings.get", { key: "memory.auto_merge_kinds" })) as { row?: { value?: unknown } };
    const v = res.row?.value;
    if (Array.isArray(v)) return v.map((x) => String(x));
  } catch { /* the default applies */ }
  return ["preference"];
}

// ---- local ranking (no model call): words, trigrams, recency

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "what", "which",
  "who", "whom", "when", "where", "how", "do", "does", "did", "can", "could", "should", "would", "will", "i", "you", "he", "she", "we", "they", "my", "your", "our", "their", "me",
  "us", "them", "about", "from", "by", "as", "if", "so", "than", "then", "there", "has", "have", "had", "not", "no", "any", "please", "tell", "give", "show", "know", "again", "also",
]);

/** A light stemmer: the same on both sides of a comparison, so plurals, common endings and a final "e" do not stop two forms of a word from matching. */
export function stem(w: string): string {
  let s = w;
  if (s.length > 5 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 6 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("es") && !s.endsWith("ses")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

export function tokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export interface Ranked {
  score: number;
  /** How many distinct query words the document holds. */
  matched: number;
  terms: number;
  /** Share of the query, weighted by how rare each word is in this memory (a word no document holds counts as the rarest). */
  coverage: number;
  /** How much rarity the matched words add up to: a document that matches only common words has little. */
  mass: number;
}

interface DocTok { len: number; tf: Map<string, number> }
const tokCache = new Map<string, DocTok>();
const TOK_CACHE_MAX = 50_000;

function docTok(d: RankDoc): DocTok {
  const key = d.shared ? `${d.title}\u0000${d.text}` : null;
  if (key !== null) {
    const hit = tokCache.get(key);
    if (hit) return hit;
  }
  const toks = [...tokens(d.title), ...tokens(d.title), ...tokens(d.text)];
  const tf = new Map<string, number>();
  for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
  const out = { len: toks.length, tf };
  if (key !== null) {
    if (tokCache.size >= TOK_CACHE_MAX) tokCache.clear();
    tokCache.set(key, out);
  }
  return out;
}

/** A document to rank. `shared` documents (agent, project and Space layers, notes) have their words cached by content; a person's own text is never kept between calls. */
export interface RankDoc { title: string; text: string; shared?: boolean }

/** BM25 of the query over each document (title counts twice), plus a coverage measure that does not depend on how many documents there are. */
export function bm25(docs: ReadonlyArray<RankDoc>, query: string): Ranked[] {
  const q = [...new Set(tokens(query))];
  const out: Ranked[] = docs.map(() => ({ score: 0, matched: 0, terms: q.length, coverage: 0, mass: 0 }));
  if (q.length === 0 || docs.length === 0) return out;
  const toks = docs.map(docTok);
  const avg = toks.reduce((a, t) => a + t.len, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of q) if (t.tf.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  const idf = (d: number): number => Math.log(1 + (n - d + 0.5) / (d + 0.5));
  const rarest = idf(1);
  const rel = (w: string): number => {
    const d = df.get(w) ?? 0;
    return d === 0 ? 1 : Math.min(1, idf(d) / rarest);
  };
  const total = q.reduce((a, w) => a + rel(w), 0);
  toks.forEach((t, i) => {
    let s = 0;
    let matched = 0;
    let mass = 0;
    for (const w of q) {
      const f = t.tf.get(w);
      if (!f) continue;
      matched++;
      mass += rel(w);
      s += (idf(df.get(w) ?? 0) * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * t.len) / avg));
    }
    out[i] = { score: s, matched, terms: q.length, coverage: total > 0 ? mass / total : 0, mass };
  });
  return out;
}

function grams(s: string): Map<string, number> {
  const t = ` ${tokens(s).join(" ")} `;
  const m = new Map<string, number>();
  for (let i = 0; i + 3 <= t.length; i++) {
    const g = t.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Cosine similarity of character trigrams: the local stand-in for vectors, which forgives spelling and word forms. */
export function trigramSim(a: string, b: string): number {
  const ga = grams(a);
  const gb = grams(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [g, c] of ga) { na += c * c; const o = gb.get(g); if (o) dot += c * o; }
  for (const c of gb.values()) nb += c * c;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** A small lift for recent facts; it never turns a non-match into a match. */
export const recencyBoost = (learnedAt: number, now: number): number => 0.15 * 2 ** (-Math.max(0, now - learnedAt) / (60 * 86_400_000));

/** A snippet of at most `max` characters around the first query word. */
export function snippet(text: string, query: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const w of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - Math.floor(max / 4));
  const cut = flat.slice(start, start + max).trim();
  return `${start > 0 ? "..." : ""}${cut}${start + max < flat.length ? "..." : ""}`;
}

// ---- pagination (cursor = offset)

export function pageOf<T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { page: T[]; next?: string; total: number } {
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit ?? 100;
  const page = items.slice(start, start + size);
  const end = start + size;
  return { page, ...(end < items.length ? { next: String(end) } : {}), total: items.length };
}

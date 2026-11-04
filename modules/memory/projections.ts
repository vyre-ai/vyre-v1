// @reads /modules/memory/migrations/0001_init.sql
// @reads /modules/memory/migrations/0003_trail.sql
// Person-layer text is sealed under the person's own key (personal.ts): sealText and openText below are that file's.
// Durable rows and shared helpers of the memory module (spec 2.15, 4.15; ARCH 6.10): the context type the handlers use, the schema bootstrap, fact rows and their
// contract shape, the sealing of person-layer text, layer access, and the local ranking (BM25 over words, trigram similarity, recency) that search and the pointer block share.
// Every statement names a memory_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { audienceFrom, chatAudience, othersRead, placeAudience, within } from "../../lib/audience.ts";
import type { Audience } from "../../lib/audience.ts";
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { Sealed } from "../../packages/contracts/src/ctx.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";
import { openFactText } from "./personal.ts";
import type { SealCtx } from "./personal.ts";

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
  /** The chat an agent's tool call came from. */
  thread?: string | undefined;
  actingFor?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: Level }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  /** May every one of these people do this (the host's authorize for each)? What shared memory a chat may hear is what every person in it may open. Absent on a hand-built test ctx. */
  mayAll?(people: readonly string[], action: { perm: string | null; level: Level }, resource: { type: string; id: string | null }): boolean;
  seal: { seal(v: Uint8Array, scope: string): Sealed; unseal(s: Sealed): Uint8Array };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

/** Throw the catalogue error for this call. */
export function raise(ctx: Pick<MemCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/**
 * Does anyone but the asker read this chat? A channel always counts, as does any chat with two people in it. A chat that cannot be read counts too: private memory stays out unless we know it is safe (hole 8).
 */
export async function seenByOthers(ctx: Pick<MemCtx, "call" | "principal" | "actingFor">, threadId: string): Promise<boolean> {
  return othersRead(await chatAudience((cap, input) => ctx.call(cap, input), threadId), actorOf(ctx));
}

/**
 * The chat a memory read answers into: the one an agent's tool call came from, or the one a caller names (recall, quotes). Undefined outside a chat: a person reading their own Memory panel.
 */
export const hereOf = (ctx: Pick<MemCtx, "principal" | "thread">, thread?: string): string | undefined => thread ?? (ctx.principal.kind === "agent" ? ctx.thread : undefined);

/** Who did it: the person an agent acts for, else the caller. */
export const actorOf = (ctx: Pick<MemCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- schema

const SCHEMA = ["0001_init.sql", "0003_trail.sql"].map((f) => readFileSync(new URL(`./migrations/${f}`, import.meta.url), "utf8")).join("\n")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);

const ready = new WeakSet<object>();

/** Columns the trail, Trash and Archive added to memory_facts after the first schema. */
const FACT_COLUMNS = [
  // the people a fact learned in a chat others read is kept for (lib/audience.ts, JSON); null: whoever may open its layer
  '"audience" TEXT',
  // rule 1 and 3 (shared-place memory): the place a fact was learned in, the exact message and words it came from, and a state the status cannot hold (disputed, source_removed)
  '"place_kind" TEXT', '"place_id" TEXT', '"msg_id" TEXT', '"span" TEXT', '"state" TEXT', '"parent_kind" TEXT', '"parent_id" TEXT',
  '"trashed_at" INTEGER', '"trash_reason" TEXT', '"trashed_by" TEXT', '"prev_status" TEXT', '"prev_valid_to" INTEGER', '"merged_into" TEXT', '"touched_at" INTEGER', '"archived_at" INTEGER', '"archived_by" TEXT',
];
/** Columns added to the page and link tables after their first version. */
const LATER_COLUMNS: Array<[string, string]> = [
  ["memory_pages", '"subtitle" TEXT'], ["memory_pages", '"blurb" TEXT'], ["memory_mentions", '"message_id" TEXT'], ["memory_page_links", `"target" TEXT NOT NULL DEFAULT ''`],
];
const FACT_INDEXES = ['CREATE INDEX IF NOT EXISTS memory_facts_trash ON memory_facts (trashed_at, archived_at)'];

/** Make sure the memory tables exist. One cheap probe per handle; the CREATE ... IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try {
    // every column added after the first schema is probed by name: a Space made before one of them was added (the first of them, archived_by, is there; audience, added later, is not) must fail here
    // and get it, not read a column it does not have
    for (const col of FACT_COLUMNS) db.all(`SELECT ${col.split(" ")[0]} FROM memory_facts WHERE id = ?`, "probe");
    for (const [table, col] of LATER_COLUMNS) db.all(`SELECT ${col.split(" ")[0]} FROM ${table} LIMIT 0`);
    db.all("SELECT stopped FROM memory_upkeep_runs WHERE id = ?", "probe");
  } catch {
    for (const stmt of SCHEMA) db.run(stmt);
    // SQLite has no ADD COLUMN IF NOT EXISTS: a column that is already there raises and is skipped.
    for (const col of FACT_COLUMNS) { try { db.run(`ALTER TABLE memory_facts ADD COLUMN ${col}`); } catch { /* already there */ } }
    for (const [table, col] of LATER_COLUMNS) { try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already there */ } }
    for (const stmt of FACT_INDEXES) db.run(stmt);
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

// Under the person's own key since 3 Nov 2026; rows from before keep the server seal (scope mem.<owner>) until the background job re-seals them (personal.ts).
export { sealScope, sealText, openText, personalLocked, LOCKED_LINE } from "./personal.ts";

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
  /** In Trash since this time (a deleted or merged-away fact, not recalled, restorable). Null for a fact that is not in Trash. */
  trashedAt: number | null;
  trashReason: string | null;
  mergedInto: string | null;
  /** Moved from Trash to Archive at this time (out of all search, restorable by an admin). */
  archivedAt: number | null;
  /** Learned in a chat other people read: kept for those people (lib/audience.ts). Null: whoever may open its layer. */
  audience: Audience | null;
  /** The place it was learned in (a thread maps to its parent place), the message it came from, and the words as written there. */
  placeKind: string | null; placeId: string | null; parentKind: string | null; parentId: string | null; msgId: string | null; span: string | null;
  /** disputed or source_removed when set; a replaced fact is a closed one another fact replaces. */
  state: string | null;
}

/** Row to Fact. A person-layer row opens only for its owner; for anyone else its text stays empty and callers drop it before it reaches an answer. */
export function readFact(ctx: Pick<MemCtx, "seal" | "principal" | "actingFor"> & Partial<Pick<MemCtx, "db" | "space">>, r: Row): Fact {
  const layer = str(r["layer"]) as Layer;
  const owner = str(r["owner_ref"]);
  const sealed = orNull(r["sealed"]);
  let text = str(r["text"]);
  // a marker (rule 6) holds no words of its own: it reads as its source reads now, and reads as nothing once the source is gone
  if (orNull(r["state"]) === "marker" && ctx.db) {
    const src = rowsOf(ctx.db, "SELECT text FROM memory_facts WHERE id = ? AND status = 'current' AND trashed_at IS NULL AND layer <> 'person'", str(r["promoted_from"]))[0];
    text = src ? str(src["text"]) : "";
  }
  if (num(r["enc"]) === 2 && sealed !== null) {
    text = owner === actorOf(ctx) ? openFactText(ctx as SealCtx, str(r["id"]), owner, sealed) : "";
  }
  return {
    id: str(r["id"]), layer, ownerRef: owner, agentId: orNull(r["agent_id"]), projectId: orNull(r["project_id"]), noteId: orNull(r["note_id"]), kind: orNull(r["kind"]), text,
    enc: num(r["enc"]), validFrom: num(r["valid_from"]), validTo: numOrNull(r["valid_to"]), learnedAt: num(r["learned_at"]), closedAt: numOrNull(r["closed_at"]),
    sourceKind: str(r["source_kind"]) as SourceKind, sourceRef: str(r["source_ref"]), sourceLink: orNull(r["source_link"]), sourcePerson: str(r["source_person"]),
    proposedBy: str(r["proposed_by"]), status: str(r["status"]) as FactStatus, lowRisk: num(r["low_risk"]) === 1, subject: orNull(r["subject"]), replaces: orNull(r["replaces"]),
    promotedFrom: orNull(r["promoted_from"]), trashedAt: numOrNull(r["trashed_at"]), trashReason: orNull(r["trash_reason"]), mergedInto: orNull(r["merged_into"]), archivedAt: numOrNull(r["archived_at"]),
    audience: audienceFrom(r["audience"]),
    placeKind: orNull(r["place_kind"]), placeId: orNull(r["place_id"]), parentKind: orNull(r["parent_kind"]), parentId: orNull(r["parent_id"]), msgId: orNull(r["msg_id"]), span: orNull(r["span"]), state: orNull(r["state"]),
  };
}

/** The title a fact shows under in search and recall: its kind, or "Fact". */
export const factTitle = (kind: string | null): string => (kind ? `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}` : "Fact");

/** The contract's fact row. */
export function factOut(f: Fact) {
  return {
    factId: f.id, layer: f.layer, ownerRef: f.ownerRef, ...(f.agentId ? { agentId: f.agentId } : {}), ...(f.noteId ? { noteId: f.noteId } : {}), text: f.text,
    validFrom: f.validFrom, ...(f.validTo !== null ? { validTo: f.validTo } : {}), learnedAt: f.learnedAt, ...(f.closedAt !== null ? { closedAt: f.closedAt } : {}),
    sourceKind: f.sourceKind, sourceRef: f.sourceRef, ...(f.sourceLink ? { sourceLink: f.sourceLink } : {}), status: f.status, lowRisk: f.lowRisk,
    ...(f.trashedAt !== null ? { trashedAt: f.trashedAt } : {}), ...(f.trashReason ? { trashReason: f.trashReason } : {}), ...(f.archivedAt !== null ? { archivedAt: f.archivedAt } : {}),
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
  /**
   * May the caller see (view) or change (edit) this layer of this agent or project? A person layer belongs to its owner alone. A view inside a chat is also held to the chat's audience: the one check
   * every memory read goes through. `kept` is the audience a fact was kept for (learned in a chat others read).
   */
  can(layer: Layer, ownerRef: string, agentId: string | null, projectId: string | null, level: "view" | "edit", kept?: Audience | null): Promise<boolean>;
  /** May words from this chat be shown here? Everyone who reads the chat being answered must also read the chat they came from. Always true outside a chat. */
  showsFrom(threadId: string): Promise<boolean>;
  /** May the caller administer memory (memory.admin at manage)? */
  isAdmin(): boolean;
}

/**
 * Layer access is decided by authorize on the layer's folder resource (the agent's folder, the project's folder, the Space), memoised per call.
 * DECISION: the agent's memory folder sits inside the agent folder and folder grants flow down, so authorize runs on the agent folder.
 *
 * The audience rule (agent-visibility gaps 3 and 4, memory audit items 1 and 2). A read made into a chat (an agent's tool call carries it, recall and quotes name it) answers to everyone who reads that
 * chat, not only the asker:
 *   - a person's own memory only when nobody else reads the chat;
 *   - agent, project and Space memory only when every person in the chat may open it (ctx.mayAll), so a guest never hears a project fact through a teammate's turn;
 *   - a fact kept for a channel's people only in a chat whose people are all among them, and outside a chat only for one of them.
 * Every memory read goes through `can`, so no tool can reach around it.
 */
export function makeAccess(ctx: MemCtx, o: { thread?: string; /** a write's own permission check: where the words go next is not this call's answer */ write?: boolean } = {}): Access {
  const me = actorOf(ctx);
  const here = o.write === true ? undefined : hereOf(ctx, o.thread);
  let heard: Promise<Audience> | null = null;
  const audience = (): Promise<Audience> => (heard ??= here === undefined ? Promise.resolve({ space: false, people: [me] }) : chatAudience((cap, input) => ctx.call(cap, input), here));
  const sources = new Map<string, Promise<Audience>>();
  const everyone = async (resource: Resource): Promise<boolean> => {
    if (here === undefined) return true;
    const a = await audience();
    const others = a.people.filter((p) => p !== me);
    if (others.length === 0) return true;
    return ctx.mayAll ? ctx.mayAll(others, { perm: null, level: "view" }, resource) : true;
  };
  const placeNow = new Map<string, Promise<Audience | null>>();
  const keptFor = async (kept: Audience | null | undefined): Promise<boolean> => {
    if (!kept || kept.space) return true;
    // memory kept for a place: whoever may open that place now (a late joiner reads it, a removed member and a place that went invite-only no longer do)
    if (kept.live) {
      let now = placeNow.get(kept.live);
      if (!now) { now = placeAudience((cap, input) => ctx.call(cap, input), kept.live); placeNow.set(kept.live, now); }
      const open = await now;
      if (open === null || (!open.space && !open.people.includes(me))) return false;
      // rule 8: what a private chat learned before it gained people stays its starter's: a fact from before the chat first had a second person is read only by the starter, and only where nobody else reads
      if (open.kind === "chat" && open.sharedAt !== undefined && kept.at !== undefined && kept.at < open.sharedAt) {
        if (open.starter === undefined || open.starter !== me) return false;
        return here === undefined || within(await audience(), { space: false, people: [open.starter] });
      }
      return here === undefined || within(await audience(), open);
    }
    if (!kept.people.includes(me)) return false;
    return here === undefined || within(await audience(), kept);
  };
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
      const editing = (got.shares ?? []).filter((r) => r.grant?.level === "edit" || r.grant?.level === "manage");
      if (editing.some((r) => (r.through === "owner" || r.through === "direct") && r.grant?.subject?.kind === "person" && r.grant.subject.id === me)) return true;
      // a group the owner shared the folder with at Edit or Manage: it counts when the asker is in it
      for (const r of editing) {
        if (r.through !== "group" || r.grant?.subject?.kind !== "group" || !r.grant.subject.id) continue;
        const group = (await ctx.call("access.groups.get", { groupId: r.grant.subject.id })) as { group?: { members?: { id?: string }[] } };
        if ((group.group?.members ?? []).some((m) => m.id === me)) return true;
      }
      return false;
    } catch { return false; }
  };
  const allow = (level: "view" | "edit", res: Resource): boolean => ctx.authorize({ perm: null, level }, res).effect === "allow";
  return {
    async can(layer, ownerRef, agentId, projectId, level, kept) {
      if (level === "view" && !(await keptFor(kept))) return false;
      if (layer === "person") return ownerRef === me && (level !== "view" || here === undefined || !othersRead(await audience(), me));
      const key = `${layer}:${ownerRef}:${agentId ?? ""}:${projectId ?? ""}:${level}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      let ok = false;
      if (layer === "space") ok = allow(level, { type: "space", id: ctx.space }) && (level !== "view" || await everyone({ type: "space", id: ctx.space }));
      else {
        const target = layer === "agent" ? agentId ?? ownerRef : projectId ?? ownerRef;
        const folder = target ? await folderOf(layer, target) : null;
        ok = folder !== null && allow(level, { type: "folder", id: folder }) && (level !== "view" || await everyone({ type: "folder", id: folder }));
        // an agent's memory is not every member's to edit (ruling 88): a member's Space-wide Edit reaches the folder by inheritance, and that alone does not count. Editing is for the agent's
        // owner, an admin (memory.admin), and anyone the owner shared the folder with (a direct Edit or Manage grant of their own, or one given to a group they are in).
        if (ok && layer === "agent" && level === "edit" && folder !== null) ok = (await ownsOrShared(target as string, folder)) || ctx.authorize({ perm: "memory.admin", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";
      }
      memo.set(key, ok);
      return ok;
    },
    isAdmin: () => ctx.authorize({ perm: "memory.admin", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow",
    async showsFrom(threadId) {
      if (here === undefined || threadId === here) return true;
      let from = sources.get(threadId);
      if (!from) { from = chatAudience((cap, input) => ctx.call(cap, input), threadId); sources.set(threadId, from); }
      return within(await audience(), await from);
    },
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

export interface DocTok { len: number; tf: Map<string, number> }
const tokCache = new Map<string, DocTok>();
const TOK_CACHE_MAX = 50_000;

/** The words of a document, counted (title twice). */
export function tokOf(title: string, text: string): DocTok {
  const toks = [...tokens(title), ...tokens(title), ...tokens(text)];
  const tf = new Map<string, number>();
  for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
  return { len: toks.length, tf };
}

function docTok(d: RankDoc): DocTok {
  if (d.tok) return d.tok;
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
export interface RankDoc { title: string; text: string; shared?: boolean; /** words counted ahead of time (a person's own facts, from their in-memory index) */ tok?: DocTok }

/** Documents left out of a ranking because they hold none of the query's words: they still count in the corpus (how many, how long), so the scores of the others do not change. */
export interface Ghost { n: number; len: number }
const NO_GHOST: Ghost = { n: 0, len: 0 };

/** BM25 of the query over each document (title counts twice), plus a coverage measure that does not depend on how many documents there are. */
export function bm25(docs: ReadonlyArray<RankDoc>, query: string, ghost: Ghost = NO_GHOST): Ranked[] {
  const q = [...new Set(tokens(query))];
  const out: Ranked[] = docs.map(() => ({ score: 0, matched: 0, terms: q.length, coverage: 0, mass: 0 }));
  if (q.length === 0 || docs.length === 0) return out;
  const toks = docs.map(docTok);
  const n = docs.length + ghost.n;
  const avg = (toks.reduce((a, t) => a + t.len, 0) + ghost.len) / n || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of q) if (t.tf.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
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

/** A text's character trigrams as numbers (each gram is three characters of [a-z0-9 ], so three bytes), with their counts and the vector's length. */
export interface GramVec { keys: Int32Array; counts: Float32Array; norm: number }
const gramCode = (g: string): number => (g.charCodeAt(0) << 16) | (g.charCodeAt(1) << 8) | g.charCodeAt(2);
export function gramVec(s: string): GramVec {
  const m = grams(s);
  const keys = new Int32Array(m.size);
  const counts = new Float32Array(m.size);
  let i = 0;
  let n = 0;
  for (const [g, c] of m) { keys[i] = gramCode(g); counts[i] = c; n += c * c; i++; }
  return { keys, counts, norm: Math.sqrt(n) };
}
/** trigramSim against one question, with the question's grams made once: the same number as trigramSim(q, text) for gramVec(text). */
export function trigramScorer(q: string): (v: GramVec) => number {
  const qm = new Map<number, number>();
  let qn = 0;
  for (const [g, c] of grams(q)) { qm.set(gramCode(g), c); qn += c * c; }
  const qnorm = Math.sqrt(qn);
  return (v) => {
    if (qnorm === 0 || v.norm === 0) return 0;
    let dot = 0;
    for (let i = 0; i < v.keys.length; i++) { const o = qm.get(v.keys[i]!); if (o) dot += v.counts[i]! * o; }
    return dot / (qnorm * v.norm);
  };
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

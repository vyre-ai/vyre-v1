// @reads /modules/memory/migrations/0004_person_keys.sql
// A person's private memory under their own key (owner ruling 3 Nov 2026, spec b7; RULINGS "Personal memory under the person's own key"). Person-layer facts, personal pages with their versions and links, and personal note titles are
// sealed with keys made from the person key (kernel/src/seal/person-memory.ts), the same family as Mine Vault items:
//
//   writes   need no private key. A write in the person's own turn while their key is held uses the own form; any other write (capture, a nightly job, an agent acting while they are signed
//            out) seals to the person's memory public key, kept in memory_person_keys. A person whose key was never held on this node has no public key here yet, and their rows keep the old
//            server seal (mem.<owner>, host ctx.seal) until it is.
//   reads    need the person key, which the host's keyring holds only while that person is signed in (or their own computer's keyring, once unlocked) and hands over through the memory key port.
//            Only the person's own reads ask for it (readFact, readPage and the note reads check the owner first). With no key the text reads as empty and `personalLocked` says why.
//   index    the plain text, the BM25 words and the meaning vectors of one person's facts are kept only in this process's memory while the key is held, built on first use or by the background job,
//            and dropped the moment the keyring no longer holds the key. Nothing derived from personal text is written to a table.
//   settle   the background job (`settle`, every 30 s) finds people whose key is held and re-seals every row still under the server seal or under the public key into the own form, checks that the
//            new value opens to the same words, then overwrites the old value with SQLite secure_delete on (the host's `wipe`). A person who never signs in again keeps the old sealing.
// Crypto is the kernel's (boundary B3); this file only decides which form a row takes and who may ask.
import { readFileSync } from "node:fs";
import { PersonMemoryKey, memorySealForm, sealToMemoryKey } from "../../kernel/src/seal/index.ts";
import type { Sealed } from "../../packages/contracts/src/ctx.ts";
import type { Db, MemCtx } from "./projections.ts";

/** What the host hands the module: the person key of someone signed in here, and a way to overwrite freed bytes. */
export interface MemoryKeyPort {
  /** A copy of the person's key while a session of theirs that handed it over is alive; null otherwise. The module wipes the copy after use. */
  personKey(personId: string): Uint8Array | null;
  /** Run `fn` with the database set to overwrite what it frees (secure_delete), then checkpoint the log, so a replaced sealed value leaves no copy behind. Omitted: `fn` just runs. */
  wipe?<T>(fn: () => T): T;
}

let port: MemoryKeyPort | null = null;
/** The host's memory key port (boot); null unbinds it and drops every key and index. */
export function setMemoryKeyPort(p: MemoryKeyPort | null): void {
  port = p;
  if (!p) for (const owner of [...held.keys()]) drop(owner);
}

/** The context the sealing needs. A bare { seal } still opens and writes the old server seal. */
export interface SealCtx {
  seal: MemCtx["seal"];
  db?: Db | undefined;
  space?: string | undefined;
  principal?: MemCtx["principal"] | undefined;
  actingFor?: string | undefined;
}

const aadOf = (owner: string): string => `vyre:memory:v1|${owner}`;
const te = new TextEncoder();
const td = new TextDecoder();
const who = (ctx: SealCtx): string | null => (ctx.principal ? ctx.actingFor ?? ctx.principal.id : null);

/** Raised by openText when the person's key is not held here. */
export class MemoryLocked extends Error {
  constructor() { super("this person's memory key is not held here"); this.name = "MemoryLocked"; }
}

// ---- keys

/** One key per person at most, wiped when the keyring stops holding theirs. */
const held = new Map<string, PersonMemoryKey>();
/** Asked once per call: the host makes a ctx object per call, so a sign-out is seen by the next call (a call already running keeps its answer; a wiped key then fails closed). */
const perCall = new WeakMap<object, Map<string, PersonMemoryKey | null>>();

/** The person's memory key when the keyring holds their person key now; null otherwise (and anything kept for them is dropped). Registers their public key in this Space on the way. */
export function heldKey(ctx: SealCtx, owner: string): PersonMemoryKey | null {
  let memo = perCall.get(ctx);
  if (!memo) { memo = new Map(); perCall.set(ctx, memo); }
  if (memo.has(owner)) return memo.get(owner) ?? null;
  const raw = port?.personKey(owner) ?? null;
  let k: PersonMemoryKey | null = null;
  if (raw) {
    try {
      const fresh = PersonMemoryKey.from(raw);
      const old = held.get(owner);
      if (old && old.tag === fresh.tag) { fresh.wipe(); k = old; } else { drop(owner); held.set(owner, fresh); k = fresh; }
    } catch { k = null; } finally { raw.fill(0); }
  }
  if (!k) drop(owner);
  else if (ctx.db) register(ctx.db, owner, k);
  memo.set(owner, k);
  return k;
}

function drop(owner: string): void {
  held.get(owner)?.wipe();
  held.delete(owner);
  for (const [k, ix] of indexes) if (ix.owner === owner) { ix.texts.clear(); ix.toks.clear(); ix.grams.clear(); ix.vecs.clear(); ix.meta.clear(); indexes.delete(k); }
}

/** Drop every person whose key the keyring no longer holds (the background job calls this, so plaintext does not wait for a read). */
export function sweepHeld(): number {
  let n = 0;
  for (const owner of [...new Set([...held.keys(), ...[...indexes.values()].map((i) => i.owner)])]) {
    const raw = port?.personKey(owner) ?? null;
    if (raw) { raw.fill(0); continue; }
    drop(owner);
    n++;
  }
  return n;
}

// ---- public keys

const SCHEMA = readFileSync(new URL("./migrations/0004_person_keys.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();
function keysTable(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT key_tag FROM memory_person_keys WHERE owner_ref = ?", "probe"); } catch { for (const s of SCHEMA) db.run(s); }
  ready.add(db);
}

function register(db: Db, owner: string, k: PersonMemoryKey): void {
  try {
    keysTable(db);
    const have = db.all("SELECT key_tag FROM memory_person_keys WHERE owner_ref = ?", owner)[0] as { key_tag?: string } | undefined;
    if (have?.key_tag === k.tag) return;
    db.run("INSERT INTO memory_person_keys (owner_ref, public_key, key_tag, registered_at) VALUES (?, ?, ?, ?) ON CONFLICT (owner_ref) DO UPDATE SET public_key = excluded.public_key, key_tag = excluded.key_tag, registered_at = excluded.registered_at",
      owner, k.pub, k.tag, Date.now());
  } catch { /* a read-only or foreign handle: the key is registered by the next call that can */ }
}

/** The person's memory public key in this Space, or null when their key was never held here. */
export function publicKeyOf(db: Db, owner: string): string | null {
  try {
    keysTable(db);
    const r = db.all("SELECT public_key FROM memory_person_keys WHERE owner_ref = ?", owner)[0] as { public_key?: string } | undefined;
    return r?.public_key ? String(r.public_key) : null;
  } catch { return null; }
}

// ---- seal and open

/** Seal one person's text: their own key in their own turn while it is held, else their public key, else (never held here) the server seal. */
export function sealText(ctx: SealCtx, owner: string, text: string): string {
  if (who(ctx) === owner) {
    const k = heldKey(ctx, owner);
    // a sign-out during this call wipes the key: the public form below still works
    if (k) { try { return k.seal(text, aadOf(owner)); } catch { /* wiped */ } }
  }
  let pub = ctx.db ? publicKeyOf(ctx.db, owner) : null;
  // a write for someone else may still register the owner's public key from a held key; the key is not used to seal
  if (!pub && ctx.db && heldKey(ctx, owner)) pub = publicKeyOf(ctx.db, owner);
  if (pub) return sealToMemoryKey(pub, text, aadOf(owner));
  return legacySeal(ctx, owner, text);
}

/** Open one person's text. `owner` defaults to the caller (an agent counts as the person it acts for): callers check the owner before they ask. Throws MemoryLocked without the key. */
export function openText(ctx: SealCtx, sealed: string, owner: string | null = who(ctx)): string {
  if (!memorySealForm(sealed)) return td.decode(ctx.seal.unseal(JSON.parse(sealed) as Sealed));
  if (!owner) throw new MemoryLocked();
  const k = heldKey(ctx, owner);
  if (!k) throw new MemoryLocked();
  return k.open(sealed, aadOf(owner));
}

/** Each person had their own server seal scope before their own key; kept so rows from then still open until they are re-sealed. */
export const sealScope = (owner: string): string => `mem.${owner}`.toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 64);
const legacySeal = (ctx: SealCtx, owner: string, text: string): string => JSON.stringify(ctx.seal.seal(te.encode(text), sealScope(owner)));

/** Is this person's memory sealed under their own key and that key not held here now? Then their own reads come back empty, and this says why. False when no keyring is wired. */
export function personalLocked(ctx: SealCtx & { db: Db }, owner: string): boolean {
  if (!port || heldKey(ctx, owner)) return false;
  try { return ctx.db.all("SELECT 1 AS x FROM memory_facts WHERE layer = 'person' AND owner_ref = ? AND status IN ('current', 'proposed') AND enc = 2 AND sealed LIKE 'pm1.%' LIMIT 1", owner).length > 0; } catch { return false; }
}

/** The plain words that go with an empty personal answer. */
export const LOCKED_LINE = "Your private memory is sealed under your own key, and this server does not hold it right now, so nothing personal was recalled. It opens again when you sign in here with your password (or on your own computer).";

// ---- the session index (memory only)

/** What search and recall need of one live personal fact, without its words. */
export interface FactMeta { rid: number; id: string; agentId: string | null; projectId: string | null; noteId: string | null; kind: string | null; validFrom: number; validTo: number | null; learnedAt: number; sourceLink: string | null }
export interface PersonIndex {
  owner: string; tag: string;
  texts: Map<string, string>; toks: Map<string, unknown>; grams: Map<string, unknown>; vecs: Map<string, Float32Array>;
  /** the person's current facts by rowid, and the signature of the set they were read at */
  meta: Map<number, FactMeta>; sig: string;
}
const indexes = new Map<string, PersonIndex>();

/** The in-memory index of one person in one Space, while their key is held; null when it is not. */
export function indexOf(ctx: SealCtx, owner: string): PersonIndex | null {
  const k = heldKey(ctx, owner);
  if (!k) return null;
  const at = `${ctx.space ?? ""}\u0000${owner}`;
  let ix = indexes.get(at);
  if (ix && ix.tag !== k.tag) { indexes.delete(at); ix = undefined; }
  if (!ix) { ix = { owner, tag: k.tag, texts: new Map(), toks: new Map(), grams: new Map(), vecs: new Map(), meta: new Map(), sig: "" }; indexes.set(at, ix); }
  return ix;
}

/** The text of one person-layer fact for its owner: from the index when it is there, else opened (and kept while the key is held). "" when it cannot be opened. */
export function openFactText(ctx: SealCtx, id: string, owner: string, sealed: string): string {
  const ix = indexOf(ctx, owner);
  if (ix) {
    const hit = ix.texts.get(id);
    if (hit !== undefined) return hit;
  }
  try {
    const text = openText(ctx, sealed, owner);
    if (ix && id !== "") ix.texts.set(id, text);
    return text;
  } catch { return ""; }
}

// sealed rows only: a plain person-layer row (a fact on the owner's public profile) is read from the table like shared text
const CURRENT = "FROM memory_facts WHERE layer = 'person' AND owner_ref = ? AND status = 'current' AND enc = 2";
/**
 * The person's current facts from their in-memory index, kept in step with the table: a signature read from the (layer, owner_ref, status) index alone (how many, and the sum of their rowids) says
 * whether the set changed; when it did, the rowids are read (index only) and just the rows that came or went are fetched. Null when their key is not held here.
 */
export function currentPersonFacts(ctx: SealCtx & { db: Db }, owner: string): Iterable<FactMeta> | null {
  const ix = indexOf(ctx, owner);
  if (!ix) return null;
  const r = ctx.db.all(`SELECT COUNT(*) AS n, TOTAL(rowid) AS s ${CURRENT}`, owner)[0] as { n: number; s: number };
  const sig = `${r.n}:${r.s}`;
  if (sig !== ix.sig) {
    const rids = (ctx.db.all(`SELECT rowid AS r ${CURRENT}`, owner) as Array<{ r: number }>).map((x) => Number(x.r));
    const want = new Set(rids);
    for (const k of ix.meta.keys()) if (!want.has(k)) ix.meta.delete(k);
    const add = rids.filter((x) => !ix.meta.has(x));
    for (let i = 0; i < add.length; i += 500) {
      const part = add.slice(i, i + 500);
      for (const m of ctx.db.all(`SELECT rowid AS rid, id, agent_id, project_id, note_id, kind, valid_from, valid_to, learned_at, source_link FROM memory_facts WHERE rowid IN (${part.map(() => "?").join(",")})`, ...part) as Array<Record<string, unknown>>) {
        const o = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
        ix.meta.set(Number(m["rid"]), {
          rid: Number(m["rid"]), id: String(m["id"]), agentId: o(m["agent_id"]), projectId: o(m["project_id"]), noteId: o(m["note_id"]), kind: o(m["kind"]), validFrom: Number(m["valid_from"]),
          validTo: m["valid_to"] === null || m["valid_to"] === undefined ? null : Number(m["valid_to"]), learnedAt: Number(m["learned_at"]), sourceLink: o(m["source_link"]),
        });
      }
    }
    ix.sig = sig;
  }
  return ix.meta.values();
}

/** How many people have an index in this process (tests and the status line). */
export const indexedPeople = (): number => indexes.size;

// ---- settle: re-seal to the person's own key, then wipe the old value

/** Every sealed column of personal memory, and how to find a person's rows in it. */
// Rows are picked by enc = 2 (sealed to their owner), never by layer alone: a person-layer fact its owner put on their public profile is plain (enc 0, sealed NULL) on purpose (lane l-profile).
const SEALED: ReadonlyArray<{ table: string; col: string; mine: string }> = [
  { table: "memory_facts", col: "sealed", mine: "enc = 2 AND layer = 'person' AND owner_ref = ?" },
  { table: "memory_pages", col: "sealed", mine: "enc = 2 AND layer = 'person' AND owner_ref = ?" },
  { table: "memory_page_versions", col: "sealed", mine: "enc = 2 AND page_id IN (SELECT page_id FROM memory_pages WHERE layer = 'person' AND owner_ref = ?)" },
  { table: "memory_page_links", col: "sealed", mine: "from_page IN (SELECT page_id FROM memory_pages WHERE layer = 'person' AND owner_ref = ?)" },
  { table: "memory_notes", col: "sealed_title", mine: "layer = 'person' AND owner_ref = ?" },
];

export interface SettleOut { people: number; resealed: number; unreadable: number; fromPublic: string[]; left: number }

/**
 * Re-seal up to `budget` of one person's rows that are not yet in the own form: open each (server seal or public key), seal it under their own key, check the new value opens to the same words,
 * then replace the old value only if it is still the one read (a row changed meanwhile is left for the next pass). Answers the fact ids that came from the public key, for the duplicate check.
 */
export function resealPerson(ctx: SealCtx & { db: Db }, owner: string, budget = 2000): { resealed: number; unreadable: number; fromPublic: string[]; left: number } | null {
  const k = heldKey(ctx, owner);
  if (!k) return null;
  const aad = aadOf(owner);
  const own = `pm1.o.${k.tag}.`;
  const plan: Array<{ table: string; col: string; rowid: number; old: string; next: string }> = [];
  const fromPublic: string[] = [];
  let unreadable = 0;
  let left = 0;
  for (const s of SEALED) {
    let rows: Array<Record<string, unknown>>;
    try {
      // everything not yet in the own form of the key held now: the server seal, the public key, or an older key of theirs (which cannot open, and is counted as such)
      rows = ctx.db.all(`SELECT rowid AS rid, ${s.col} AS v${s.table === "memory_facts" ? ", id" : ""} FROM ${s.table} WHERE ${s.mine} AND ${s.col} IS NOT NULL AND ${s.col} <> '' AND substr(${s.col}, 1, ?) <> ?`, owner, own.length, own) as Array<Record<string, unknown>>;
    } catch { continue; }
    for (const r of rows) {
      const old = String(r["v"]);
      if (plan.length >= budget) { left++; continue; }
      let plain: string;
      try { plain = openText(ctx, old, owner); } catch { unreadable++; continue; }
      const next = k.seal(plain, aad);
      if (k.open(next, aad) !== plain) { unreadable++; continue; }
      plan.push({ table: s.table, col: s.col, rowid: Number(r["rid"]), old, next });
      if (s.table === "memory_facts" && memorySealForm(old) === "public") fromPublic.push(String(r["id"]));
    }
  }
  let resealed = 0;
  const apply = (): void => { for (const p of plan) resealed += ctx.db.run(`UPDATE ${p.table} SET ${p.col} = ? WHERE rowid = ? AND ${p.col} = ?`, p.next, p.rowid, p.old).changes; };
  if (plan.length > 0) { if (port?.wipe) port.wipe(apply); else apply(); }
  return { resealed, unreadable, fromPublic, left };
}

/** The people with personal memory in this Space, or a key registered here. */
export function peopleWithMemory(db: Db): string[] {
  const out = new Set<string>();
  for (const sql of [
    "SELECT DISTINCT owner_ref AS o FROM memory_facts WHERE layer = 'person'", "SELECT DISTINCT owner_ref AS o FROM memory_pages WHERE layer = 'person'",
    "SELECT DISTINCT owner_ref AS o FROM memory_notes WHERE layer = 'person'", "SELECT owner_ref AS o FROM memory_person_keys",
  ]) { try { for (const r of db.all(sql) as Array<{ o?: unknown }>) if (r.o) out.add(String(r.o)); } catch { /* table not there yet */ } }
  return [...out].sort();
}

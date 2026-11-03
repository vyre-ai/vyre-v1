// The person profile (owner ruling 3 Nov): one per person per Space, read by every agent that works for them. It is the person layer of memory, in two parts:
//
//   public    what teammates' chats may hear: role, team, how to work with them, team-safe preferences (writing style, time zone, working hours). Stored as plain text (enc 0),
//             because other people's chats read it; nothing reaches it without the person: they move a fact here themselves, or approve an agent's suggestion.
//   private   everything else Vyre learns about the person, and every new fact by default. Sealed under the person's own scope through projections.sealText and openText (readFact),
//             the one place lane l-memkeys swaps in the person's key.
//
// A fact keeps its agent id as "learned by", but the profile reads every agent's facts for the person: what Intake learned, Billing and the Assistant know too.
// Which part a turn may load is decided by the chat's audience (lib/audience.ts, the same function memory recall uses): when anyone besides the person reads the chat (a channel, a group chat,
// a record comment's Ask whose answer posts on the record), only the public part loads. When the only people there are the person (with their own agents), both load.
// The `profile` column on memory_facts: null for private, 'public', or 'suggested' (private, with an agent's suggestion waiting for the person's yes).
import { chatAudience, othersRead } from "../../lib/audience.ts";
import type { Audience } from "../../lib/audience.ts";
import { trail } from "./trail.ts";
import { actorOf, ensure, factOut, readFact, rowsOf, sealText, str } from "./projections.ts";
import type { Db, Fact, MemCtx, Row } from "./projections.ts";

export type Place = "public" | "private";

const ready = new WeakSet<object>();

/** The memory tables with the profile column. One probe per handle. */
export function ensureProfile(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  try { db.all("SELECT profile FROM memory_facts WHERE id = ?", "probe"); } catch {
    try { db.run('ALTER TABLE memory_facts ADD COLUMN "profile" TEXT'); } catch { /* already there */ }
  }
  ready.add(db);
}

/** The audience of a chat for the profile: the one audience function memory recall uses (lib/audience.ts), nothing of its own. */
export const profileAudience = (ctx: Pick<MemCtx, "call">, threadId: string): Promise<Audience> => chatAudience((cap, input) => ctx.call(cap, input), threadId);

/** Is a chat with this audience private to `me` (no other person reads it)? */
export const privateTo = (a: Audience, me: string): boolean => !othersRead(a, me);

export interface ProfileFact {
  fact: Fact;
  place: Place;
  suggested: boolean;
  /** The chat line it was learned from, when capture knows it: vyre://thread/<thread>?m=<message>. */
  lineLink: string | null;
}

const ORDER = "CASE kind WHEN 'profile' THEN 0 WHEN 'preference' THEN 1 ELSE 2 END, learned_at DESC, id";

/** The place a row is in. */
export const placeOf = (r: Row): Place => (str(r["profile"]) === "public" ? "public" : "private");

function lineOf(ctx: MemCtx, factId: string): string | null {
  const r = rowsOf(ctx.db, "SELECT ref FROM memory_fact_links WHERE fact_id = ? AND kind = 'capture' LIMIT 1", factId)[0];
  if (!r) return null;
  const [thread, message] = str(r["ref"]).split(":");
  return thread && message ? `vyre://thread/${thread}?m=${message}` : null;
}

/**
 * A person's current profile facts, every agent's. `which` public: only the public part (for anyone). all: both parts, for the person themselves only (a private row opens only for its owner,
 * so another reader asking for all gets the public part).
 */
export function profileFacts(ctx: MemCtx, owner: string, which: "public" | "all"): ProfileFact[] {
  ensureProfile(ctx.db);
  const mine = owner === actorOf(ctx);
  const onlyPublic = which === "public" || !mine;
  const rows = rowsOf(
    ctx.db,
    `SELECT * FROM memory_facts WHERE layer = 'person' AND owner_ref = ? AND status = 'current' AND (valid_to IS NULL OR valid_to > ?) AND COALESCE(kind, '') <> 'lesson'${onlyPublic ? " AND profile = 'public'" : ""} ORDER BY ${ORDER}`,
    owner, ctx.now(),
  );
  const out: ProfileFact[] = [];
  for (const r of rows) {
    const place = placeOf(r);
    // a public row is plain text; anything sealed opens only for its owner, through readFact (the l-memkeys swap point)
    if (place === "public" && Number(r["enc"] ?? 0) !== 0 && !mine) continue;
    const f = readFact(ctx, r);
    if (f.text === "") continue;
    out.push({ fact: f, place, suggested: str(r["profile"]) === "suggested", lineLink: lineOf(ctx, f.id) });
  }
  return out;
}

/** The contract row of a profile fact. */
export function profileOut(p: ProfileFact) {
  return { ...factOut(p.fact), ...(p.fact.agentId ? { agentId: p.fact.agentId } : {}), place: p.place, ...(p.suggested ? { suggested: true } : {}), ...(p.lineLink ? { lineLink: p.lineLink } : {}) };
}

/**
 * Move one current person-layer fact between the parts, in place (the words do not change, so no new version): public is written as plain text, private is sealed again under the owner.
 * `suggested` marks a private fact with an agent's suggestion. The trail line says where it went, never the words.
 */
export function setPlace(ctx: MemCtx, f: Fact, to: Place | "suggested"): void {
  ensureProfile(ctx.db);
  if (to === "public") ctx.db.run("UPDATE memory_facts SET text = ?, sealed = NULL, enc = 0, profile = 'public' WHERE id = ?", f.text, f.id);
  else if (to === "private") ctx.db.run("UPDATE memory_facts SET text = '', sealed = ?, enc = 2, profile = NULL WHERE id = ?", sealText(ctx, f.ownerRef, f.text), f.id);
  else ctx.db.run("UPDATE memory_facts SET profile = 'suggested' WHERE id = ? AND profile IS NULL", f.id);
  trail(ctx, { action: to === "suggested" ? "flag" : "edit", factId: f.id, layer: f.layer, ownerRef: f.ownerRef, agentId: f.agentId, projectId: f.projectId, reason: to === "public" ? "moved to the public profile" : to === "private" ? "moved to the private profile" : "suggested for the public profile" });
}

/** A corrected fact keeps its place: the new version of a public fact is public too. */
export function carryPlace(ctx: MemCtx, oldId: string, fresh: Fact): void {
  ensureProfile(ctx.db);
  const r = rowsOf(ctx.db, "SELECT profile FROM memory_facts WHERE id = ?", oldId)[0];
  if (r && str(r["profile"]) === "public" && fresh.layer === "person") setPlace(ctx, fresh, "public");
}

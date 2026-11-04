// Writing memory in a shared place (MEMORY-RULES 1, 3, 4, 5). One door for capture and for an agent's save: the fact carries its place, its source message and the words as written, a newer statement
// on the same subject by the same person replaces the older one, a statement by someone else that disagrees becomes an open question that names both, and the room sees one quiet "Noted" line with Undo.
import { insertFact, normal } from "./factcore.ts";
import type { NewFact } from "./factcore.ts";
import { sameSubject, disagree, kindOf, placeOf } from "./place.ts";
import { mintId, readFact, rowsOf, str } from "./projections.ts";
import type { Fact, MemCtx } from "./projections.ts";
import { trail } from "./trail.ts";
import type { Audience } from "../../lib/audience.ts";

const TRACKED = new Set(["decision", "commitment", "preference", "role", "fact"]);

export interface SharedIn extends Omit<NewFact, "place" | "placeThread" | "audience"> { threadId: string; heard: Audience }
export interface SharedOut { fact: Fact; deduped?: boolean; replaced?: Fact; disputedWith?: Fact }

/** Current facts in the same place and layer that are on the same subject, newest first. */
function neighbours(ctx: MemCtx, n: SharedIn, placeKind: string, placeId: string): Fact[] {
  const rows = rowsOf(ctx.db,
    "SELECT * FROM memory_facts WHERE layer = ? AND owner_ref = ? AND COALESCE(agent_id, '') = ? AND COALESCE(project_id, '') = ? AND place_kind = ? AND place_id = ? AND status = 'current' AND trashed_at IS NULL ORDER BY learned_at DESC",
    n.layer, n.ownerRef, n.agentId ?? "", n.projectId ?? "", placeKind, placeId);
  return rows.map((r) => readFact(ctx, r)).filter((f) => f.text !== "");
}

export async function writeShared(ctx: MemCtx, n: SharedIn): Promise<SharedOut> {
  const place = await placeOf(ctx, n.threadId);
  const kind = kindOf(n.kind);
  const common: NewFact = { ...n, kind, place: { kind: place.kind, id: place.id, ...(place.parent ? { parent: place.parent } : {}) }, placeThread: n.threadId, audience: n.heard };
  const same = neighbours(ctx, n, place.kind, place.id);
  const dup = same.find((f) => normal(f.text) === normal(n.text));
  if (dup) return { fact: dup, deduped: true };
  let replaced: Fact | undefined;
  let clash: Fact | undefined;
  if (n.status === "current" && TRACKED.has(kind)) {
    for (const f of same) {
      if (kindOf(f.kind) !== kind || !sameSubject(f.text, n.text)) continue;
      if (f.sourcePerson === n.sourcePerson) { replaced = f; break; }
      if (disagree(f.text, n.text)) { clash = f; break; }
    }
  }
  const now = ctx.now();
  if (replaced) ctx.db.run("UPDATE memory_facts SET status = 'closed', valid_to = ?, closed_at = ? WHERE id = ?", now, now, replaced.id);
  const fact = insertFact(ctx, { ...common, ...(replaced ? { replaces: replaced.id } : {}), ...(clash ? { state: "disputed" } : {}) });
  if (replaced) trail(ctx, { action: "edit", factId: fact.id, layer: fact.layer, ownerRef: fact.ownerRef, agentId: fact.agentId, projectId: fact.projectId, reason: "a newer statement on the same subject", detail: { replaces: replaced.id } });
  if (clash) {
    ctx.db.run("UPDATE memory_facts SET state = 'disputed' WHERE id = ?", clash.id);
    ctx.db.run(
      "INSERT INTO memory_questions (id, kind, fact_a, fact_b, layer, owner_ref, agent_id, project_id, status, created_at, run_id) VALUES (?, 'contradiction', ?, ?, ?, ?, ?, ?, 'open', ?, NULL)",
      mintId("qst", now), clash.id, fact.id, fact.layer, fact.ownerRef, fact.agentId, fact.projectId, now,
    );
    trail(ctx, { action: "flag", factId: fact.id, layer: fact.layer, ownerRef: fact.ownerRef, agentId: fact.agentId, projectId: fact.projectId, reason: "two people, one subject", detail: { other: clash.id } });
  }
  return { fact: { ...fact, ...(clash ? { state: "disputed" } : {}) }, ...(replaced ? { replaced } : {}), ...(clash ? { disputedWith: clash } : {}) };
}

/** The line a room sees when something is remembered in it. Data only: kind, words, and the fact Undo acts on. The chat module draws it. */
export interface NotedLine { threadId: string; factId: string; kind: string; text: string; replaces?: string; disputed?: boolean }

/** Post the quiet "Noted: decision, go with Harbor . Undo" line through the chat module. Silent failure here would be remembering without telling the room, so a failure is logged, never swallowed quietly. */
export async function postNoted(ctx: MemCtx, line: NotedLine): Promise<boolean> {
  try {
    await ctx.call("chat.noted", line);
    return true;
  } catch (e) {
    ctx.log.warn("the room was not told what memory noted", { threadId: line.threadId, factId: line.factId, error: str((e as { message?: unknown })?.message) });
    return false;
  }
}

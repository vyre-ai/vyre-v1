// Writing a fact (shared by the fact handlers and by upkeep): the insert with its source links and trail line, the events that tell the feeds, and the text normal form that duplicate checks compare.
import { trail, whoIs } from "./trail.ts";
import type { TrailAction, Who } from "./trail.ts";
import { loadFact, mintId, raise, rowsOf, sealText, sourceLinkOf } from "./projections.ts";
import type { Fact, FactStatus, Layer, MemCtx, SourceKind } from "./projections.ts";
import { audienceText, placeAudienceText } from "../../lib/audience.ts";
import type { Audience } from "../../lib/audience.ts";

export const normal = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface NewFact {
  layer: Layer; ownerRef: string; agentId: string | null; projectId: string | null; noteId?: string | null; kind: string | null; text: string; validFrom: number;
  sourceKind: SourceKind; sourceRef: string; sourcePerson: string; proposedBy: string; status: FactStatus; lowRisk: boolean; replaces?: string | null;
  promotedFrom?: string | null; promotedBy?: string | null; promotedAt?: number | null; links?: Array<[string, string]>;
  /** The trail line this insert writes: create (the default), learn (captured by memory itself), edit (a correction), promote. */
  how?: TrailAction; why?: string; who?: Who; runId?: string;
  /** Learned in a chat other people read: kept for those people (lib/audience.ts). Undefined: what the fact it replaces or was promoted from was kept for, else open to its layer. */
  audience?: Audience | null;
  /** A link to the exact line the fact came from (a chat message), instead of the one the source kind and ref give. */
  sourceLink?: string;
  /** Rule 1 and 3: the place it was learned in, the chat that is its place now (read against who may open it), the message it came from, the words as written there. */
  place?: { kind: string; id: string; parent?: { kind: string; id: string } }; placeThread?: string; msgId?: string; span?: string; state?: string;
}

/** Insert one fact row (sealed when it is a person-layer fact) and its source links. */
export function insertFact(ctx: MemCtx, n: NewFact): Fact {
  const id = mintId("fct", ctx.now());
  const sealed = n.layer === "person";
  const link = n.sourceLink ?? sourceLinkOf(n.sourceKind, n.sourceRef);
  const subject = n.sourceKind === "record" ? n.sourceRef : null;
  ctx.db.run(
    "INSERT INTO memory_facts (id, layer, owner_ref, agent_id, project_id, note_id, kind, text, sealed, enc, valid_from, valid_to, learned_at, closed_at, source_kind, source_ref, source_link, source_person, proposed_by, status, low_risk, subject, replaces, promoted_from, promoted_by, promoted_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, n.layer, n.ownerRef, n.agentId, n.projectId, n.noteId ?? null, n.kind, sealed ? "" : n.text, sealed ? sealText(ctx, n.ownerRef, n.text) : null, sealed ? 2 : 0, n.validFrom,
    ctx.now(), n.sourceKind, n.sourceRef, link, n.sourcePerson, n.proposedBy, n.status, n.lowRisk ? 1 : 0, subject, n.replaces ?? null, n.promotedFrom ?? null, n.promotedBy ?? null, n.promotedAt ?? null,
  );
  // a correction, a merge or a promotion keeps who the words were for: a fact never leaves its audience by being rewritten
  const from = n.replaces ?? n.promotedFrom ?? null;
  const kept = n.audience !== undefined ? (n.audience === null ? null : audienceText(n.audience)) : from ? (rowsOf(ctx.db, "SELECT audience FROM memory_facts WHERE id = ?", from)[0]?.["audience"] ?? null) : null;
  if (kept !== null) ctx.db.run("UPDATE memory_facts SET audience = ? WHERE id = ?", kept, id);
  if (n.placeThread) ctx.db.run("UPDATE memory_facts SET audience = ? WHERE id = ?", placeAudienceText(n.audience ?? { space: false, people: [] }, n.placeThread, ctx.now()), id);
  if (n.place || n.msgId || n.span || n.state) {
    ctx.db.run("UPDATE memory_facts SET place_kind = ?, place_id = ?, parent_kind = ?, parent_id = ?, msg_id = ?, span = ?, state = ? WHERE id = ?",
      n.place?.kind ?? null, n.place?.id ?? null, n.place?.parent?.kind ?? null, n.place?.parent?.id ?? null, n.msgId ?? null,
      // the words as written are kept only for shared memory: a person-layer fact is sealed and its text must not sit in the clear in a second column
      sealed ? null : n.span ?? null, n.state ?? null, id);
  }
  ctx.db.run("INSERT OR IGNORE INTO memory_fact_links (fact_id, kind, ref) VALUES (?, 'came_from', ?)", id, n.sourceRef);
  for (const [k, ref] of n.links ?? []) ctx.db.run("INSERT OR IGNORE INTO memory_fact_links (fact_id, kind, ref) VALUES (?, ?, ?)", id, k, ref);
  const f = loadFact(ctx, id);
  if (!f) raise(ctx, "internal.unexpected", "The fact was not saved.");
  f.text = n.text;
  trail(ctx, {
    action: n.how ?? "create", factId: id, layer: n.layer, ownerRef: n.ownerRef, agentId: n.agentId, projectId: n.projectId, ...(n.who ? { who: n.who } : {}),
    source: `${n.sourceKind}:${n.sourceRef}`, ...(n.why ? { reason: n.why } : {}), ...(n.runId ? { runId: n.runId } : {}),
    detail: { status: n.status, from: n.sourcePerson, ...(n.replaces ? { replaces: n.replaces } : {}), ...(n.promotedFrom ? { promotedFrom: n.promotedFrom } : {}) },
  });
  return f;
}

export function emitProposed(ctx: MemCtx, f: Fact): void {
  ctx.emit("memory.fact_proposed", f.id, {
    factId: f.id, layer: f.layer, ownerRef: f.ownerRef, ...(f.agentId ? { agentId: f.agentId } : {}), sourceKind: f.sourceKind, sourceRef: f.sourceRef,
  });
}

export function emitAccepted(ctx: MemCtx, f: Fact, auto: boolean): void {
  ctx.emit("memory.fact_accepted", f.id, { factId: f.id, layer: f.layer, auto });
}

/** The Learned feed reads this: what was learned, from where and by whom (ids and places only, never the text). */
export function emitLearned(ctx: MemCtx, f: Fact, saved: boolean, who: Who = whoIs(ctx)): void {
  ctx.emit("memory.learned", f.id, {
    factId: f.id, layer: f.layer, ownerRef: f.ownerRef, ...(f.agentId ? { agentId: f.agentId } : {}), sourceKind: f.sourceKind, sourceRef: f.sourceRef, actor: who.actor, actorKind: who.kind,
    saved, from: f.sourcePerson,
  });
}


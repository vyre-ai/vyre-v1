// Memory by place (MEMORY-RULES 1, 3, 9): the Knows tab list of what Vyre remembers in a place, what happens to memory when a message in it is deleted, and when the place is archived or deleted.
import { actorOf, ensure, makeAccess, orNull, raise, readFact, rowsOf, str } from "../projections.ts";
import type { Fact, MemCtx } from "../projections.ts";
import { PLACE_KINDS, kindOf, stateOf } from "../place.ts";
import { trashFact } from "./lifecycle.ts";
import { trail } from "../trail.ts";

const placeRows = (ctx: MemCtx, kind: string, id: string): Fact[] =>
  rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE place_kind = ? AND place_id = ? ORDER BY learned_at DESC, id", kind, id).map((r) => readFact(ctx, r));

/** Knows tab: what Vyre remembers in one place that the caller may read, with where each came from. canEdit says whether Edit and Remove show. History adds replaced and removed ones. */
export async function placeList(ctx: MemCtx, input: { placeKind: string; placeId: string; history?: boolean }) {
  ensure(ctx.db);
  if (!(PLACE_KINDS as readonly string[]).includes(input.placeKind)) raise(ctx, "validation.bad_input", "That is not a kind of place.", { placeKind: input.placeKind });
  const access = makeAccess(ctx);
  const rows: Array<Record<string, unknown>> = [];
  for (const f of placeRows(ctx, input.placeKind, input.placeId)) {
    const state = f.trashedAt !== null || f.status === "removed" ? "removed" : stateOf(ctx.db, f);
    const live = f.status === "current" || f.status === "proposed";
    if (!live && !input.history) continue;
    if (!(await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view", f.audience))) continue;
    rows.push({
      factId: f.id, kind: kindOf(f.kind), text: f.text, state, said_by: f.sourcePerson, at: f.learnedAt, messageId: f.msgId, span: f.span, sourceLink: f.sourceLink, layer: f.layer,
      replaces: f.replaces, canEdit: await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "edit"),
    });
  }
  return { facts: rows };
}

/**
 * A message was deleted: what was derived from it goes (state source_removed, then dropped to Trash). A fact it replaced is current again. Only the person the words came from, someone who may edit
 * the memory, or an admin may do this; the chat module calls it for the person who deleted their own message.
 */
export async function sourceRemoved(ctx: MemCtx, input: { threadId: string; messageId: string }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const access = makeAccess(ctx, { write: true });
  const rows = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE msg_id = ? AND trashed_at IS NULL", input.messageId).map((r) => readFact(ctx, r));
  let dropped = 0;
  for (const f of rows) {
    if (!(f.sourcePerson === me || access.isAdmin() || (f.layer !== "person" && (await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "edit"))))) continue;
    ctx.db.run("UPDATE memory_facts SET state = 'source_removed' WHERE id = ?", f.id);
    trashFact(ctx, f, { reason: "source removed", action: "delete", source: `message:${input.messageId}` });
    dropped++;
    // the statement it replaced was true until then: it holds again
    if (f.replaces) {
      const old = rowsOf(ctx.db, "SELECT status FROM memory_facts WHERE id = ?", f.replaces)[0];
      if (old && str(old["status"]) === "closed") ctx.db.run("UPDATE memory_facts SET status = 'current', valid_to = NULL, closed_at = NULL WHERE id = ?", f.replaces);
    }
    // an open question that named it is moot, and the other side of a dispute is no longer disputed
    for (const q of rowsOf(ctx.db, "SELECT * FROM memory_questions WHERE status = 'open' AND (fact_a = ? OR fact_b = ?)", f.id, f.id)) {
      const other = str(q["fact_a"]) === f.id ? orNull(q["fact_b"]) : str(q["fact_a"]);
      ctx.db.run("UPDATE memory_questions SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution = 'drop' WHERE id = ?", ctx.now(), me, str(q["id"]));
      if (other) ctx.db.run("UPDATE memory_facts SET state = NULL WHERE id = ? AND state = 'disputed'", other);
    }
  }
  if (dropped > 0) ctx.emit("memory.removed", me, { factIds: rows.map((f) => f.id), by: me });
  return { dropped };
}

/** The place was archived (its memory is archived with it) or deleted (its memory is deleted). Whoever may edit the place's memory, or an admin. */
export async function placeArchive(ctx: MemCtx, input: { placeKind: string; placeId: string; action: "archive" | "delete" }) {
  ensure(ctx.db);
  if (!(PLACE_KINDS as readonly string[]).includes(input.placeKind)) raise(ctx, "validation.bad_input", "That is not a kind of place.", { placeKind: input.placeKind });
  const me = actorOf(ctx);
  const access = makeAccess(ctx, { write: true });
  let n = 0;
  for (const f of placeRows(ctx, input.placeKind, input.placeId)) {
    if (!(access.isAdmin() || (f.layer !== "person" && (await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "edit"))))) continue;
    if (input.action === "delete") {
      trail(ctx, { action: "erase", factId: f.id, layer: f.layer, ownerRef: f.ownerRef, agentId: f.agentId, projectId: f.projectId, reason: "place deleted" });
      for (const sql of [
        "DELETE FROM memory_fact_links WHERE fact_id = ?", "DELETE FROM memory_promotions WHERE fact_id = ?", "DELETE FROM memory_questions WHERE fact_a = ? OR fact_b = ?",
        "DELETE FROM memory_pointer_log WHERE ref = ?", "DELETE FROM memory_facts WHERE id = ?",
      ]) ctx.db.run(sql, f.id, ...(sql.includes("fact_a") ? [f.id] : []));
      try { ctx.db.run("DELETE FROM memory_vectors WHERE doc_kind = 'fact' AND doc_id = ?", f.id); } catch { /* no meaning index */ }
    } else {
      if (f.trashedAt === null) trashFact(ctx, f, { reason: "place archived", action: "delete", source: `place:${input.placeKind}:${input.placeId}` });
      ctx.db.run("UPDATE memory_facts SET archived_at = ?, archived_by = ? WHERE id = ?", ctx.now(), me, f.id);
    }
    n++;
  }
  ctx.emit("memory.removed", me, { factIds: [], by: me });
  return { facts: n };
}


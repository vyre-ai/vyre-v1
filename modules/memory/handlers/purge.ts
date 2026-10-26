// Erase one memory note for good (governance erase; P-CC_39): the note row with its body, the Markdown file in Files, its node in the memory graph with the edges and unresolved links that touch it, and
// the pointer from any fact that cited it. Facts are erased by memory.erase; a fact that cited this note stays but no longer points at it.
// DECISION: a note that is already gone answers `erased: false`. A file Files no longer has (not_found) is fine; any other refusal stops the erase before the note row is removed.
import { ensure, rowsOf, str } from "../projections.ts";
import type { MemCtx } from "../projections.ts";

const codeOf = (e: unknown): string => ((e as { error?: { code?: string } } | null)?.error?.code ?? "");

async function tolerant(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (e) { if (codeOf(e) !== "validation.not_found" && codeOf(e) !== "permission.not_found") throw e; }
}

export async function noteErase(ctx: MemCtx, input: { noteId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const note = rowsOf(ctx.db, "SELECT * FROM memory_notes WHERE note_id = ?", input.noteId)[0];
  if (!note) return { erased: false };
  const fileId = str(note["file_id"]);
  await tolerant(() => ctx.call("files.delete", { fileId }));
  await tolerant(() => ctx.call("files.purge", { fileId }));
  const node = `note:${fileId}`;
  ctx.db.run("DELETE FROM memory_graph_edges WHERE from_id = ?", node);
  ctx.db.run("DELETE FROM memory_graph_edges WHERE to_id = ?", node);
  ctx.db.run("DELETE FROM memory_graph_links WHERE from_id = ?", node);
  ctx.db.run("DELETE FROM memory_graph_nodes WHERE node_id = ?", node);
  ctx.db.run("DELETE FROM memory_layouts WHERE node_id = ?", node);
  ctx.db.run("UPDATE memory_facts SET note_id = ? WHERE note_id = ?", null, input.noteId);
  ctx.db.run("DELETE FROM memory_notes WHERE note_id = ?", input.noteId);
  ctx.emit("note.erased", `entity/${input.noteId}`, { noteId: input.noteId });
  return { erased: true };
}

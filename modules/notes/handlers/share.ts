// Notes: share, delete with Undo, restore (lane L2). Only the owner shares. The owner's delete is a soft delete; a person it was shared with removes it from their own notes only.
import { emit, noteOut, peopleOf, personOf, personReads, raise, rowById, sharedWith } from "../projections.ts";
import type { NotesCtx, Share, SpaceShare } from "../projections.ts";
import { saveNote } from "./notes.ts";

type ShareIn = { noteId: string; people?: { personId: string; role: "edit" | "view" | "remove" }[]; space?: SpaceShare };
export async function shareNote(ctx: NotesCtx, input: ShareIn) {
  const person = personOf(ctx);
  const r = rowById(ctx, input.noteId);
  if (!r || r.deleted_at !== null || !person || !personReads(r, person) || ctx.principal.kind !== "person") raise(ctx.trace.traceId, "validation.not_found", "There is no such note.");
  if (r.owner !== person) raise(ctx.trace.traceId, "permission.no_grant", "Only the person who made a note shares it.");
  const people = peopleOf(r);
  for (const p of input.people ?? []) {
    if (p.personId === r.owner) continue;
    if (p.role === "remove") delete people[p.personId];
    else people[p.personId] = { role: p.role, removed_at: null };
  }
  r.share_people_json = JSON.stringify(people);
  if (input.space) r.share_space = input.space;
  r.updated_at = ctx.now();
  saveNote(ctx, r);
  emit(ctx, "notes.shared", r, { people: sharedWith(r).map(([p]) => p), space: r.share_space });
  return { note: noteOut(r, person) };
}

export async function deleteNote(ctx: NotesCtx, input: { noteId: string }) {
  const person = personOf(ctx);
  const r = rowById(ctx, input.noteId);
  if (!r || r.deleted_at !== null || !person || !personReads(r, person) || ctx.principal.kind !== "person") raise(ctx.trace.traceId, "validation.not_found", "There is no such note.");
  const now = ctx.now();
  if (r.owner === person) {
    r.deleted_at = now;
  } else {
    const people = peopleOf(r);
    const s: Share | undefined = people[person];
    people[person] = s ? { ...s, removed_at: now } : { role: "view", removed_at: now, space_only: true };
    r.share_people_json = JSON.stringify(people);
  }
  saveNote(ctx, r);
  emit(ctx, "notes.deleted", r);
  return { deleted: true, undo: { noteId: r.id } };
}

export async function restoreNote(ctx: NotesCtx, input: { noteId: string }) {
  const person = personOf(ctx);
  const r = rowById(ctx, input.noteId);
  const s = r && person ? peopleOf(r)[person] : undefined;
  const ownerUndo = !!r && r.owner === person && r.deleted_at !== null;
  const readerUndo = !!r && r.deleted_at === null && !!s && s.removed_at !== null;
  if (!r || !person || ctx.principal.kind !== "person" || (!ownerUndo && !readerUndo)) raise(ctx.trace.traceId, "validation.not_found", "There is nothing to bring back.");
  if (ownerUndo) r.deleted_at = null;
  else {
    const people = peopleOf(r);
    if (people[person]!.space_only) delete people[person];
    else people[person] = { ...people[person]!, removed_at: null };
    r.share_people_json = JSON.stringify(people);
  }
  saveNote(ctx, r);
  emit(ctx, "notes.restored", r);
  return { note: noteOut(r, person) };
}

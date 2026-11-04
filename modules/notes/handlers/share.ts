// Notes: share, delete with Undo, restore (lane L2). Only the owner shares. The owner's delete is a soft delete; a person it was shared with removes it from their own notes only.
import { TABLE, emit, noteOut, peopleOf, personOf, personReads, raise, rowById, sharedWith } from "../projections.ts";
import type { NotesCtx, Share, SpaceShare } from "../projections.ts";
import { saveNote } from "./notes.ts";

type ShareIn = { noteId: string; people?: { personId: string; role: "edit" | "view" | "remove" }[]; space?: SpaceShare; notify?: { message?: string } };
export async function shareNote(ctx: NotesCtx, input: ShareIn) {
  const person = personOf(ctx);
  const r = rowById(ctx, input.noteId);
  if (!r || r.deleted_at !== null || !person || !personReads(r, person) || ctx.principal.kind !== "person") raise(ctx.trace.traceId, "validation.not_found", "There is no such note.");
  if (r.owner !== person) raise(ctx.trace.traceId, "permission.no_grant", "Only the person who made a note shares it.");
  const people = peopleOf(r);
  const told: string[] = [];
  for (const p of input.people ?? []) {
    if (p.personId === r.owner) continue;
    if (p.role === "remove") delete people[p.personId];
    else { if (!people[p.personId] || people[p.personId]?.removed_at) told.push(p.personId); people[p.personId] = { role: p.role, removed_at: null }; }
  }
  r.share_people_json = JSON.stringify(people);
  if (input.space) r.share_space = input.space;
  r.updated_at = ctx.now();
  saveNote(ctx, r);
  emit(ctx, "notes.shared", r, { people: sharedWith(r).map(([p]) => p), space: r.share_space });
  // the sharer asked to tell the people just added: a notification and an Inbox line, "Irfad shared Lab 8 notes with you"
  if (input.notify !== undefined && told.length > 0) {
    const name = await ctx.call("access.principals.get", { principal: { kind: "person", id: person } }).then((o) => (o as { principal?: { name?: string } } | null)?.principal?.name, () => undefined);
    const note = input.notify.message?.trim();
    for (const to of told) {
      await ctx.call("notifications.send", { to, kind: "item.shared", subject: { type: "note", id: r.id }, title: r.title || "a note", data: { from: name || "Someone", ...(note ? { message: note } : {}) }, collapseKey: `item.shared:${r.id}:${to}` }).catch(() => undefined);
    }
  }
  return { note: noteOut(r, person) };
}

/** Hand the note to someone it is shared with. The previous owner keeps Edit, the new owner leaves the people list and becomes the owner. */
export async function setNoteOwner(ctx: NotesCtx, input: { noteId: string; personId: string }) {
  const person = personOf(ctx);
  const r = rowById(ctx, input.noteId);
  if (!r || r.deleted_at !== null || !person || !personReads(r, person) || ctx.principal.kind !== "person") raise(ctx.trace.traceId, "validation.not_found", "There is no such note.");
  if (r.owner !== person) raise(ctx.trace.traceId, "permission.no_grant", "Only the person who made a note hands it over.");
  if (input.personId === person) raise(ctx.trace.traceId, "validation.bad_input", "The note is already yours.");
  const people = peopleOf(r);
  if (!people[input.personId] || people[input.personId]?.removed_at) raise(ctx.trace.traceId, "validation.bad_input", "Share the note with them first.");
  delete people[input.personId];
  people[person] = { role: "edit", removed_at: null };
  r.owner = input.personId;
  r.share_people_json = JSON.stringify(people);
  r.updated_at = ctx.now();
  saveNote(ctx, r);
  ctx.db.run(`UPDATE ${TABLE} SET owner = ? WHERE id = ?`, r.owner, r.id);   // the owner is not part of an ordinary save
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

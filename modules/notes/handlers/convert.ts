// Notes: turn into task, turn into record, and clip from Vyre for Chrome (lane L2). A task or record made from a note keeps the note's id as its source, and the note keeps the new id
// in linked_json, so each opens the other. With keep false the note is archived: it leaves the grid but still opens from the task or record.
import { checkUrl, cleanLabels, decodeImage, emit, linkedOf, noteOut, personOf, raise, readable, searchText, storeImage } from "../projections.ts";
import type { ImageIn, Linked, NoteRow, NotesCtx } from "../projections.ts";
import { blankNote, insertNote, noteId, priorByKey, saveNote } from "./notes.ts";

const firstLine = (s: string): string => s.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "";
const nameOf = (r: NoteRow): string => r.title || firstLine(r.body) || "Untitled note";

function link(ctx: NotesCtx, r: NoteRow, item: Linked, keep: boolean | undefined): void {
  const all = linkedOf(r);
  if (!all.some((x) => x.kind === item.kind && x.id === item.id)) all.push(item);
  r.linked_json = JSON.stringify(all);
  if (keep === false) r.archived_at = ctx.now();
  r.updated_at = ctx.now();
  saveNote(ctx, r);
  emit(ctx, "notes.linked", r, { kind: item.kind, id: item.id });
}

type TaskIn = { noteId: string; title?: string; assigned?: { kind: "person" | "agent"; id: string }; due?: number; keep?: boolean; idempotencyKey: string };
export async function toTask(ctx: NotesCtx, input: TaskIn) {
  const r = await readable(ctx, input.noteId);
  const person = personOf(ctx)!;
  const title = (input.title ?? "").trim() || nameOf(r);
  const summary = [r.body.trim(), `From the note "${nameOf(r)}"`].filter(Boolean).join("\n\n").slice(0, 8000);
  const out = (await ctx.call("tasks.create", {
    title, summary, assigned: input.assigned ?? { kind: "person", id: person }, ...(input.due !== undefined ? { due: input.due } : {}),
    source: { kind: "manual", id: r.id }, idempotencyKey: `${input.idempotencyKey}:task`,
  })) as { task?: { id?: string } } | null;
  const taskId = out?.task?.id;
  if (!taskId) raise(ctx.trace.traceId, "internal.unexpected", "The task was not made.");
  link(ctx, r, { kind: "task", id: taskId, title, at: ctx.now() }, input.keep);
  return { note: noteOut(r, person), taskId };
}

type RecordIn = { noteId: string; type: string; fields: Record<string, unknown>; keep?: boolean; idempotencyKey: string };
export async function toRecord(ctx: NotesCtx, input: RecordIn) {
  const r = await readable(ctx, input.noteId);
  const person = personOf(ctx)!;
  const out = (await ctx.call("records.create", { type: input.type, fields: input.fields, idempotencyKey: `${input.idempotencyKey}:record` })) as { record?: { id?: string } } | null;
  const recordId = out?.record?.id;
  if (!recordId) raise(ctx.trace.traceId, "internal.unexpected", "The record was not made.");
  const f = input.fields;
  const title = [f["name"], f["title"]].find((v): v is string => typeof v === "string" && v.length > 0) ?? nameOf(r);
  link(ctx, r, { kind: "record", id: recordId, title, at: ctx.now() }, input.keep);
  return { note: noteOut(r, person), recordId };
}

type ClipIn = { url: string; title?: string; selection?: string; note?: string; screenshot?: ImageIn; labels?: string[]; idempotencyKey?: string };
export async function clipPage(ctx: NotesCtx, input: ClipIn) {
  const person = ctx.principal.kind === "person" ? ctx.principal.id : null;
  if (!person) raise(ctx.trace.traceId, "permission.no_grant", "A person clips a page.");
  const prior = priorByKey(ctx, person, input.idempotencyKey);
  if (prior) return { note: noteOut(prior, person) };
  const url = checkUrl(ctx, input.url);
  const bytes = input.screenshot ? decodeImage(ctx, input.screenshot) : null;
  const shot = bytes ? await storeImage(ctx, bytes, input.screenshot!.contentType) : null;
  const now = ctx.now();
  const title = (input.title ?? "").trim() || new URL(url).hostname.replace(/^www\./, "");
  const selection = (input.selection ?? "").trim();
  const r = blankNote(noteId(), person, now);
  Object.assign(r, {
    title, body: input.note ?? "", labels_json: JSON.stringify(cleanLabels(input.labels)), shot_blob: shot,
    clip_json: JSON.stringify({ url, ...(input.title ? { title: input.title.trim() } : {}), ...(selection ? { selection } : {}), at: now }), idem_key: input.idempotencyKey ?? null,
  });
  r.search_text = searchText(r);
  insertNote(ctx, r);
  emit(ctx, "notes.clipped", r);
  return { note: noteOut(r, person) };
}

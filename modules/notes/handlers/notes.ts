// Notes: take, read, list, search, change, pin and label (lane L2). Every handler checks and raises before its first write (raise-after-write).
import {
  applyLink, askerAudience, checkUrl, cleanLabels, decodeImage, editable, emit, labelsOf, linkOf, mayRead, noteOut, page, personOf, raise, readable, searchText, storeImage, TABLE, unfurl, urlIn, checkFrom,
} from "../projections.ts";
import type { ImageIn, NoteRow, NotesCtx, Unfurled } from "../projections.ts";

type Color = "" | "rose" | "sand" | "sage" | "sky" | "lilac" | "slate";
const COLS = "id, owner, title, body, color, pinned, labels_json, image_blob, image_type, link_json, clip_json, shot_blob, link_blob, link_blob_type, from_json, linked_json, share_people_json, share_space, search_text, idem_key, created_at, updated_at, deleted_at, archived_at";

export function insertNote(ctx: NotesCtx, r: NoteRow): void {
  ctx.db.run(`INSERT INTO ${TABLE} (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id, r.owner, r.title, r.body, r.color, r.pinned, r.labels_json, r.image_blob, r.image_type, r.link_json, r.clip_json, r.shot_blob, r.link_blob, r.link_blob_type, r.from_json, r.linked_json, r.share_people_json, r.share_space,
    r.search_text, r.idem_key, r.created_at, r.updated_at, r.deleted_at, r.archived_at);
}
/** Write every changeable column of a row back, with its search text. */
export function saveNote(ctx: NotesCtx, r: NoteRow): void {
  r.search_text = searchText(r);
  ctx.db.run(`UPDATE ${TABLE} SET title = ?, body = ?, color = ?, pinned = ?, labels_json = ?, image_blob = ?, image_type = ?, link_json = ?, link_blob = ?, link_blob_type = ?, linked_json = ?, share_people_json = ?, share_space = ?, search_text = ?, updated_at = ?, deleted_at = ?, archived_at = ? WHERE id = ?`,
    r.title, r.body, r.color, r.pinned, r.labels_json, r.image_blob, r.image_type, r.link_json, r.link_blob, r.link_blob_type, r.linked_json, r.share_people_json, r.share_space, r.search_text, r.updated_at, r.deleted_at, r.archived_at, r.id);
}
export function blankNote(id: string, owner: string, now: number): NoteRow {
  return {
    id, owner, title: "", body: "", color: "", pinned: 0, labels_json: "[]", image_blob: null, image_type: null, link_json: null, clip_json: null, shot_blob: null, link_blob: null, link_blob_type: null, from_json: null,
    linked_json: "[]", share_people_json: "{}", share_space: "off", search_text: "", idem_key: null, created_at: now, updated_at: now, deleted_at: null, archived_at: null,
  };
}
export function priorByKey(ctx: NotesCtx, owner: string, key: string | undefined): NoteRow | undefined {
  if (!key) return undefined;
  return ctx.db.all(`SELECT * FROM ${TABLE} WHERE owner = ? AND idem_key = ?`, owner, key)[0] as NoteRow | undefined;
}
const nid = (): string => {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return `nte_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};
export { nid as noteId };

type CreateIn = { title?: string; body?: string; color?: Color; pinned?: boolean; labels?: string[]; image?: ImageIn; link?: string; source?: { threadId: string; messageId: string }; idempotencyKey?: string };
/** The chat message a note is saved from, checked: the caller reads that chat (threads.get answers a chat they may not read as not found) and the message is in it. An agent names only the chat it is in. */
async function sourceOf(ctx: NotesCtx, src: { threadId: string; messageId: string }): Promise<string> {
  if (ctx.principal.kind === "agent" && ctx.thread !== src.threadId) raise(ctx.trace.traceId, "validation.not_found", "A note can be saved from the chat you are in.");
  let title = "A chat";
  try {
    const t = ((await ctx.call("threads.get", { threadId: src.threadId })) as { thread?: { title?: string } } | null)?.thread;
    if (!t) throw new Error("none");
    title = t.title || title;
  } catch { raise(ctx.trace.traceId, "validation.not_found", "There is no such chat."); }
  let at = ctx.now();
  try {
    const m = ((await ctx.call("chat.message.get", { threadId: src.threadId, messageId: src.messageId })) as { message?: { createdAt?: number } } | null)?.message;
    if (!m) throw new Error("none");
    if (typeof m.createdAt === "number") at = m.createdAt;
  } catch { raise(ctx.trace.traceId, "validation.not_found", "There is no such message in that chat."); }
  return JSON.stringify({ threadId: src.threadId, messageId: src.messageId, title, at });
}
/** An agent saving from the chat it is in, naming no message: the chat's latest message. */
async function latestIn(ctx: NotesCtx, threadId: string): Promise<{ threadId: string; messageId: string } | null> {
  try {
    const out = (await ctx.call("chat.messages.list", { threadId, limit: 1 })) as { messages?: { messageId: string }[] } | null;
    const m = out?.messages?.at(-1);
    return m ? { threadId, messageId: m.messageId } : null;
  } catch { return null; }
}

export async function createNote(ctx: NotesCtx, input: CreateIn) {
  const person = personOf(ctx);
  if (!person) raise(ctx.trace.traceId, "permission.no_grant", "Only a person, or an agent for a person, takes notes.");
  const prior = priorByKey(ctx, person, input.idempotencyKey);
  if (prior) return { note: noteOut(prior, person) };
  const title = (input.title ?? "").trim();
  const body = input.body ?? "";
  // a link of its own, else the first address in the words: the card for it, so a pasted or typed address is never left as plain text
  const url = input.link ? checkUrl(ctx, input.link) : urlIn(body);
  const bytes = input.image ? decodeImage(ctx, input.image) : null;
  if (!title && !body.trim() && !url && !bytes) raise(ctx.trace.traceId, "validation.bad_input", "A note needs a title, text, an image or a link.");
  const src = input.source ?? (ctx.principal.kind === "agent" && ctx.thread ? await latestIn(ctx, ctx.thread) : null);
  const from = src ? await sourceOf(ctx, src) : null;
  const read: Unfurled | null = url ? await unfurl(ctx, url) : null;
  const blob = bytes ? await storeImage(ctx, bytes, input.image!.contentType) : null;
  const r = blankNote(nid(), person, ctx.now());
  Object.assign(r, {
    title, body, color: input.color ?? "", pinned: input.pinned ? 1 : 0, labels_json: JSON.stringify(cleanLabels(input.labels)),
    image_blob: blob, image_type: blob ? input.image!.contentType : null, idem_key: input.idempotencyKey ?? null, from_json: from,
  });
  await applyLink(ctx, r, read);
  r.search_text = searchText(r);
  insertNote(ctx, r);
  emit(ctx, "notes.created", r);
  return { note: noteOut(r, person) };
}

export async function getNote(ctx: NotesCtx, input: { noteId: string }) {
  const r = await readable(ctx, input.noteId);
  return { note: (await checkFrom(ctx, [noteOut(r, personOf(ctx))]))[0]! };
}

/** Every note the caller reads: their own, those shared with them, those shared with the Space. Deleted and archived notes stay out. */
async function visible(ctx: NotesCtx, extra = "", ...args: unknown[]): Promise<NoteRow[]> {
  const person = personOf(ctx);
  if (!person) return [];
  const rows = ctx.db.all(`SELECT * FROM ${TABLE} WHERE deleted_at IS NULL AND archived_at IS NULL AND (owner = ? OR share_space != 'off' OR instr(share_people_json, ?) > 0)${extra}`, person, `"${person}"`, ...args) as NoteRow[];
  const aud = await askerAudience(ctx);
  return rows.filter((r) => mayRead(ctx, r, aud)).sort((a, b) => b.pinned - a.pinned || b.updated_at - a.updated_at);
}

export async function listNotes(ctx: NotesCtx, input: { label?: string; q?: string; from?: "all" | "mine" | "shared"; cursor?: string; limit?: number }) {
  const person = personOf(ctx);
  let rows = await visible(ctx);
  const counts = new Map<string, number>();
  for (const r of rows) for (const l of labelsOf(r)) counts.set(l, (counts.get(l) ?? 0) + 1);
  if (input.from === "mine") rows = rows.filter((r) => r.owner === person);
  if (input.from === "shared") rows = rows.filter((r) => r.owner !== person);
  if (input.label) { const l = input.label.toLowerCase(); rows = rows.filter((r) => labelsOf(r).some((x) => x.toLowerCase() === l)); }
  const q = (input.q ?? "").trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.search_text.includes(q));
  const p = page(rows, input.cursor, input.limit);
  return {
    notes: await checkFrom(ctx, p.rows.map((r) => noteOut(r, person))),
    labels: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    ...(p.next ? { next: p.next } : {}), total: p.total,
  };
}

function snippet(r: NoteRow, q: string): string {
  const text = [r.body, linkOf(r)?.title ?? ""].join(" ").replace(/\s+/g, " ").trim();
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, 160);
  const from = Math.max(0, i - 60);
  return (from > 0 ? "..." : "") + text.slice(from, from + 160);
}
export async function searchNotes(ctx: NotesCtx, input: { q: string; limit?: number }) {
  const q = input.q.trim().toLowerCase();
  if (!q) return { notes: [] };
  const rows = await visible(ctx, " AND instr(search_text, ?) > 0", q);
  return { notes: rows.slice(0, input.limit ?? 10).map((r) => ({ noteId: r.id, title: r.title || linkOf(r)?.title || "", snippet: snippet(r, q), labels: labelsOf(r), owner: r.owner, updatedAt: r.updated_at })) };
}

/** A note's picture (its image, or a clip's screenshot), or with part "link" its link card's picture: served from the notes blobs to someone who may read the note. */
export async function noteImage(ctx: NotesCtx, input: { noteId: string; part?: "image" | "link" }) {
  const r = await readable(ctx, input.noteId);
  const id = input.part === "link" ? r.link_blob : r.image_blob ?? r.shot_blob;
  if (!id || !ctx.blobs) raise(ctx.trace.traceId, "validation.not_found", "This note has no image.");
  const got = await ctx.blobs.get(id);
  if (!got) raise(ctx.trace.traceId, "validation.not_found", "This note has no image.");
  return { contentType: got.meta.contentType, data: Buffer.from(got.bytes).toString("base64") };
}

type UpdateIn = { noteId: string; title?: string; body?: string; color?: Color; image?: ImageIn | null; link?: string | null };
export async function updateNote(ctx: NotesCtx, input: UpdateIn) {
  const r = await editable(ctx, input.noteId);
  const url = typeof input.link === "string" ? checkUrl(ctx, input.link) : null;
  const bytes = input.image ? decodeImage(ctx, input.image) : null;
  const before = r.body;
  if (input.title !== undefined) r.title = input.title.trim();
  if (input.body !== undefined) r.body = input.body;
  if (input.color !== undefined) r.color = input.color;
  if (input.link === null) await applyLink(ctx, r, null);
  else if (url && linkOf(r)?.url !== url) await applyLink(ctx, r, await unfurl(ctx, url));
  else if (input.link === undefined && input.body !== undefined && !linkOf(r)) {
    // an address that is new in the words, on a note with no card: read it
    const typed = urlIn(input.body);
    if (typed && typed !== urlIn(before)) await applyLink(ctx, r, await unfurl(ctx, typed));
  }
  if (input.image === null) { r.image_blob = null; r.image_type = null; }
  else if (bytes) { r.image_blob = await storeImage(ctx, bytes, input.image!.contentType); r.image_type = input.image!.contentType; }
  r.updated_at = ctx.now();
  saveNote(ctx, r);
  emit(ctx, "notes.updated", r, { by: ctx.principal.id });
  return { note: noteOut(r, personOf(ctx)) };
}

export async function pinNote(ctx: NotesCtx, input: { noteId: string; pinned: boolean }) {
  const r = await editable(ctx, input.noteId);
  r.pinned = input.pinned ? 1 : 0;
  r.updated_at = ctx.now();
  saveNote(ctx, r);
  emit(ctx, "notes.updated", r, { by: ctx.principal.id });
  return { note: noteOut(r, personOf(ctx)) };
}

export async function labelNote(ctx: NotesCtx, input: { noteId: string; add?: string[]; remove?: string[] }) {
  const r = await editable(ctx, input.noteId);
  const gone = new Set((input.remove ?? []).map((x) => x.trim().toLowerCase()));
  r.labels_json = JSON.stringify(cleanLabels([...labelsOf(r).filter((l) => !gone.has(l.toLowerCase())), ...(input.add ?? [])]));
  r.updated_at = ctx.now();
  saveNote(ctx, r);
  emit(ctx, "notes.updated", r, { by: ctx.principal.id });
  return { note: noteOut(r, personOf(ctx)) };
}

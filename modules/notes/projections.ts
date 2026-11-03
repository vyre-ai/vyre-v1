// Notes (lane L2): the row, the ctx the handlers use, and the one access rule. A note is read by its owner, by the people it is shared with (until they remove it from their own
// notes), and by everyone in the Space when it is shared with the Space. An agent reads a note only for a person who reads it, and only when everyone who reads the agent's chat
// reads it too (lib/audience.ts): a private note reads in its owner's own chats and never in a channel; a shared note follows its share. Anyone else is told the note does not exist.
import { fail } from "../../host/src/routes/errors.ts";
import { chatAudience, SPACE_WIDE, within } from "../../lib/audience.ts";
import type { Audience } from "../../lib/audience.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface BlobMeta { id: string; contentType: string; size: number }
export interface Blobs {
  put(bytes: Uint8Array, contentType: string, opts?: { resource?: { type: string; id: string } }): Promise<BlobMeta>;
  get(id: string): Promise<{ meta: BlobMeta; bytes: Uint8Array } | null>;
}

/** The part of the host Ctx the handlers use. */
export interface NotesCtx {
  space: string;
  principal: { kind: string; id: string };
  /** The person an agent acts for. */
  actingFor?: string;
  /** The chat an agent was asked in. */
  thread?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: string }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  blobs?: Blobs;
  log?: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Role = "edit" | "view";
export type SpaceShare = "off" | "view" | "edit";
/** `space_only`: a Space reader who removed a Space-shared note from their own notes; the entry only hides it from them. */
export interface Share { role: Role; removed_at: number | null; space_only?: boolean }
export interface Link { url: string; title?: string; siteName?: string; image?: string; description?: string }
export interface Clip { url: string; title?: string; selection?: string; at: number }
export interface Linked { kind: "task" | "record"; id: string; title: string; at: number }

export interface NoteRow {
  id: string; owner: string; title: string; body: string; color: string; pinned: number; labels_json: string;
  image_blob: string | null; image_type: string | null; link_json: string | null; clip_json: string | null; shot_blob: string | null;
  linked_json: string; share_people_json: string; share_space: SpaceShare; search_text: string; idem_key: string | null;
  created_at: number; updated_at: number; deleted_at: number | null; archived_at: number | null;
}

export const TABLE = "notes_notes";

type Code = Parameters<typeof fail>[0];
export function raise(traceId: string, code: Code, message?: string): never {
  throw fail(code, traceId, message ? { message } : {});
}

export function nid(prefix: string): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return `${prefix}_${s}`;
}

const parse = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
};
export const labelsOf = (r: NoteRow): string[] => parse<string[]>(r.labels_json, []);
export const peopleOf = (r: NoteRow): Record<string, Share> => parse<Record<string, Share>>(r.share_people_json, {});
export const linkOf = (r: NoteRow): Link | null => parse<Link | null>(r.link_json, null);
export const clipOf = (r: NoteRow): Clip | null => parse<Clip | null>(r.clip_json, null);
export const linkedOf = (r: NoteRow): Linked[] => parse<Linked[]>(r.linked_json, []);

/** The people who read it now, besides the owner. */
export const sharedWith = (r: NoteRow): [string, Role][] => Object.entries(peopleOf(r)).filter(([, s]) => s.removed_at === null && !s.space_only).map(([p, s]) => [p, s.role]);

/** The text notes.search and notes.list look in. */
export function searchText(r: Pick<NoteRow, "title" | "body" | "labels_json" | "link_json" | "clip_json">): string {
  const l = parse<Link | null>(r.link_json, null);
  const c = parse<Clip | null>(r.clip_json, null);
  return [r.title, r.body, ...parse<string[]>(r.labels_json, []), l?.url, l?.title, l?.siteName, c?.url, c?.title, c?.selection].filter(Boolean).join("\n").toLowerCase();
}

/* ---------- who reads a note ---------- */

/** Does this person read the note? */
export function personReads(r: NoteRow, person: string): boolean {
  if (r.owner === person) return true;
  const s = peopleOf(r)[person];
  if (s && s.removed_at !== null) return false;   // they removed it from their own notes
  if (r.share_space !== "off") return true;
  return !!s;
}
/** Does this person change it? Sharing stays with the owner. */
export function personEdits(r: NoteRow, person: string): boolean {
  if (r.owner === person) return true;
  if (!personReads(r, person)) return false;
  return peopleOf(r)[person]?.role === "edit" || r.share_space === "edit";
}
/** Everyone who reads the note, as an audience. */
export function readersOf(r: NoteRow): Audience {
  return r.share_space !== "off" ? { space: true, people: [] } : { space: false, people: [r.owner, ...sharedWith(r).map(([p]) => p)] };
}

/** The person a call is for: a person, or the person an agent acts for. An agent acting for nobody reads nothing. */
export function personOf(ctx: NotesCtx): string | null {
  if (ctx.principal.kind === "person") return ctx.principal.id;
  if (ctx.principal.kind === "agent" && typeof ctx.actingFor === "string" && ctx.actingFor.startsWith("usr_")) return ctx.actingFor;
  return null;
}

/** The audience of the chat an agent asks from; no chat counts as the whole Space, so only a note shared with the Space reads there. Read once per call. */
export async function askerAudience(ctx: NotesCtx): Promise<Audience | null> {
  if (ctx.principal.kind !== "agent") return null;
  if (!ctx.thread) return SPACE_WIDE;
  return chatAudience((cap, input) => ctx.call(cap, input), ctx.thread);
}

/** May the caller read the note? For an agent, `aud` is the audience of its chat (askerAudience). */
export function mayRead(ctx: NotesCtx, r: NoteRow, aud: Audience | null): boolean {
  if (r.deleted_at !== null) return false;
  const person = personOf(ctx);
  if (!person || !personReads(r, person)) return false;
  if (ctx.principal.kind === "agent") return aud !== null && within(aud, readersOf(r));
  return ctx.principal.kind === "person";
}

export const rowById = (ctx: { db: Db }, id: string): NoteRow | undefined => ctx.db.all(`SELECT * FROM ${TABLE} WHERE id = ?`, id)[0] as NoteRow | undefined;

/** The note the caller may read, or not_found (a note someone may not read does not exist for them). */
export async function readable(ctx: NotesCtx, id: string): Promise<NoteRow> {
  const r = rowById(ctx, id);
  const aud = await askerAudience(ctx);
  if (!r || !mayRead(ctx, r, aud)) raise(ctx.trace.traceId, "validation.not_found", "There is no such note.");
  return r;
}
/** The note the caller may change, or not_found. An agent changes a note only where it may also read it, since the answer carries the note. */
export async function editable(ctx: NotesCtx, id: string): Promise<NoteRow> {
  const r = rowById(ctx, id);
  const person = personOf(ctx);
  const aud = await askerAudience(ctx);
  if (!r || r.deleted_at !== null || !person || !personEdits(r, person) || !mayRead(ctx, r, aud)) raise(ctx.trace.traceId, "validation.not_found", "There is no such note.");
  return r;
}

/* ---------- the note as the contract returns it ---------- */

export function noteOut(r: NoteRow, viewer: string | null) {
  const link = linkOf(r);
  const clip = clipOf(r);
  return {
    noteId: r.id, owner: r.owner, title: r.title, body: r.body, color: r.color as "", pinned: r.pinned === 1, labels: labelsOf(r),
    hasImage: !!(r.image_blob || r.shot_blob),
    ...(link ? { link } : {}),
    ...(clip ? { clip: { url: clip.url, ...(clip.title ? { title: clip.title } : {}), ...(clip.selection ? { selection: clip.selection } : {}), hasShot: !!r.shot_blob, at: clip.at } } : {}),
    linked: linkedOf(r),
    share: { people: sharedWith(r).map(([personId, role]) => ({ personId, role })), space: r.share_space },
    mine: viewer === r.owner, canEdit: viewer !== null && personEdits(r, viewer),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Events carry ids only and go to the owner: nothing about a note's content leaves the module. */
export function emit(ctx: NotesCtx, name: string, r: NoteRow, extra: Record<string, unknown> = {}): void {
  ctx.emit(name, r.id, { noteId: r.id, owner: r.owner, ...extra }, { vis: "owner" });
}

/* ---------- images and links ---------- */

const MAX_IMAGE = 10 * 1024 * 1024;
export interface ImageIn { data: string; contentType: string }

/** Decode and check an image before anything is written. */
export function decodeImage(ctx: NotesCtx, img: ImageIn): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(img.data, "base64"));
  if (bytes.byteLength === 0) raise(ctx.trace.traceId, "validation.bad_input", "The image is empty.");
  if (bytes.byteLength > MAX_IMAGE) raise(ctx.trace.traceId, "validation.bad_input", "The image is over 10 MB.");
  if (!ctx.blobs) raise(ctx.trace.traceId, "internal.unexpected", "Images cannot be stored here.");
  return bytes;
}
/** Store an image as the module's own blob: with no resource, so the blob route never serves it. */
export async function storeImage(ctx: NotesCtx, bytes: Uint8Array, contentType: string): Promise<string> {
  const meta = await ctx.blobs!.put(bytes, contentType);
  return meta.id;
}

/** Only an https or http address is a link; anything else is refused before a write. */
export function checkUrl(ctx: NotesCtx, url: string): string {
  const u = url.trim();
  let parsed: URL | null = null;
  try { parsed = new URL(u); } catch { parsed = null; }
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) raise(ctx.trace.traceId, "validation.bad_input", "A link starts with https://.");
  return parsed.toString();
}

/** Read a link through the one public fetch path (automations.read_link) for its title, image and site name. A link that cannot be read stays a plain link. */
export async function unfurl(ctx: NotesCtx, url: string): Promise<Link> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  try {
    const out = (await ctx.call("automations.read_link", { url })) as { ok?: boolean; finalUrl?: string; meta?: { title?: string; siteName?: string; image?: string; description?: string } } | null;
    if (!out || out.ok !== true) return { url, siteName: host };
    const m = out.meta ?? {};
    const link: Link = { url, siteName: m.siteName || host };
    if (m.title) link.title = m.title.slice(0, 300);
    if (m.image && /^https:\/\//.test(m.image)) link.image = m.image;
    if (m.description) link.description = m.description.slice(0, 500);
    return link;
  } catch {
    ctx.log?.warn("link not read", { note: "unfurl" });
    return { url, siteName: host };
  }
}

export function cleanLabels(xs: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const x of xs ?? []) {
    const v = x.trim().slice(0, 40);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 100));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const out: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) out.next = String(start + rows.length);
  return out;
}

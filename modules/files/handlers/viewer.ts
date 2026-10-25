// files viewer data, comments and pins, markup and outside links (spec 2.16, 2.4; ARCH 7.5): what the one viewer shows beside a file and what a person can do to it from there.
//   files.viewer_data      the file, its text, pages and preview address, its sheets, the snapshot note for a Google-native file, and what the caller may do (edit, mark, comment) with the pin count.
//   files.comments.*       comments on a file, a range, a cell, a page or an area. An area comment is a numbered pin, unique per file and never reused, which agents read to see what a person marked.
//   files.markup.*         the strokes of freehand Draw on an image or a page; saving replaces that page's strokes.
//   files.share_external   a view-only link for someone outside the Space, with an expiry (default 30 days, at most a year). Only the hash of the token is stored; the url carries the token once.
//   files.external_links, files.revoke_external   list and revoke those links.
// The file itself is read through files.get, files.read, previews.* and sheets.info, so permissions and the Gate apply as for any caller. A comment id carries no file in the call, so resolve and delete
// check access to the comment's file themselves. Restricted material (a folder labelled restricted) is never shared outside the Space.
// @reads ../migrations/0004_viewer.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, many, num, one, isNull, optInt, optStr, rec } from "./tree.ts";

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

const DAY = 86_400_000;
export const DEFAULT_LINK_DAYS = 30;
export const MAX_LINK_DAYS = 365;
export const MAX_LINKS_PER_FILE = 20;
export const COMMENT_MAX = 5000;
export const MAX_STROKES = 2000;
export const MAX_POINTS = 5000;
export const MAX_MARKUP_BYTES = 1_000_000;
const TEXT_KINDS = new Set(["text", "markdown", "code"]);
const PAGED_KINDS = new Set(["pdf", "document", "presentation"]);
const MARKABLE_KINDS = new Set(["image", "pdf", "document", "presentation"]);
const ANCHOR_KINDS = ["file", "line", "range", "area", "page", "cell"];

export interface ViewerConfig {
  /** where outside links open, for example https://harbor.example; without it the url is the path /x/<token> */
  publicBase?: string;
}
let configured: ViewerConfig = {};
/** The host calls this once at start. Tests pass fakes; null clears. */
export function configureViewer(config: ViewerConfig | null): void {
  configured = config ?? {};
}

// ---- helpers --------------------------------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nid = (prefix: string): string => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function reqStr(ctx: Ctx, o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

async function sha256hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function liveFileRow(ctx: Ctx, fileId: string): Row {
  const row = one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId);
  if (!row) fail(ctx, "validation.not_found", "That file is not in this Space.", { fileId });
  if (!isNull(row.deleted_at)) fail(ctx, "validation.precondition_failed", "That file is in Trash.", { fileId });
  return row;
}

function versionOf(ctx: Ctx, fileId: string, versionId: string | undefined): string | null {
  if (versionId === undefined) return null;
  const v = one(ctx, "SELECT * FROM files_file_version WHERE id = ?", versionId);
  if (!v || str(v.file_id) !== fileId) fail(ctx, "validation.not_found", "That version is not on this file.", { versionId });
  return versionId;
}

const allowed = (ctx: Ctx, level: "view" | "use" | "edit" | "manage", fileId: string, perm: string | null = null): boolean =>
  ctx.authorize({ perm, level }, { type: "file", id: fileId }).effect === "allow";

// ---- viewer data ----------------------------------------------------------------------------------------------

async function tryCall<T>(ctx: Ctx, cap: "previews.get" | "previews.text" | "sheets.info" | "files.read", input: unknown): Promise<T | undefined> {
  try {
    return (await ctx.call(cap, input)) as T;
  } catch (e) {
    ctx.log.warn("files: the viewer could not read a part of a file", { cap, error: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

async function viewerData(ctx: Ctx, input: unknown): Promise<Obj> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const versionId = optStr(ctx, o, "versionId");
  liveFileRow(ctx, fileId);
  versionOf(ctx, fileId, versionId);
  const file = ((await ctx.call("files.get", { fileId })) as { file: Obj }).file;
  const kind = str(file.kind);
  const at = versionId !== undefined ? { fileId, versionId } : { fileId };
  const out: Obj = { file };

  if (TEXT_KINDS.has(kind) && num(file.size) <= 256 * 1024) {
    const r = await tryCall<{ text?: string }>(ctx, "files.read", { ...at, as: "text" });
    if (typeof r?.text === "string") out.text = r.text;
  }
  if (PAGED_KINDS.has(kind)) {
    const t = await tryCall<{ text?: string; pages?: number }>(ctx, "previews.text", at);
    if (typeof t?.text === "string") out.text = t.text;
    if (typeof t?.pages === "number") out.pages = t.pages;
  }
  if (PAGED_KINDS.has(kind) || ["image", "video", "audio"].includes(kind)) {
    const p = await tryCall<{ ready?: boolean; url?: string; pages?: number }>(ctx, "previews.get", at);
    if (p?.ready && typeof p.url === "string") out.previewUrl = p.url;
    if (typeof p?.pages === "number" && out.pages === undefined) out.pages = p.pages;
    if (out.previewUrl === undefined) {
      const u = await tryCall<{ url?: string }>(ctx, "files.read", { ...at, as: "url" });
      if (typeof u?.url === "string") out.previewUrl = u.url;
    }
  }
  if (kind === "spreadsheet") {
    const s = await tryCall<{ sheets?: unknown[] }>(ctx, "sheets.info", { fileId });
    if (Array.isArray(s?.sheets)) out.sheets = s.sheets;
  }
  // a Google-native file is read from an export snapshot; editing it goes through the provider when the file came from one
  if (kind === "google_native") out.snapshot = { exportedAt: num(file.updatedAt), editVia: isObj(file.source) ? "provider_api" : "open_in_provider" };

  const native = kind === "google_native";
  out.canEdit = allowed(ctx, "edit", fileId, "files.write") && (!native || isObj(file.source));
  out.canMark = allowed(ctx, "edit", fileId) && MARKABLE_KINDS.has(kind);
  out.canComment = allowed(ctx, "use", fileId);
  out.pins = many(ctx, "SELECT * FROM files_comment WHERE file_id = ?", fileId).filter((r) => isNull(r.deleted_at) && !num(r.resolved) && !isNull(r.pin)).length;
  return out;
}

// ---- comments -------------------------------------------------------------------------------------------------

function commentOut(r: Row): Obj {
  const out: Obj = {
    commentId: str(r.id), fileId: str(r.file_id), anchor: JSON.parse(str(r.anchor)), text: str(r.text), by: str(r.author), at: num(r.at),
    resolved: num(r.resolved) === 1, mentions: JSON.parse(str(r.mentions)),
  };
  if (!isNull(r.version_id)) out.versionId = str(r.version_id);
  if (!isNull(r.pin)) out.pin = num(r.pin);
  return out;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Checks an anchor and returns it with only the fields its kind uses. */
function cleanAnchor(ctx: Ctx, raw: unknown): Obj {
  const bad = (what: string): never => fail(ctx, "validation.bad_input", `The anchor is not valid: ${what}.`, { field: "anchor" });
  if (!isObj(raw) || !ANCHOR_KINDS.includes(str(raw.kind))) return bad("kind");
  const kind = str(raw.kind);
  const out: Obj = { kind };
  if (raw.quote !== undefined) {
    if (typeof raw.quote !== "string" || raw.quote.length > 500) return bad("quote");
    out.quote = raw.quote;
  }
  if (kind === "line") {
    if (!Number.isInteger(raw.line) || (raw.line as number) < 1) return bad("line");
    out.line = raw.line;
  } else if (kind === "range") {
    if (!Number.isInteger(raw.from) || !Number.isInteger(raw.to) || (raw.from as number) < 0 || (raw.to as number) < (raw.from as number)) return bad("from and to");
    out.from = raw.from;
    out.to = raw.to;
  } else if (kind === "page") {
    if (!Number.isInteger(raw.page) || (raw.page as number) < 1) return bad("page");
    out.page = raw.page;
  } else if (kind === "cell") {
    if (typeof raw.cell !== "string" || raw.cell === "" || raw.cell.length > 100) return bad("cell");
    out.cell = raw.cell;
    if (typeof raw.path === "string" && raw.path.length <= 200) out.path = raw.path;
  } else if (kind === "area") {
    const b = raw.box;
    if (!isObj(b) || !finite(b.x) || !finite(b.y) || !finite(b.w) || !finite(b.h) || b.w < 0 || b.h < 0) return bad("box");
    out.box = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (Number.isInteger(raw.page) && (raw.page as number) >= 1) out.page = raw.page;
  }
  return out;
}

async function commentsList(ctx: Ctx, input: unknown): Promise<{ comments: Obj[] }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  liveFileRow(ctx, fileId);
  const versionId = versionOf(ctx, fileId, optStr(ctx, o, "versionId"));
  const includeResolved = o.includeResolved === true;
  const rows = many(ctx, "SELECT * FROM files_comment WHERE file_id = ?", fileId)
    .filter((r) => isNull(r.deleted_at) && (includeResolved || !num(r.resolved)) && (versionId === null || isNull(r.version_id) || str(r.version_id) === versionId))
    .sort((a, b) => num(a.at) - num(b.at) || str(a.id).localeCompare(str(b.id)));
  return { comments: rows.map(commentOut) };
}

async function commentsAdd(ctx: Ctx, input: unknown): Promise<{ comment: Obj }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  liveFileRow(ctx, fileId);
  const versionId = versionOf(ctx, fileId, optStr(ctx, o, "versionId"));
  const text = reqStr(ctx, o, "text").trim();
  if (text.length === 0 || text.length > COMMENT_MAX) fail(ctx, "validation.bad_input", `A comment is 1 to ${COMMENT_MAX} characters.`, { field: "text" });
  const anchor = cleanAnchor(ctx, o.anchor);
  let mentions: string[] = [];
  if (o.mentions !== undefined && o.mentions !== null) {
    if (!Array.isArray(o.mentions) || o.mentions.length > 20 || !o.mentions.every((m) => typeof m === "string" && m.length > 0 && m.length <= 100)) fail(ctx, "validation.bad_input", "Mention up to 20 people or agents.", { field: "mentions" });
    mentions = [...new Set(o.mentions as string[])];
  }
  // a pin is the next number for the file; deleted pins keep theirs, so a number is never reused
  let pin: number | null = null;
  if (anchor.kind === "area") pin = Math.max(0, ...many(ctx, "SELECT * FROM files_comment WHERE file_id = ?", fileId).map((r) => (isNull(r.pin) ? 0 : num(r.pin)))) + 1;
  const id = nid("fcm");
  ctx.db.run(
    "INSERT INTO files_comment (id, file_id, version_id, anchor, pin, text, mentions, author, at, resolved, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, fileId, versionId, JSON.stringify(anchor), pin, text, JSON.stringify(mentions), ctx.principal.id, ctx.now(), 0, null,
  );
  ctx.emit("file.comment_added", `file/${fileId}`, { fileId, commentId: id, ...(pin !== null ? { pin } : {}), mentions });
  return { comment: commentOut(one(ctx, "SELECT * FROM files_comment WHERE id = ?", id) as Row) };
}

function mustComment(ctx: Ctx, commentId: string): Row {
  const r = one(ctx, "SELECT * FROM files_comment WHERE id = ?", commentId);
  if (!r || !isNull(r.deleted_at)) fail(ctx, "validation.not_found", "That comment does not exist.", { commentId });
  return r;
}

async function commentsResolve(ctx: Ctx, input: unknown): Promise<{ comment: Obj }> {
  const o = rec(ctx, input);
  const r = mustComment(ctx, reqStr(ctx, o, "commentId"));
  if (typeof o.resolved !== "boolean") fail(ctx, "validation.bad_input", "resolved is true or false.", { field: "resolved" });
  const fileId = str(r.file_id);
  if (!allowed(ctx, "use", fileId)) fail(ctx, "permission.no_grant", "You do not have access to this file.");
  const was = num(r.resolved) === 1;
  if (was !== o.resolved) {
    ctx.db.run("UPDATE files_comment SET resolved = ? WHERE id = ?", o.resolved ? 1 : 0, str(r.id));
    if (o.resolved) ctx.emit("file.comment_resolved", `file/${fileId}`, { fileId, commentId: str(r.id) });
  }
  return { comment: commentOut(one(ctx, "SELECT * FROM files_comment WHERE id = ?", str(r.id)) as Row) };
}

async function commentsDelete(ctx: Ctx, input: unknown): Promise<{ deleted: boolean }> {
  const o = rec(ctx, input);
  const id = reqStr(ctx, o, "commentId");
  const r = one(ctx, "SELECT * FROM files_comment WHERE id = ?", id);
  if (!r || !isNull(r.deleted_at)) return { deleted: false };
  // the author may delete their own comment; anyone else needs manage on the file
  if (str(r.author) !== ctx.principal.id && !allowed(ctx, "manage", str(r.file_id))) fail(ctx, "permission.no_grant", "Only the author or someone who manages this file can delete a comment.");
  ctx.db.run("UPDATE files_comment SET deleted_at = ? WHERE id = ?", ctx.now(), id);
  return { deleted: true };
}

// ---- markup ---------------------------------------------------------------------------------------------------

const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function markableFile(ctx: Ctx, fileId: string): void {
  const row = liveFileRow(ctx, fileId);
  if (!MARKABLE_KINDS.has(str(row.kind))) fail(ctx, "validation.precondition_failed", "Draw works on images and pages, not on this kind of file.", { kind: str(row.kind) });
}

async function markupGet(ctx: Ctx, input: unknown): Promise<{ strokes: Obj[] }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  liveFileRow(ctx, fileId);
  const page = optInt(ctx, o, "page");
  if (page !== undefined && page < 1) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "page" });
  const rows = many(ctx, "SELECT * FROM files_markup WHERE file_id = ?", fileId).filter((r) => page === undefined || num(r.page) === page).sort((a, b) => num(a.page) - num(b.page));
  const strokes: Obj[] = [];
  for (const r of rows) for (const s of JSON.parse(str(r.strokes)) as Obj[]) strokes.push(num(r.page) > 0 ? { page: num(r.page), ...s } : s);
  return { strokes };
}

async function markupSave(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  markableFile(ctx, fileId);
  const page = optInt(ctx, o, "page");
  if (page !== undefined && page < 1) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "page" });
  const raw = o.strokes;
  const bad = (what: string): never => fail(ctx, "validation.bad_input", `The strokes are not valid: ${what}.`, { field: "strokes" });
  if (!Array.isArray(raw) || raw.length > MAX_STROKES) return bad(`at most ${MAX_STROKES} strokes`);
  const strokes: Obj[] = raw.map((s) => {
    if (!isObj(s) || typeof s.color !== "string" || !COLOR.test(s.color)) return bad("a colour such as #d32f2f");
    if (!finite(s.width) || s.width <= 0 || s.width > 64) return bad("a width above 0 and at most 64");
    if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > MAX_POINTS || !s.points.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) return bad(`1 to ${MAX_POINTS} points of [x, y]`);
    return { color: s.color, width: s.width, points: s.points };
  });
  const text = JSON.stringify(strokes);
  if (new TextEncoder().encode(text).length > MAX_MARKUP_BYTES) fail(ctx, "validation.too_large", "That drawing is too large to save.");
  const p = page ?? 0;
  const had = many(ctx, "SELECT * FROM files_markup WHERE file_id = ?", fileId).filter((r) => num(r.page) === p);
  for (const r of had) ctx.db.run("DELETE FROM files_markup WHERE id = ?", str(r.id));
  if (strokes.length > 0) ctx.db.run("INSERT INTO files_markup (id, file_id, page, strokes, author, at) VALUES (?, ?, ?, ?, ?, ?)", nid("mkp"), fileId, p, text, ctx.principal.id, ctx.now());
  ctx.emit("file.markup_saved", `file/${fileId}`, { fileId });
  return { ok: true };
}

// ---- outside links --------------------------------------------------------------------------------------------

function folderLabel(ctx: Ctx, file: Row): number {
  const f = one(ctx, "SELECT * FROM files_folder WHERE id = ?", str(file.folder_id));
  return f ? num(f.label) : 0;
}

async function shareExternal(ctx: Ctx, input: unknown): Promise<Obj> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const file = liveFileRow(ctx, fileId);
  if (folderLabel(ctx, file) >= 3) fail(ctx, "permission.above_clearance", "Restricted files cannot be shared outside the Space.");
  const now = ctx.now();
  let expiresAt = now + DEFAULT_LINK_DAYS * DAY;
  if (o.expiresAt !== undefined && o.expiresAt !== null) {
    if (!finite(o.expiresAt)) return fail(ctx, "validation.bad_input", "The expiry is not a time.", { field: "expiresAt" });
    if (o.expiresAt <= now) return fail(ctx, "validation.bad_input", "The expiry must be in the future.", { field: "expiresAt" });
    if (o.expiresAt > now + MAX_LINK_DAYS * DAY) return fail(ctx, "validation.bad_input", `An outside link lasts at most ${MAX_LINK_DAYS} days.`, { field: "expiresAt" });
    expiresAt = Math.floor(o.expiresAt);
  }
  const live = many(ctx, "SELECT * FROM files_external_link WHERE file_id = ?", fileId).filter((r) => isNull(r.revoked_at) && (isNull(r.expires_at) || num(r.expires_at) > now));
  if (live.length >= MAX_LINKS_PER_FILE) fail(ctx, "validation.precondition_failed", `This file already has ${MAX_LINKS_PER_FILE} outside links. Revoke one first.`);
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const id = nid("lnk");
  ctx.db.run("INSERT INTO files_external_link (id, file_id, token_hash, created_by, created_at, expires_at, revoked_at, opens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, fileId, await sha256hex(token), ctx.principal.id, now, expiresAt, null, 0);
  ctx.emit("file.shared_external", `file/${fileId}`, { fileId, linkId: id, expiresAt });
  const base = (configured.publicBase ?? "").replace(/\/+$/, "");
  return { url: `${base}/x/${token}`, linkId: id, expiresAt };
}

async function externalLinks(ctx: Ctx, input: unknown): Promise<{ links: Obj[] }> {
  const fileId = reqStr(ctx, rec(ctx, input), "fileId");
  liveFileRow(ctx, fileId);
  const rows = many(ctx, "SELECT * FROM files_external_link WHERE file_id = ?", fileId).filter((r) => isNull(r.revoked_at)).sort((a, b) => num(b.created_at) - num(a.created_at) || str(b.id).localeCompare(str(a.id)));
  return { links: rows.map((r) => ({ linkId: str(r.id), createdBy: str(r.created_by), createdAt: num(r.created_at), ...(isNull(r.expires_at) ? {} : { expiresAt: num(r.expires_at) }), opens: num(r.opens) })) };
}

async function revokeExternal(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const linkId = reqStr(ctx, o, "linkId");
  const r = one(ctx, "SELECT * FROM files_external_link WHERE id = ?", linkId);
  if (!r || str(r.file_id) !== fileId) fail(ctx, "validation.not_found", "That link is not on this file.", { linkId });
  if (isNull(r.revoked_at)) {
    ctx.db.run("UPDATE files_external_link SET revoked_at = ? WHERE id = ?", ctx.now(), linkId);
    ctx.emit("file.external_revoked", `file/${fileId}`, { fileId, linkId });
  }
  return { ok: true };
}

export const viewerHandlers = {
  "files.viewer_data": (ctx: Ctx, input: unknown) => viewerData(ctx, input),
  "files.comments.list": (ctx: Ctx, input: unknown) => commentsList(ctx, input),
  "files.comments.add": (ctx: Ctx, input: unknown) => commentsAdd(ctx, input),
  "files.comments.resolve": (ctx: Ctx, input: unknown) => commentsResolve(ctx, input),
  "files.comments.delete": (ctx: Ctx, input: unknown) => commentsDelete(ctx, input),
  "files.markup.get": (ctx: Ctx, input: unknown) => markupGet(ctx, input),
  "files.markup.save": (ctx: Ctx, input: unknown) => markupSave(ctx, input),
  "files.share_external": (ctx: Ctx, input: unknown) => shareExternal(ctx, input),
  "files.external_links": (ctx: Ctx, input: unknown) => externalLinks(ctx, input),
  "files.revoke_external": (ctx: Ctx, input: unknown) => revokeExternal(ctx, input),
};

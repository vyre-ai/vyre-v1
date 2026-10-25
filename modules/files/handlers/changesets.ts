// files changesets: Review changes (spec 2.16, 2.14; ARCH 7.5).
// In a folder with Review changes on, a write by an agent or an outside actor is staged in a working copy (a changeset) and reaches the
// file tree only on Approve. A changeset records the version it started from; Approve merges three ways (base, current, staged) and
// sends any conflict to the reviewer instead of overwriting. Staged content is sealed and lives in files_changeset_file, so a discarded
// changeset leaves no blob, version or file behind. The wrapped files.write and files.create below run the plain tree handlers for
// people and for folders without Review changes. Approve applies through the plain handlers too, so an approver that is an agent never
// stages its own approval.
//
// Not staged here: files.delete, files.rename and files.move by an agent go straight to their handlers (their manifest outputs carry no
// changesetId). Rows with status deleted or renamed are understood by Approve, for the git working copy that stages them.

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { MAX_INLINE, treeHandlers } from "./tree.ts";
import { addMarks, hunksOf, lcsPairs, lineOps, splitLines, splitParagraphs, versionHandlers } from "./versions.ts";
import type { Hunk } from "./versions.ts";

type Row = Record<string, unknown>;
type Status = "added" | "modified" | "deleted" | "renamed";
type State = "open" | "changes_requested" | "approved" | "discarded";

// ---- errors and small readers ----

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

const isNull = (v: unknown): boolean => v === null || v === undefined;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const flag = (v: unknown): boolean => v === true || v === 1 || v === "1";
const many = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => many(ctx, sql, ...args)[0];
const live = (r: Row | undefined): r is Row => r !== undefined && isNull(r.deleted_at);

function record(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}
function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}
function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}
const nid = (ctx: Ctx, prefix: string): string => `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;

// ---- bytes ----

const enc = new TextEncoder();
function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s);
}
function fromB64(ctx: Ctx, b64: string): Uint8Array {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return fail(ctx, "validation.bad_input", "The content is not valid base64.", { field: "content" });
  }
}
function textOfBytes(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return undefined; }
}
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- 3-way merge (lines) ----

interface Region { s: number; e: number; lines: string[] }

/** The runs of base lines [s, e) that `side` replaced, with the lines it put there. */
function regionsOf(base: readonly string[], side: readonly string[]): Region[] {
  const out: Region[] = [];
  let bi = 0;
  let si = 0;
  const close = (b: number, s: number): void => {
    if (b > bi || s > si) out.push({ s: bi, e: b, lines: side.slice(si, s) });
  };
  for (const [b, s] of lcsPairs(base, side)) {
    close(b, s);
    bi = b + 1;
    si = s + 1;
  }
  close(base.length, side.length);
  return out;
}

const touches = (a: Region, b: Region): boolean => a.s <= b.e && b.s <= a.e;
const sameLines = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Merge two edits of one base. `conflicts` counts regions both sides changed differently; the text is only meaningful at zero. */
export function merge3(base: readonly string[], ours: readonly string[], theirs: readonly string[]): { lines: string[]; conflicts: number } {
  const A = regionsOf(base, ours);
  const B = regionsOf(base, theirs);
  const out: string[] = [];
  let pos = 0;
  let i = 0;
  let j = 0;
  let conflicts = 0;
  const upTo = (to: number): void => { while (pos < to) { out.push(base[pos] ?? ""); pos++; } };
  while (i < A.length || j < B.length) {
    const a = A[i];
    const b = B[j];
    if (a && b && touches(a, b)) {
      if (a.s === b.s && a.e === b.e && sameLines(a.lines, b.lines)) {
        upTo(a.s);
        out.push(...a.lines);
        pos = a.e;
      } else {
        conflicts++;
        pos = Math.max(pos, a.e, b.e);
      }
      i++; j++;
      continue;
    }
    if (a && (!b || a.s < b.s)) { upTo(a.s); out.push(...a.lines); pos = a.e; i++; }
    else if (b) { upTo(b.s); out.push(...b.lines); pos = b.e; j++; }
  }
  upTo(base.length);
  return { lines: out, conflicts };
}

const joinLines = (lines: readonly string[], trailing: boolean): string => (lines.length === 0 ? "" : lines.join("\n") + (trailing ? "\n" : ""));

// ---- folders, paths, content of files ----

function reviewRoot(ctx: Ctx, folderId: string): Row | undefined {
  let top: Row | undefined;
  let cur = one(ctx, "SELECT * FROM files_folder WHERE id = ?", folderId);
  while (cur && flag(cur.review_changes)) {
    top = cur;
    if (isNull(cur.parent_id)) break;
    cur = one(ctx, "SELECT * FROM files_folder WHERE id = ?", String(cur.parent_id));
  }
  return top;
}

function relPath(root: Row, folder: Row, name: string): string {
  const rest = String(folder.path).slice(String(root.path).length).replace(/^\/+/, "");
  return rest === "" ? name : `${rest}/${name}`;
}

const stages = (ctx: Ctx): boolean => ctx.principal.kind === "agent" || ctx.principal.kind === "actor";

async function currentBytes(ctx: Ctx, fileId: string, version?: number): Promise<Uint8Array> {
  const input: Record<string, unknown> = { fileId, as: "base64" };
  if (version !== undefined) {
    const v = many(ctx, "SELECT * FROM files_file_version WHERE file_id = ?", fileId).find((r) => num(r.n) === version);
    if (!v) fail(ctx, "validation.not_found", "The version this changeset started from is gone.", { fileId, version });
    input["versionId"] = String(v.id);
  }
  const r = (await treeHandlers["files.read"](ctx, input)) as { base64?: string };
  return fromB64(ctx, r.base64 ?? "");
}

function seal(ctx: Ctx, csId: string, bytes: Uint8Array): string {
  return JSON.stringify(ctx.seal.seal(bytes, `files.changeset:${ctx.space}:${csId}`));
}
function unseal(ctx: Ctx, stored: unknown): Uint8Array {
  if (typeof stored !== "string") return new Uint8Array();
  try { return ctx.seal.unseal(JSON.parse(stored) as { keyId: string; nonce: string; bytes: string }); } catch { return fail(ctx, "internal.unexpected", "The staged content failed its integrity check."); }
}

function contentBytes(ctx: Ctx, value: unknown): Uint8Array {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(ctx, "validation.bad_input", "The input is not valid.", { field: "content" });
  const o = value as Record<string, unknown>;
  const keys = (["text", "base64", "blobId"] as const).filter((k) => o[k] !== undefined && o[k] !== null);
  if (keys.length !== 1) return fail(ctx, "validation.bad_input", "Send text, base64, or a blob id, one of them.");
  if (typeof o["text"] === "string") return enc.encode(o["text"]);
  if (typeof o["base64"] === "string") return fromB64(ctx, o["base64"]);
  if (typeof o["blobId"] === "string") {
    const b = one(ctx, "SELECT * FROM files_blob WHERE id = ?", o["blobId"]);
    if (!b) return fail(ctx, "validation.not_found", "That blob is not in the store.", { blobId: o["blobId"] });
    try { return ctx.seal.unseal({ keyId: String(b.key_id), nonce: String(b.nonce), bytes: String(b.bytes) }); } catch { return fail(ctx, "internal.unexpected", "The blob failed its integrity check."); }
  }
  return fail(ctx, "validation.bad_input", "The input is not valid.", { field: "content" });
}

function lineCounts(base: Uint8Array | undefined, now: Uint8Array | undefined): { added: number; removed: number } {
  const a = base ? textOfBytes(base) : "";
  const b = now ? textOfBytes(now) : "";
  if (a === undefined || b === undefined) return { added: 0, removed: 0 };
  const ops = lineOps(splitLines(a), splitLines(b));
  return { added: ops.filter((o) => o.op === "add").length, removed: ops.filter((o) => o.op === "del").length };
}

// ---- changesets ----

function mustChangeset(ctx: Ctx, id: string): Row {
  const r = one(ctx, "SELECT * FROM files_changeset WHERE id = ?", id);
  if (!r) return fail(ctx, "validation.not_found", "That changeset does not exist.", { changesetId: id });
  return r;
}
const filesOf = (ctx: Ctx, csId: string): Row[] => many(ctx, "SELECT * FROM files_changeset_file WHERE changeset_id = ?", csId).sort((a, b) => String(a.path).localeCompare(String(b.path)));
const isOpen = (r: Row): boolean => r.state === "open" || r.state === "changes_requested";

function touch(ctx: Ctx, cs: Row): void {
  ctx.db.run("UPDATE files_changeset SET updated_at = ? WHERE id = ?", ctx.now(), cs.id);
}

function rowOut(ctx: Ctx, cs: Row): Record<string, unknown> {
  const fs = filesOf(ctx, String(cs.id));
  const out: Record<string, unknown> = {
    changesetId: String(cs.id), folderId: String(cs.folder_id), state: String(cs.state), by: String(cs.author),
    fileCount: fs.length, added: fs.reduce((n, f) => n + num(f.added_lines), 0), removed: fs.reduce((n, f) => n + num(f.removed_lines), 0),
    openedAt: num(cs.opened_at), pushPending: flag(cs.push_pending),
  };
  if (!isNull(cs.on_behalf_of)) out["onBehalfOf"] = String(cs.on_behalf_of);
  if (fs.length === 1 && !isNull(fs[0]?.base_version)) out["baseVersion"] = String(num(fs[0]?.base_version));
  if (!isNull(cs.reviewer)) out["reviewer"] = String(cs.reviewer);
  if (!isNull(cs.thread_id)) out["threadId"] = String(cs.thread_id);
  return out;
}

/** The changeset this writer is already filling in this folder, or a new one. */
function changesetFor(ctx: Ctx, root: Row): { cs: Row; fresh: boolean } {
  const behalf = ctx.actingFor ?? "";
  const mine = many(ctx, "SELECT * FROM files_changeset WHERE folder_id = ? AND author = ?", String(root.id), ctx.principal.id)
    .filter((r) => isOpen(r) && String(r.on_behalf_of ?? "") === behalf)
    .sort((a, b) => num(b.opened_at) - num(a.opened_at));
  const found = mine[0];
  if (found) return { cs: found, fresh: false };
  const id = nid(ctx, "chg");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO files_changeset (id, folder_id, state, author, on_behalf_of, thread_id, reviewer, opened_at, updated_at, closed_at, push_pending, commit_sha, version_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, String(root.id), "open", ctx.principal.id, ctx.actingFor ?? null, ctx.thread ?? null, null, now, now, null, 0, null, null,
  );
  return { cs: mustChangeset(ctx, id), fresh: true };
}

function announce(ctx: Ctx, cs: Row, fresh: boolean): void {
  const count = filesOf(ctx, String(cs.id)).length;
  if (fresh) {
    const payload: { changesetId: string; folderId: string; by: string; fileCount: number; threadId?: string } = {
      changesetId: String(cs.id), folderId: String(cs.folder_id), by: String(cs.author), fileCount: count,
    };
    if (!isNull(cs.thread_id)) payload.threadId = String(cs.thread_id);
    ctx.emit("changeset.opened", `folder/${String(cs.folder_id)}`, payload);
  } else {
    ctx.emit("changeset.updated", `folder/${String(cs.folder_id)}`, { changesetId: String(cs.id), folderId: String(cs.folder_id), fileCount: count });
  }
}

function reopen(ctx: Ctx, cs: Row): void {
  if (cs.state === "changes_requested") ctx.db.run("UPDATE files_changeset SET state = ?, updated_at = ? WHERE id = ?", "open", ctx.now(), cs.id);
  else touch(ctx, cs);
}

interface Provisional { cs: Row; entry: Row }
function stagedByProvisional(ctx: Ctx, fileId: string): Provisional | undefined {
  for (const e of many(ctx, "SELECT * FROM files_changeset_file WHERE file_id = ?", fileId)) {
    if (e.status !== "added") continue;
    const cs = one(ctx, "SELECT * FROM files_changeset WHERE id = ?", String(e.changeset_id));
    if (cs && isOpen(cs)) return { cs, entry: e };
  }
  return undefined;
}

// ---- the wrapped writes ----

type WriteResult = Awaited<ReturnType<(typeof versionHandlers)["files.write"]>>;
type CreateResult = Awaited<ReturnType<(typeof treeHandlers)["files.create"]>>;

async function stagedWrite(ctx: Ctx, input: unknown): Promise<WriteResult> {
  if (!stages(ctx)) return versionHandlers["files.write"](ctx, input);
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId);

  // a second write to a file the same changeset adds, by the id the agent was given
  const prov = !file ? stagedByProvisional(ctx, fileId) : undefined;
  if (prov) {
    const bytes = contentBytes(ctx, o["content"]);
    if (bytes.byteLength > MAX_INLINE) fail(ctx, "validation.too_large", "This file is over the size limit for a direct write.");
    const counts = lineCounts(undefined, bytes);
    ctx.db.run(
      "UPDATE files_changeset_file SET content = ?, size = ?, added_lines = ?, removed_lines = ?, updated_at = ? WHERE changeset_id = ? AND path = ?",
      seal(ctx, String(prov.cs.id), bytes), bytes.byteLength, counts.added, counts.removed, ctx.now(), prov.entry.changeset_id, prov.entry.path,
    );
    reopen(ctx, prov.cs);
    announce(ctx, prov.cs, false);
    return { file: virtualFile(ctx, { ...prov.entry, size: bytes.byteLength }), changesetId: String(prov.cs.id) } as unknown as WriteResult;
  }
  if (!live(file)) return versionHandlers["files.write"](ctx, input); // the handler reports the missing file

  const folder = one(ctx, "SELECT * FROM files_folder WHERE id = ?", String(file.folder_id));
  const root = folder ? reviewRoot(ctx, String(folder.id)) : undefined;
  if (!folder || !root) return versionHandlers["files.write"](ctx, input);

  const bytes = contentBytes(ctx, o["content"]);
  if (bytes.byteLength > MAX_INLINE) fail(ctx, "validation.too_large", "This file is over the size limit for a direct write.");
  const path = relPath(root, folder, String(file.name));
  const { cs, fresh } = changesetFor(ctx, root);
  const existing = one(ctx, "SELECT * FROM files_changeset_file WHERE changeset_id = ? AND path = ?", String(cs.id), path);
  const baseInput = o["baseVersion"];
  if (baseInput !== undefined && baseInput !== null && (typeof baseInput !== "number" || !Number.isInteger(baseInput) || baseInput < 1)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "baseVersion" });
  if (!existing && typeof baseInput === "number" && baseInput !== num(file.version)) fail(ctx, "validation.version_conflict", "The file changed since it was read.");

  const baseVersion = existing && !flag(existing.conflict) ? num(existing.base_version) : num(file.version); // writing again after a conflict starts from what is there now
  const baseBytes = await currentBytes(ctx, String(file.id), baseVersion);
  const counts = lineCounts(baseBytes, bytes);
  const sealed = seal(ctx, String(cs.id), bytes);
  const now = ctx.now();
  if (existing) {
    ctx.db.run(
      "UPDATE files_changeset_file SET base_version = ?, content = ?, size = ?, added_lines = ?, removed_lines = ?, conflict = ?, updated_at = ? WHERE changeset_id = ? AND path = ?",
      baseVersion, sealed, bytes.byteLength, counts.added, counts.removed, 0, now, String(cs.id), path,
    );
  } else {
    ctx.db.run(
      "INSERT INTO files_changeset_file (changeset_id, path, status, file_id, folder_id, name, new_name, mime, base_version, content, size, added_lines, removed_lines, conflict, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      String(cs.id), path, "modified", String(file.id), String(folder.id), String(file.name), null, String(file.mime), baseVersion, sealed, bytes.byteLength, counts.added, counts.removed, 0, now,
    );
  }
  if (!fresh) reopen(ctx, cs);
  announce(ctx, cs, fresh);
  ctx.log.info("changesets.stage", { changesetId: String(cs.id), path, status: "modified" });
  const got = (await treeHandlers["files.get"](ctx, { fileId: String(file.id) })) as Pick<WriteResult, "file">;
  return { file: got.file, changesetId: String(cs.id) };
}

/** A file row for something that does not exist yet: the agent gets an id it can write to again inside the same changeset. */
function virtualFile(ctx: Ctx, entry: Row): Record<string, unknown> {
  const now = num(entry.updated_at) || ctx.now();
  return {
    fileId: String(entry.file_id), folderId: String(entry.folder_id), name: String(entry.name), kind: "file", mime: String(entry.mime ?? "application/octet-stream"),
    size: num(entry.size), version: 0, label: 0, ownerId: ctx.principal.id, createdAt: now, updatedAt: now, updatedBy: ctx.principal.id, thumb: false, holds: 0,
  };
}

async function stagedCreate(ctx: Ctx, input: unknown): Promise<CreateResult> {
  if (!stages(ctx)) return treeHandlers["files.create"](ctx, input);
  const o = record(ctx, input);
  const folderId = typeof o["folderId"] === "string" ? o["folderId"] : "";
  const folder = one(ctx, "SELECT * FROM files_folder WHERE id = ?", folderId);
  const root = live(folder) ? reviewRoot(ctx, folderId) : undefined;
  if (!live(folder) || !root) return treeHandlers["files.create"](ctx, input);

  const name = reqStr(ctx, o, "name");
  if (/[\\/]/.test(name) || name === "." || name === "..") fail(ctx, "validation.bad_input", "A file name has no slash.", { field: "name" });
  const mime = optStr(ctx, o, "mime") ?? "application/octet-stream";
  const bytes = o["content"] === undefined || o["content"] === null ? new Uint8Array() : contentBytes(ctx, o["content"]);
  if (bytes.byteLength > MAX_INLINE) fail(ctx, "validation.too_large", "This file is over the size limit for a direct write.");
  if (many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND name = ?", folderId, name).some(live)) fail(ctx, "validation.duplicate", "That name is already in this folder.");

  const path = relPath(root, folder, name);
  const { cs, fresh } = changesetFor(ctx, root);
  const existing = one(ctx, "SELECT * FROM files_changeset_file WHERE changeset_id = ? AND path = ?", String(cs.id), path);
  if (existing && existing.status !== "added") fail(ctx, "validation.duplicate", "That name is already in this changeset.");
  const counts = lineCounts(undefined, bytes);
  const sealed = seal(ctx, String(cs.id), bytes);
  const now = ctx.now();
  let provisional: string;
  if (existing) {
    provisional = String(existing.file_id);
    ctx.db.run(
      "UPDATE files_changeset_file SET content = ?, size = ?, mime = ?, added_lines = ?, removed_lines = ?, updated_at = ? WHERE changeset_id = ? AND path = ?",
      sealed, bytes.byteLength, mime, counts.added, counts.removed, now, String(cs.id), path,
    );
  } else {
    provisional = nid(ctx, "fil");
    ctx.db.run(
      "INSERT INTO files_changeset_file (changeset_id, path, status, file_id, folder_id, name, new_name, mime, base_version, content, size, added_lines, removed_lines, conflict, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      String(cs.id), path, "added", provisional, folderId, name, null, mime, null, sealed, bytes.byteLength, counts.added, counts.removed, 0, now,
    );
  }
  if (!fresh) reopen(ctx, cs);
  announce(ctx, cs, fresh);
  ctx.log.info("changesets.stage", { changesetId: String(cs.id), path, status: "added" });
  const entry = one(ctx, "SELECT * FROM files_changeset_file WHERE changeset_id = ? AND path = ?", String(cs.id), path) ?? {};
  return { file: virtualFile(ctx, entry), changesetId: String(cs.id) } as unknown as CreateResult;
}

// ---- reading ----

async function list(ctx: Ctx, input: unknown): Promise<{ changesets: Record<string, unknown>[]; next?: string; total: number }> {
  const o = record(ctx, input);
  const folderId = optStr(ctx, o, "folderId");
  const state = optStr(ctx, o, "state");
  if (state !== undefined && !["open", "changes_requested", "approved", "discarded"].includes(state)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "state" });
  const limit = typeof o["limit"] === "number" ? Math.max(1, Math.min(500, Math.trunc(o["limit"]))) : 50;
  let offset = 0;
  if (typeof o["cursor"] === "string") {
    offset = Number(o["cursor"]);
    if (!Number.isInteger(offset) || offset < 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "cursor" });
  }
  const me = ctx.principal.id;
  const rows = many(ctx, "SELECT * FROM files_changeset")
    .filter((r) => (folderId === undefined || String(r.folder_id) === folderId) && (state === undefined || r.state === state))
    .filter((r) => o["mine"] !== true || String(r.on_behalf_of ?? "") === me || String(r.author) === me)
    .sort((a, b) => num(b.opened_at) - num(a.opened_at) || String(b.id).localeCompare(String(a.id)));
  const page = rows.slice(offset, offset + limit);
  const out: { changesets: Record<string, unknown>[]; next?: string; total: number } = { changesets: page.map((r) => rowOut(ctx, r)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function get(ctx: Ctx, input: unknown): Promise<{ changeset: Record<string, unknown>; files: { path: string; status: Status; added: number; removed: number; conflict: boolean }[] }> {
  const cs = mustChangeset(ctx, reqStr(ctx, record(ctx, input), "changesetId"));
  return {
    changeset: rowOut(ctx, cs),
    files: filesOf(ctx, String(cs.id)).map((f) => ({ path: String(f.path), status: String(f.status) as Status, added: num(f.added_lines), removed: num(f.removed_lines), conflict: flag(f.conflict) })),
  };
}

function entryOf(ctx: Ctx, csId: string, path: string): Row {
  const e = one(ctx, "SELECT * FROM files_changeset_file WHERE changeset_id = ? AND path = ?", csId, path);
  if (!e) return fail(ctx, "validation.not_found", "That path is not in this changeset.", { path });
  return e;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|tiff?)$/i;
function shapeOf(name: string, mime: string, bytes: Uint8Array | undefined): "image" | "binary" | "markdown" | "text" {
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (IMAGE_EXT.test(name)) return "image";
  if (bytes !== undefined && textOfBytes(bytes) === undefined) return "binary";
  return /\.(md|markdown)$/i.test(name) || mime === "text/markdown" ? "markdown" : "text";
}

interface Sides { base: Uint8Array | undefined; staged: Uint8Array | undefined }
async function sidesOf(ctx: Ctx, e: Row): Promise<Sides> {
  const base = e.status === "added" || isNull(e.file_id) || isNull(e.base_version) ? undefined : await currentBytes(ctx, String(e.file_id), num(e.base_version));
  const staged = isNull(e.content) ? undefined : unseal(ctx, e.content);
  return { base, staged };
}

async function diff(ctx: Ctx, input: unknown) {
  const o = record(ctx, input);
  const cs = mustChangeset(ctx, reqStr(ctx, o, "changesetId"));
  const e = entryOf(ctx, String(cs.id), reqStr(ctx, o, "path"));
  const mode = optStr(ctx, o, "mode");
  if (mode !== undefined && !["unified", "split", "words", "paragraph"].includes(mode)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "mode" });
  const { base, staged } = await sidesOf(ctx, e);
  const identical = base !== undefined && staged !== undefined && same(base, staged);
  const shape = shapeOf(String(e.name), String(e.mime ?? ""), staged ?? base);
  if (shape === "image" || shape === "binary") {
    const out: { kind: "image" | "binary"; added: number; removed: number; hunks: Hunk[]; identical: boolean; images?: { left?: string; right?: string } } = { kind: shape, added: 0, removed: 0, hunks: [], identical };
    if (shape === "image" && !isNull(e.file_id) && !isNull(e.base_version)) {
      const v = many(ctx, "SELECT * FROM files_file_version WHERE file_id = ?", String(e.file_id)).find((r) => num(r.n) === num(e.base_version));
      if (v) out.images = { left: String(v.blob) };
    }
    return out;
  }
  const paragraphs = mode === "paragraph" || (mode === undefined && shape === "markdown");
  const split = (b: Uint8Array | undefined): string[] => { const t = b === undefined ? "" : (textOfBytes(b) ?? ""); return paragraphs ? splitParagraphs(t) : splitLines(t); };
  const ops = lineOps(split(base), split(staged));
  const marks = mode === "words" || paragraphs ? addMarks(ops) : undefined;
  return {
    kind: paragraphs ? ("paragraph" as const) : ("text" as const),
    added: ops.filter((x) => x.op === "add").length,
    removed: ops.filter((x) => x.op === "del").length,
    hunks: hunksOf(ops, marks),
    identical,
  };
}

// ---- approve ----

type Plan =
  | { entry: Row; kind: "write"; bytes: Uint8Array; fileId: string; version: number }
  | { entry: Row; kind: "create"; bytes: Uint8Array }
  | { entry: Row; kind: "delete"; fileId: string }
  | { entry: Row; kind: "rename"; fileId: string; bytes: Uint8Array | undefined; version: number; name: string; toFolderId?: string }
  | { entry: Row; kind: "conflict"; reason: string };

async function planOf(ctx: Ctx, e: Row): Promise<Plan> {
  const status = String(e.status) as Status;
  const staged = isNull(e.content) ? undefined : unseal(ctx, e.content);
  if (status === "added") {
    const taken = many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND name = ?", String(e.folder_id), String(e.name)).some(live);
    if (taken) return { entry: e, kind: "conflict", reason: "A file with this name was added to the folder after the changeset started." };
    return { entry: e, kind: "create", bytes: staged ?? new Uint8Array() };
  }
  const fileId = String(e.file_id);
  const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId);
  if (!live(file)) return { entry: e, kind: "conflict", reason: "The file was deleted after the changeset started." };
  const current = num(file.version);
  const base = num(e.base_version);
  if (status === "deleted") {
    return current === base ? { entry: e, kind: "delete", fileId } : { entry: e, kind: "conflict", reason: "The file changed after the changeset started." };
  }
  if (status === "renamed") {
    // new_name is the new name; "<folderId>/<name>" (a name has no slash) is a move, which an agent stages with files.move (agent-stage.ts)
    const raw = String(e.new_name ?? e.name);
    const slash = raw.indexOf("/");
    const toFolderId = slash > 0 ? raw.slice(0, slash) : undefined;
    const target = slash > 0 ? raw.slice(slash + 1) : raw;
    const intoFolder = toFolderId ?? String(file.folder_id);
    if (toFolderId !== undefined && !live(one(ctx, "SELECT * FROM files_folder WHERE id = ?", toFolderId))) return { entry: e, kind: "conflict", reason: "The folder this file moves to was deleted." };
    if (many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND name = ?", intoFolder, target).some((r) => live(r) && String(r.id) !== fileId)) {
      return { entry: e, kind: "conflict", reason: "The new name is taken." };
    }
    if (staged !== undefined && current !== base) return { entry: e, kind: "conflict", reason: "The file changed after the changeset started." };
    return { entry: e, kind: "rename", fileId, bytes: staged, version: current, name: target, ...(toFolderId !== undefined ? { toFolderId } : {}) };
  }
  if (staged === undefined) return { entry: e, kind: "conflict", reason: "The changeset holds no content for this file." };
  if (current === base) return { entry: e, kind: "write", bytes: staged, fileId, version: current };
  const now = await currentBytes(ctx, fileId);
  if (same(now, staged)) return { entry: e, kind: "write", bytes: staged, fileId, version: current }; // somebody already made the same change
  const baseBytes = await currentBytes(ctx, fileId, base);
  const b = textOfBytes(baseBytes), o = textOfBytes(now), s = textOfBytes(staged);
  if (b === undefined || o === undefined || s === undefined) return { entry: e, kind: "conflict", reason: "The file changed after the changeset started and cannot be merged line by line." };
  const merged = merge3(splitLines(b), splitLines(o), splitLines(s));
  if (merged.conflicts > 0) return { entry: e, kind: "conflict", reason: `${merged.conflicts} place${merged.conflicts === 1 ? "" : "s"} changed on both sides.` };
  const trailing = s.endsWith("\n") || o.endsWith("\n");
  return { entry: e, kind: "write", bytes: enc.encode(joinLines(merged.lines, trailing)), fileId, version: current };
}

async function differentPerson(ctx: Ctx): Promise<boolean> {
  try {
    const res = (await ctx.call("settings.get", { key: "changesets.different_person" })) as { row?: { value?: unknown } };
    return res.row?.value === true;
  } catch {
    return false;
  }
}

const contentOf = (bytes: Uint8Array): { text: string } | { base64: string } => {
  const t = textOfBytes(bytes);
  return t !== undefined ? { text: t } : { base64: toB64(bytes) };
};

async function approve(ctx: Ctx, input: unknown): Promise<{ approved: boolean; versionIds: string[]; commit?: string; conflicts: string[] }> {
  const o = record(ctx, input);
  const cs = mustChangeset(ctx, reqStr(ctx, o, "changesetId"));
  const push = o["push"] === true;
  const message = optStr(ctx, o, "message");

  if (cs.state === "approved") {
    const done: { approved: boolean; versionIds: string[]; commit?: string; conflicts: string[] } = { approved: true, versionIds: JSON.parse(String(cs.version_ids ?? "[]")) as string[], conflicts: [] };
    if (!isNull(cs.commit_sha)) done.commit = String(cs.commit_sha);
    return done;
  }
  if (!isOpen(cs)) fail(ctx, "validation.precondition_failed", "This changeset was discarded.");
  if (ctx.authorize({ perm: "files.write", level: "edit" }, { type: "folder", id: String(cs.folder_id) }).effect !== "allow") fail(ctx, "permission.no_grant", "Approving needs edit access to this folder.");
  if (!isNull(cs.on_behalf_of) && String(cs.on_behalf_of) === ctx.principal.id && (await differentPerson(ctx))) {
    fail(ctx, "validation.precondition_failed", "The person who asked the agent cannot approve its changes in this Space.");
  }
  const folder = one(ctx, "SELECT * FROM files_folder WHERE id = ?", String(cs.folder_id));
  if (push && !(folder && flag(folder.git))) fail(ctx, "validation.precondition_failed", "This folder is not a git repository, so there is nothing to push.");

  const entries = filesOf(ctx, String(cs.id));
  if (entries.length === 0) fail(ctx, "validation.precondition_failed", "This changeset has no changes.");
  const plans: Plan[] = [];
  for (const e of entries) plans.push(await planOf(ctx, e));
  const bad = plans.filter((p): p is Extract<Plan, { kind: "conflict" }> => p.kind === "conflict");
  for (const e of entries) {
    const hit = bad.some((p) => p.entry.path === e.path);
    if (hit !== flag(e.conflict)) ctx.db.run("UPDATE files_changeset_file SET conflict = ? WHERE changeset_id = ? AND path = ?", hit ? 1 : 0, String(cs.id), String(e.path));
  }
  if (bad.length > 0) {
    touch(ctx, cs);
    ctx.log.info("changesets.conflicts", { changesetId: String(cs.id), conflicts: bad.length });
    return { approved: false, versionIds: [], conflicts: bad.map((p) => String(p.entry.path)) };
  }

  const versionIds: string[] = [];
  const reason = message ?? "Approved changeset";
  for (const p of plans) {
    if (p.kind === "write") {
      const res = (await versionHandlers["files.write"](ctx, { fileId: p.fileId, content: contentOf(p.bytes), baseVersion: p.version, reason })) as { versionId?: string };
      if (res.versionId) versionIds.push(res.versionId);
    } else if (p.kind === "create") {
      const made = (await treeHandlers["files.create"](ctx, { folderId: String(p.entry.folder_id), name: String(p.entry.name), mime: String(p.entry.mime ?? ""), content: contentOf(p.bytes) })) as { file: { fileId: string } };
      const vs = (await treeHandlers["files.versions"](ctx, { fileId: made.file.fileId })) as { versions: { versionId: string; n: number }[] };
      const last = vs.versions.slice().sort((a, b) => b.n - a.n)[0];
      if (last) versionIds.push(last.versionId);
    } else if (p.kind === "delete") {
      await treeHandlers["files.delete"](ctx, { fileId: p.fileId });
    } else if (p.kind === "rename") {
      if (p.toFolderId !== undefined) await treeHandlers["files.move"](ctx, { fileId: p.fileId, toFolderId: p.toFolderId, name: p.name });
      else await treeHandlers["files.rename"](ctx, { fileId: p.fileId, name: p.name });
      if (p.bytes !== undefined) {
        const res = (await versionHandlers["files.write"](ctx, { fileId: p.fileId, content: contentOf(p.bytes), reason })) as { versionId?: string };
        if (res.versionId) versionIds.push(res.versionId);
      }
    }
  }

  let commit: string | undefined;
  let pushPending = false;
  if (push) {
    try {
      const made = (await ctx.call("git.commit", { folderId: String(cs.folder_id), message: message ?? "Approved changeset" })) as { sha?: string };
      commit = made.sha;
      await ctx.call("git.push", { folderId: String(cs.folder_id) });
    } catch {
      pushPending = true; // approved and committed to the tree; the push waits for a retry or for its own Gate approval
    }
  }
  const now = ctx.now();
  ctx.db.run(
    "UPDATE files_changeset SET state = ?, reviewer = ?, updated_at = ?, closed_at = ?, push_pending = ?, commit_sha = ?, version_ids = ? WHERE id = ?",
    "approved", ctx.principal.id, now, now, pushPending ? 1 : 0, commit ?? null, JSON.stringify(versionIds), String(cs.id),
  );
  for (const e of entries) ctx.db.run("UPDATE files_changeset_file SET content = ?, conflict = ?, updated_at = ? WHERE changeset_id = ? AND path = ?", null, 0, now, String(cs.id), String(e.path));
  const payload: { changesetId: string; folderId: string; by: string; fileCount: number; commit?: string } = {
    changesetId: String(cs.id), folderId: String(cs.folder_id), by: ctx.principal.id, fileCount: entries.length,
  };
  if (commit !== undefined) payload.commit = commit;
  ctx.emit("changeset.approved", `folder/${String(cs.folder_id)}`, payload);
  const out: { approved: boolean; versionIds: string[]; commit?: string; conflicts: string[] } = { approved: true, versionIds, conflicts: [] };
  if (commit !== undefined) out.commit = commit;
  return out;
}

// ---- request changes, discard, revert ----

const commentsOf = (ctx: Ctx, csId: string): Row[] => many(ctx, "SELECT * FROM files_changeset_comment WHERE changeset_id = ?", csId).sort((a, b) => num(a.at) - num(b.at));

async function requestChanges(ctx: Ctx, input: unknown): Promise<{ sent: number }> {
  const o = record(ctx, input);
  const cs = mustChangeset(ctx, reqStr(ctx, o, "changesetId"));
  if (!isOpen(cs)) fail(ctx, "validation.precondition_failed", "Only an open changeset can get change requests.");
  const note = optStr(ctx, o, "note");
  const unsent = commentsOf(ctx, String(cs.id)).filter((c) => !flag(c.sent) && !flag(c.resolved));
  if (unsent.length === 0 && note === undefined) fail(ctx, "validation.bad_input", "Add a comment or a note first.");
  if (!isNull(cs.thread_id)) {
    const lines = [note ?? "Changes requested.", ...unsent.map((c) => `${isNull(c.path) ? "" : `${String(c.path)}: `}${String(c.text)}`)];
    await ctx.call("chat.post", { threadId: String(cs.thread_id), body: lines.join("\n") }, { idempotencyKey: `changesets.request_changes:${String(cs.id)}:${ctx.now()}` });
  }
  for (const c of unsent) ctx.db.run("UPDATE files_changeset_comment SET sent = ? WHERE id = ?", 1, String(c.id));
  ctx.db.run("UPDATE files_changeset SET state = ?, reviewer = ?, updated_at = ? WHERE id = ?", "changes_requested", ctx.principal.id, ctx.now(), String(cs.id));
  ctx.emit("changeset.changes_requested", `folder/${String(cs.folder_id)}`, { changesetId: String(cs.id), folderId: String(cs.folder_id), by: ctx.principal.id, comments: unsent.length });
  return { sent: unsent.length };
}

async function discard(ctx: Ctx, input: unknown): Promise<{ discarded: boolean }> {
  const cs = mustChangeset(ctx, reqStr(ctx, record(ctx, input), "changesetId"));
  if (cs.state === "discarded") return { discarded: true };
  if (cs.state === "approved") fail(ctx, "validation.precondition_failed", "This changeset was already approved.");
  const id = String(cs.id);
  ctx.db.run("DELETE FROM files_changeset_file WHERE changeset_id = ?", id);
  ctx.db.run("DELETE FROM files_changeset_comment WHERE changeset_id = ?", id);
  ctx.db.run("DELETE FROM files_changeset_review WHERE changeset_id = ?", id);
  const now = ctx.now();
  ctx.db.run("UPDATE files_changeset SET state = ?, reviewer = ?, updated_at = ?, closed_at = ? WHERE id = ?", "discarded", ctx.principal.id, now, now, id);
  ctx.emit("changeset.discarded", `folder/${String(cs.folder_id)}`, { changesetId: id, folderId: String(cs.folder_id), by: ctx.principal.id });
  return { discarded: true };
}

async function revertChange(ctx: Ctx, input: unknown): Promise<{ fileCount: number }> {
  const o = record(ctx, input);
  const cs = mustChangeset(ctx, reqStr(ctx, o, "changesetId"));
  if (!isOpen(cs)) fail(ctx, "validation.precondition_failed", "Only an open changeset can be changed.");
  const path = reqStr(ctx, o, "path");
  const e = entryOf(ctx, String(cs.id), path);
  const hunkId = optStr(ctx, o, "hunkId");
  const id = String(cs.id);
  const drop = (): void => { ctx.db.run("DELETE FROM files_changeset_file WHERE changeset_id = ? AND path = ?", id, path); };
  if (hunkId === undefined) {
    drop();
  } else {
    const { base, staged } = await sidesOf(ctx, e);
    const a = base === undefined ? "" : textOfBytes(base);
    const b = staged === undefined ? "" : textOfBytes(staged);
    if (a === undefined || b === undefined) fail(ctx, "validation.precondition_failed", "A binary file is reverted as a whole.");
    const before = splitLines(a);
    const after = splitLines(b);
    const hunk = hunksOf(lineOps(before, after), undefined).find((h) => h.hunkId === hunkId);
    if (!hunk) return fail(ctx, "validation.not_found", "That change is not in the file.", { hunkId });
    const first = hunk.lines[0];
    const at = first && first.op === "del" ? hunk.newStart : Math.max(0, hunk.newStart - 1);
    const restored = hunk.lines.filter((l) => l.op !== "add").map((l) => l.text);
    const next = after.slice();
    next.splice(at, hunk.newLines, ...restored);
    const bytes = enc.encode(joinLines(next, b.endsWith("\n") || a.endsWith("\n")));
    if (base !== undefined && same(base, bytes)) {
      drop();
    } else if (base === undefined && next.length === 0) {
      drop();
    } else {
      const counts = lineCounts(base, bytes);
      ctx.db.run(
        "UPDATE files_changeset_file SET content = ?, size = ?, added_lines = ?, removed_lines = ?, updated_at = ? WHERE changeset_id = ? AND path = ?",
        seal(ctx, id, bytes), bytes.byteLength, counts.added, counts.removed, ctx.now(), id, path,
      );
    }
  }
  touch(ctx, cs);
  const count = filesOf(ctx, id).length;
  ctx.emit("changeset.updated", `folder/${String(cs.folder_id)}`, { changesetId: id, folderId: String(cs.folder_id), fileCount: count });
  return { fileCount: count };
}

// ---- outside review and comments ----

const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

async function reviewExternally(ctx: Ctx, input: unknown): Promise<{ actorId: string; expiresAt: number }> {
  const o = record(ctx, input);
  const cs = mustChangeset(ctx, reqStr(ctx, o, "changesetId"));
  if (!isOpen(cs)) fail(ctx, "validation.precondition_failed", "Only an open changeset can be sent for review.");
  let actorId = optStr(ctx, o, "actorId");
  let expiresAt = ctx.now() + REVIEW_WINDOW_MS;
  if (actorId === undefined) {
    const made = (await ctx.call("access.actors.create", { name: `Reviewer for ${String(cs.id)}`, provider: "outside" }, { idempotencyKey: `changesets.review_externally:${String(cs.id)}` })) as { actor: { id: string }; expiresAt?: number };
    actorId = made.actor.id;
    if (typeof made.expiresAt === "number") expiresAt = made.expiresAt;
  }
  // read and comment: Use on the folder, never Edit, so changing files stays behind Approve
  await ctx.call("access.share", { resource: { type: "folder", id: String(cs.folder_id) }, subject: { kind: "actor", id: actorId }, level: "use" }, { idempotencyKey: `changesets.review:${String(cs.id)}:${actorId}` });
  ctx.db.run("DELETE FROM files_changeset_review WHERE changeset_id = ? AND actor_id = ?", String(cs.id), actorId);
  ctx.db.run("INSERT INTO files_changeset_review (changeset_id, actor_id, opened_at, expires_at) VALUES (?, ?, ?, ?)", String(cs.id), actorId, ctx.now(), expiresAt);
  ctx.emit("changeset.sent_for_review", `entity/${String(cs.id)}`, { changesetId: String(cs.id), actorId });
  return { actorId, expiresAt };
}

function commentOut(c: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {
    commentId: String(c.id), changesetId: String(c.changeset_id), anchor: JSON.parse(String(c.anchor)) as unknown, text: String(c.text), by: String(c.author), at: num(c.at),
    resolved: flag(c.resolved), mentions: JSON.parse(String(c.mentions)) as string[],
  };
  if (!isNull(c.file_id)) out["fileId"] = String(c.file_id);
  return out;
}

async function commentsList(ctx: Ctx, input: unknown): Promise<{ comments: Record<string, unknown>[] }> {
  const cs = mustChangeset(ctx, reqStr(ctx, record(ctx, input), "changesetId"));
  return { comments: commentsOf(ctx, String(cs.id)).map(commentOut) };
}

async function commentsAdd(ctx: Ctx, input: unknown): Promise<{ comment: Record<string, unknown> }> {
  const o = record(ctx, input);
  const cs = mustChangeset(ctx, reqStr(ctx, o, "changesetId"));
  if (!isOpen(cs)) fail(ctx, "validation.precondition_failed", "This changeset is closed.");
  const text = reqStr(ctx, o, "text");
  const anchor = o["anchor"];
  if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "anchor" });
  const path = (anchor as { path?: unknown }).path;
  let entry: Row | undefined;
  if (typeof path === "string") entry = entryOf(ctx, String(cs.id), path);
  const mentionsIn = o["mentions"];
  if (mentionsIn !== undefined && (!Array.isArray(mentionsIn) || mentionsIn.some((m) => typeof m !== "string"))) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "mentions" });
  const mentions = (mentionsIn as string[] | undefined) ?? [];
  const id = nid(ctx, "fcm");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO files_changeset_comment (id, changeset_id, path, file_id, anchor, text, mentions, author, at, resolved, sent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, String(cs.id), typeof path === "string" ? path : null, entry && !isNull(entry.file_id) ? String(entry.file_id) : null, JSON.stringify(anchor), text, JSON.stringify(mentions), ctx.principal.id, now, 0, 0,
  );
  touch(ctx, cs);
  if (entry && !isNull(entry.file_id)) ctx.emit("file.comment_added", `file/${String(entry.file_id)}`, { fileId: String(entry.file_id), commentId: id, mentions });
  const agents = mentions.filter((m) => m.startsWith("agt_"));
  if (agents.length > 0 && !isNull(cs.thread_id)) {
    // an @ agent answers in the changeset's thread
    await ctx.call("chat.post", { threadId: String(cs.thread_id), body: `${typeof path === "string" ? `${path}: ` : ""}${text}`, mentions: agents.map((a) => ({ kind: "agent", id: a })) }, { idempotencyKey: `changesets.comment:${id}` });
    ctx.db.run("UPDATE files_changeset_comment SET sent = ? WHERE id = ?", 1, id);
  }
  return { comment: commentOut(one(ctx, "SELECT * FROM files_changeset_comment WHERE id = ?", id) ?? {}) };
}

export const changesetHandlers = {
  "files.write": (ctx: Ctx, input: unknown) => stagedWrite(ctx, input),
  "files.create": (ctx: Ctx, input: unknown) => stagedCreate(ctx, input),
  "changesets.list": (ctx: Ctx, input: unknown) => list(ctx, input),
  "changesets.get": (ctx: Ctx, input: unknown) => get(ctx, input),
  "changesets.diff": (ctx: Ctx, input: unknown) => diff(ctx, input),
  "changesets.approve": (ctx: Ctx, input: unknown) => approve(ctx, input),
  "changesets.request_changes": (ctx: Ctx, input: unknown) => requestChanges(ctx, input),
  "changesets.discard": (ctx: Ctx, input: unknown) => discard(ctx, input),
  "changesets.revert_change": (ctx: Ctx, input: unknown) => revertChange(ctx, input),
  "changesets.review_externally": (ctx: Ctx, input: unknown) => reviewExternally(ctx, input),
  "changesets.comments.list": (ctx: Ctx, input: unknown) => commentsList(ctx, input),
  "changesets.comments.add": (ctx: Ctx, input: unknown) => commentsAdd(ctx, input),
};

// What agent-stage.ts builds on: the staging primitives of this file (it stages files.save, files.delete, files.rename and files.move the way files.write is staged above).
export { fail, record, reqStr, optStr, one, many, live, num, flag, isNull, nid, reviewRoot, relPath, stages, changesetFor, reopen, seal, currentBytes, lineCounts, filesOf, touch, isOpen, stagedByProvisional, virtualFile };

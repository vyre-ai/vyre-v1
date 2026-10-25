// files tree: folders, files, versions and the AES-GCM blob store (spec 2.16, 2.4, 3.5; ARCH 7.5).
// Plaintext is sealed with ctx.seal (kernel AES-GCM under the Space key) and stored in files_blob.
// Entity rows live in files_file and files_file_version. Folders, recent, uploads and trash live in migrations/0001_files_tree.sql.
// @reads ../migrations/0001_files_tree.sql
// Agent and UI writes both commit a version here. Changeset staging on Approve is a later packet.

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx, Sealed } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { dropRecent, touchRecent } from "../projections.ts";
import { sharedCount } from "./lists.ts";

export const TRASH_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_INLINE = 256 * 1024;
export const MAX_UPLOAD = 25 * 1024 * 1024;
const UPLOAD_MS = 15 * 60 * 1000;
const PAGE_DEFAULT = 100;

export const TREE_ROOTS: { key: string; title: string; kind: "folder" | "virtual" }[] = [
  { key: "personal", title: "Personal", kind: "folder" },
  { key: "agents", title: "Agents", kind: "folder" },
  { key: "projects", title: "Projects", kind: "folder" },
  { key: "people", title: "People", kind: "folder" },
  { key: "channels", title: "Channels", kind: "folder" },
  { key: "shared_knowledge", title: "Shared knowledge", kind: "folder" },
  { key: "agent_template", title: "Agent template", kind: "folder" },
  { key: "deployments", title: "Deployments", kind: "folder" },
  { key: "github", title: "GitHub", kind: "folder" },
  { key: "recent", title: "Recent", kind: "virtual" },
  { key: "shared", title: "Shared with me", kind: "virtual" },
  { key: "trash", title: "Trash", kind: "virtual" },
  { key: "knowledge", title: "Knowledge", kind: "folder" },
];

export const KNOWLEDGE_CHILDREN: { key: string; title: string }[] = [
  { key: "memory", title: "Memory" },
  { key: "graph", title: "Graph" },
];

export const KINDS = new Set([
  "text", "markdown", "document", "spreadsheet", "presentation", "pdf", "image", "video", "audio", "code", "archive", "google_native", "other",
]);

const LABEL_RANK: Record<string, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

type Row = Record<string, unknown>;

export interface FileOut {
  fileId: string;
  folderId: string;
  name: string;
  kind: string;
  mime: string;
  size: number;
  version: number;
  label: number;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  thumb: boolean;
  holds: number;
  deletedAt?: number;
  source?: { mountId: string; provider: string };
}

export interface FolderOut {
  folderId: string;
  parentId?: string;
  name: string;
  path: string;
  fileCount: number;
  folderCount: number;
  scope: "personal" | "space";
  label: number;
  git: boolean;
  reviewChanges: boolean;
  source?: { mountId: string; provider: string };
}

type Content =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "base64"; base64: string }
  | { kind: "blob"; blobId: string };

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

export function isNull(v: unknown): boolean {
  return v === null || v === undefined;
}

function flag(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

export function one(ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined {
  const rows = ctx.db.all(sql, ...args) as Row[];
  return rows[0];
}

export function many(ctx: Ctx, sql: string, ...args: unknown[]): Row[] {
  return ctx.db.all(sql, ...args) as Row[];
}

export function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

export function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = optStr(ctx, o, key);
  if (v === undefined || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function optBool(ctx: Ctx, o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function optInt(ctx: Ctx, o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function nid(ctx: Ctx, prefix: string): string {
  return `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;
}

function cleanName(ctx: Ctx, name: string): string {
  const n = name.trim();
  if (!n || n.length > 255 || n === "." || n === ".." || n.includes("/") || n.includes("\\") || /[\u0000-\u001f]/.test(n)) {
    fail(ctx, "validation.bad_input", "That name cannot be used for a file or folder.");
  }
  return n;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    bin += String.fromCharCode(...part);
  }
  return btoa(bin);
}

function b64ToBytes(ctx: Ctx, value: string): Uint8Array {
  try {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  } catch {
    fail(ctx, "validation.bad_input", "The file bytes are not valid base64.");
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function guessMime(name: string, asText: boolean): string {
  const ext = extOf(name);
  const known: Record<string, string> = {
    md: "text/markdown", markdown: "text/markdown", txt: "text/plain", json: "application/json",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    pdf: "application/pdf", csv: "text/csv", html: "text/html",
    js: "text/javascript", ts: "text/plain", py: "text/plain",
  };
  if (known[ext]) return known[ext];
  return asText ? "text/plain" : "application/octet-stream";
}

function guessKind(name: string, mime: string): string {
  const ext = extOf(name);
  if (ext === "md" || ext === "markdown" || mime === "text/markdown") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) || mime.startsWith("image/")) return "image";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["csv", "xlsx", "xls"].includes(ext) || mime === "text/csv" || mime.includes("spreadsheet")) return "spreadsheet";
  if (["doc", "docx"].includes(ext)) return "document";
  if (["ppt", "pptx"].includes(ext)) return "presentation";
  if (["mp4", "mov", "webm"].includes(ext) || mime.startsWith("video/")) return "video";
  if (["mp3", "wav", "ogg"].includes(ext) || mime.startsWith("audio/")) return "audio";
  if (["zip", "gz", "tgz"].includes(ext)) return "archive";
  if (["js", "ts", "tsx", "jsx", "py", "go", "rs", "java", "rb"].includes(ext)) return "code";
  if (mime.startsWith("text/") || ext === "txt" || ext === "json") return "text";
  return "other";
}

function textLike(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "text/javascript";
}

function parseContent(ctx: Ctx, value: unknown): Content {
  if (value === undefined || value === null) return { kind: "empty" };
  if (typeof value !== "object" || Array.isArray(value)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "content" });
  const o = value as Record<string, unknown>;
  const present = (["text", "base64", "blobId"] as const).filter((k) => o[k] !== undefined && o[k] !== null);
  if (present.length > 1) fail(ctx, "validation.bad_input", "Send text, base64, or a blob id, one of them.");
  const key = present[0];
  if (!key) return { kind: "empty" };
  if (key === "text") {
    if (typeof o.text !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: "text" });
    return { kind: "text", text: o.text };
  }
  if (key === "base64") {
    if (typeof o.base64 !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: "base64" });
    return { kind: "base64", base64: o.base64 };
  }
  if (typeof o.blobId !== "string" || o.blobId.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "blobId" });
  return { kind: "blob", blobId: o.blobId };
}

function mustFolder(ctx: Ctx, id: string): Row {
  const row = one(ctx, "SELECT * FROM files_folder WHERE id = ?", id);
  if (!row) fail(ctx, "validation.not_found", "That folder is not in this Space.", { folderId: id });
  return row;
}

function liveFolder(ctx: Ctx, id: string): Row {
  const row = mustFolder(ctx, id);
  if (!isNull(row.deleted_at)) fail(ctx, "validation.precondition_failed", "That folder is in Trash.", { folderId: id });
  return row;
}

function mustFile(ctx: Ctx, id: string): Row {
  const row = one(ctx, "SELECT * FROM files_file WHERE id = ?", id);
  if (!row) fail(ctx, "validation.not_found", "That file is not in this Space.", { fileId: id });
  return row;
}

function liveFile(ctx: Ctx, id: string): Row {
  const row = mustFile(ctx, id);
  if (!isNull(row.deleted_at)) fail(ctx, "validation.precondition_failed", "That file is in Trash.", { fileId: id });
  return row;
}

function childCounts(ctx: Ctx, folderId: string): { fileCount: number; folderCount: number } {
  const folders = many(ctx, "SELECT * FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", folderId);
  const files = many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", folderId);
  return { fileCount: files.length, folderCount: folders.length };
}

export function fileOut(row: Row): FileOut {
  const out: FileOut = {
    fileId: String(row.id),
    folderId: String(row.folder_id),
    name: String(row.name),
    kind: String(row.kind),
    mime: String(row.mime),
    size: num(row.size),
    version: num(row.version),
    label: 0,
    ownerId: String(row.owner),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
    updatedBy: String(row.updated_by),
    thumb: false,
    holds: 0,
  };
  if (!isNull(row.deleted_at)) out.deletedAt = num(row.deleted_at);
  if (!isNull(row.source_mount)) out.source = { mountId: String(row.source_mount), provider: "mount" };
  return out;
}

export function folderOut(ctx: Ctx, row: Row): FolderOut {
  const counts = childCounts(ctx, String(row.id));
  const out: FolderOut = {
    folderId: String(row.id),
    name: String(row.name),
    path: String(row.path),
    fileCount: counts.fileCount,
    folderCount: counts.folderCount,
    scope: String(row.scope) === "personal" ? "personal" : "space",
    label: Math.min(3, Math.max(0, num(row.label))),
    git: flag(row.git),
    reviewChanges: flag(row.review_changes),
  };
  if (!isNull(row.parent_id)) out.parentId = String(row.parent_id);
  if (!isNull(row.source_mount) && !isNull(row.source_provider)) {
    out.source = { mountId: String(row.source_mount), provider: String(row.source_provider) };
  }
  return out;
}

function insertFolder(
  ctx: Ctx,
  fields: {
    id: string;
    parentId: string | null;
    name: string;
    path: string;
    scope: "personal" | "space";
    owner: string;
    label: number;
    git: number;
    review: number;
    rootKey: string | null;
    systemKey: string | null;
  },
): void {
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO files_folder (id, parent_id, name, path, scope, owner, label, git, review_changes, source_mount, source_provider, root_key, system_key, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    fields.id, fields.parentId, fields.name, fields.path, fields.scope, fields.owner, fields.label, fields.git, fields.review,
    null, null, fields.rootKey, fields.systemKey, now, now, null,
  );
}

function ensureSpaceRoots(ctx: Ctx): void {
  for (const root of TREE_ROOTS) {
    if (root.kind !== "folder" || root.key === "personal") continue;
    const existing = one(ctx, "SELECT * FROM files_folder WHERE root_key = ?", root.key);
    let row = existing;
    if (!row) {
      const id = nid(ctx, "fld");
      insertFolder(ctx, {
        id, parentId: null, name: root.title, path: root.title, scope: "space", owner: ctx.space,
        label: 0, git: 0, review: 0, rootKey: root.key, systemKey: null,
      });
      row = mustFolder(ctx, id);
    }
    if (root.key !== "knowledge" || !row) continue;
    for (const child of KNOWLEDGE_CHILDREN) {
      const have = one(ctx, "SELECT * FROM files_folder WHERE system_key = ?", child.key);
      if (have) continue;
      const id = nid(ctx, "fld");
      insertFolder(ctx, {
        id, parentId: String(row.id), name: child.title, path: `${String(row.path)}/${child.title}`, scope: "space", owner: ctx.space,
        label: 0, git: 0, review: 0, rootKey: null, systemKey: child.key,
      });
    }
  }
}

function ensurePersonal(ctx: Ctx): Row {
  const key = `personal:${ctx.principal.id}`;
  const existing = one(ctx, "SELECT * FROM files_folder WHERE root_key = ?", key);
  if (existing) return existing;
  const id = nid(ctx, "fld");
  insertFolder(ctx, {
    id, parentId: null, name: "Personal", path: "Personal", scope: "personal", owner: ctx.principal.id,
    label: 0, git: 0, review: 0, rootKey: key, systemKey: null,
  });
  return mustFolder(ctx, id);
}

export function ensureReady(ctx: Ctx): void {
  ensureSpaceRoots(ctx);
  ensurePersonal(ctx);
}

function isRoot(row: Row): boolean {
  return !isNull(row.root_key);
}

function nameTaken(ctx: Ctx, parentId: string, name: string, except?: { kind: "file" | "folder"; id: string }): boolean {
  const folders = many(ctx, "SELECT * FROM files_folder WHERE parent_id = ? AND name = ? AND deleted_at IS NULL", parentId, name);
  const files = many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND name = ? AND deleted_at IS NULL", parentId, name);
  for (const row of folders) {
    if (except?.kind === "folder" && String(row.id) === except.id) continue;
    return true;
  }
  for (const row of files) {
    if (except?.kind === "file" && String(row.id) === except.id) continue;
    return true;
  }
  return false;
}

function rewritePaths(ctx: Ctx, oldPath: string, newPath: string): void {
  const rows = many(ctx, "SELECT * FROM files_folder");
  const now = ctx.now();
  for (const row of rows) {
    const path = String(row.path);
    if (path === oldPath || !path.startsWith(`${oldPath}/`)) continue;
    const next = newPath + path.slice(oldPath.length);
    ctx.db.run("UPDATE files_folder SET path = ?, updated_at = ? WHERE id = ?", next, now, row.id);
  }
}

function scopeOf(row: Row): "personal" | "space" {
  return String(row.scope) === "personal" ? "personal" : "space";
}

function applyScope(ctx: Ctx, folder: Row, scope: "personal" | "space"): void {
  const path = String(folder.path);
  const now = ctx.now();
  const rows = many(ctx, "SELECT * FROM files_folder");
  for (const row of rows) {
    const p = String(row.path);
    if (String(row.id) !== String(folder.id) && p !== path && !p.startsWith(`${path}/`)) continue;
    if (scopeOf(row) === scope) continue;
    ctx.db.run("UPDATE files_folder SET scope = ?, updated_at = ? WHERE id = ?", scope, now, row.id);
  }
}

function blobScope(ctx: Ctx, blobId: string): string {
  return `files.blob:${ctx.space}:${blobId}`;
}

async function putBlob(ctx: Ctx, plain: Uint8Array, mime: string, id: string): Promise<{ id: string; hash: string }> {
  const hash = await sha256(plain);
  const sealed: Sealed = ctx.seal.seal(plain, blobScope(ctx, id));
  ctx.db.run(
    "INSERT INTO files_blob (id, hash, size, mime, key_id, nonce, bytes, scope, created_at, refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, hash, plain.byteLength, mime, sealed.keyId, sealed.nonce, sealed.bytes, blobScope(ctx, id), ctx.now(), 0,
  );
  return { id, hash };
}

async function blobForPlain(ctx: Ctx, plain: Uint8Array, mime: string): Promise<{ id: string; hash: string; size: number }> {
  if (plain.byteLength > MAX_INLINE) fail(ctx, "validation.too_large", "This file is over the size limit for a direct write.");
  const hash = await sha256(plain);
  const existing = one(ctx, "SELECT * FROM files_blob WHERE hash = ?", hash);
  if (existing) return { id: String(existing.id), hash, size: num(existing.size) };
  const id = nid(ctx, "blb");
  await putBlob(ctx, plain, mime, id);
  return { id, hash, size: plain.byteLength };
}

function addRef(ctx: Ctx, blobId: string): void {
  const row = one(ctx, "SELECT * FROM files_blob WHERE id = ?", blobId);
  if (!row) fail(ctx, "validation.not_found", "That blob is not in the store.", { blobId });
  ctx.db.run("UPDATE files_blob SET refs = ? WHERE id = ?", num(row.refs) + 1, blobId);
}

function releaseRef(ctx: Ctx, blobId: string): void {
  const row = one(ctx, "SELECT * FROM files_blob WHERE id = ?", blobId);
  if (!row) return;
  const next = num(row.refs) - 1;
  if (next <= 0) ctx.db.run("DELETE FROM files_blob WHERE id = ?", blobId);
  else ctx.db.run("UPDATE files_blob SET refs = ? WHERE id = ?", next, blobId);
}

function openBlob(ctx: Ctx, blobId: string): Uint8Array {
  const row = one(ctx, "SELECT * FROM files_blob WHERE id = ?", blobId);
  if (!row) fail(ctx, "validation.not_found", "That blob is not in the store.", { blobId });
  try {
    return ctx.seal.unseal({ keyId: String(row.key_id), nonce: String(row.nonce), bytes: String(row.bytes) });
  } catch {
    fail(ctx, "internal.unexpected", "The blob failed its integrity check.", { blobId });
  }
}

function plainOf(ctx: Ctx, content: Content): Uint8Array | undefined {
  if (content.kind === "empty") return new Uint8Array();
  if (content.kind === "text") return new TextEncoder().encode(content.text);
  if (content.kind === "base64") return b64ToBytes(ctx, content.base64);
  return undefined;
}

async function resolveBlob(ctx: Ctx, content: Content, mime: string): Promise<{ blobId: string; size: number; mime: string }> {
  if (content.kind === "blob") {
    const row = one(ctx, "SELECT * FROM files_blob WHERE id = ?", content.blobId);
    if (!row) fail(ctx, "validation.not_found", "That blob is not in the store.", { blobId: content.blobId });
    const storedMime = !isNull(row.mime) && String(row.mime).length > 0 ? String(row.mime) : mime;
    return { blobId: String(row.id), size: num(row.size), mime: mime || storedMime };
  }
  const plain = plainOf(ctx, content) ?? new Uint8Array();
  const stored = await blobForPlain(ctx, plain, mime);
  return { blobId: stored.id, size: stored.size, mime };
}

function addVersion(ctx: Ctx, fileId: string, n: number, blobId: string, reason: string | undefined, name: string | undefined): string {
  const id = nid(ctx, "ver");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO files_file_version (id, file_id, n, blob, actor, reason, name, at, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, fileId, n, blobId, ctx.principal.id, reason ?? null, name ?? null, now, 1, now, null,
  );
  addRef(ctx, blobId);
  return id;
}

function versionsOf(ctx: Ctx, fileId: string): Row[] {
  return many(ctx, "SELECT * FROM files_file_version WHERE file_id = ?", fileId).sort((a, b) => num(b.n) - num(a.n));
}

function versionOut(row: Row): { versionId: string; n: number; by: string; at: number; reason?: string; name?: string } {
  const out: { versionId: string; n: number; by: string; at: number; reason?: string; name?: string } = {
    versionId: String(row.id),
    n: num(row.n),
    by: String(row.actor),
    at: num(row.at),
  };
  if (!isNull(row.reason) && String(row.reason).length > 0) out.reason = String(row.reason);
  if (!isNull(row.name) && String(row.name).length > 0) out.name = String(row.name);
  return out;
}

function noteOpen(ctx: Ctx, fileId: string): void {
  touchRecent(ctx.db, fileId, ctx.principal.id, ctx.now());
}

export function pageArgs(ctx: Ctx, o: Record<string, unknown>, fallback: number): { offset: number; limit: number } {
  const limit = optInt(ctx, o, "limit") ?? fallback;
  if (limit < 1 || limit > 500) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  const cursor = optStr(ctx, o, "cursor");
  if (cursor === undefined || cursor === "") return { offset: 0, limit };
  if (!/^[0-9]+$/.test(cursor)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "cursor" });
  return { offset: Number(cursor), limit };
}

export function slicePage<T>(rows: T[], offset: number, limit: number): { rows: T[]; total: number; next?: string } {
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);
  const out: { rows: T[]; total: number; next?: string } = { rows: page, total };
  if (offset + limit < total) out.next = String(offset + limit);
  return out;
}

function sortRows<T extends { name: string; updatedAt: number; size: number; kind: string; id: string }>(
  rows: T[],
  sort: string,
  dir: string,
): T[] {
  const sign = dir === "desc" ? -1 : 1;
  const key = (row: T): string | number => {
    if (sort === "updated") return row.updatedAt;
    if (sort === "size") return row.size;
    if (sort === "kind") return row.kind;
    return row.name.toLowerCase();
  };
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    let c = 0;
    if (typeof ka === "number" && typeof kb === "number") c = ka - kb;
    else c = String(ka).localeCompare(String(kb), "en");
    if (c === 0) c = a.id.localeCompare(b.id);
    return c * sign;
  });
}

function liveChildren(ctx: Ctx, folderId: string): { folders: Row[]; files: Row[] } {
  return {
    folders: many(ctx, "SELECT * FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", folderId),
    files: many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", folderId),
  };
}

function recentCount(ctx: Ctx): number {
  const rows = many(ctx, "SELECT * FROM files_recent WHERE actor = ?", ctx.principal.id);
  let n = 0;
  for (const row of rows) {
    const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", row.file_id);
    if (file && isNull(file.deleted_at)) n += 1;
  }
  return n;
}

function trashFresh(ctx: Ctx, deletedAt: number): boolean {
  return ctx.now() - deletedAt < TRASH_MS;
}

function trashTop(ctx: Ctx): { files: Row[]; folders: Row[] } {
  const rows = many(ctx, "SELECT * FROM files_trash");
  const files: Row[] = [];
  const folders: Row[] = [];
  for (const row of rows) {
    if (String(row.id) !== String(row.root_id)) continue;
    if (!trashFresh(ctx, num(row.deleted_at))) continue;
    if (String(row.kind) === "file") {
      const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", row.id);
      if (file) files.push(file);
    } else {
      const folder = one(ctx, "SELECT * FROM files_folder WHERE id = ?", row.id);
      if (folder) folders.push(folder);
    }
  }
  return { files, folders };
}

async function filesTree(ctx: Ctx): Promise<{ roots: { key: string; title: string; kind: "folder" | "virtual"; folderId?: string; count: number }[] }> {
  ensureReady(ctx);
  const roots: { key: string; title: string; kind: "folder" | "virtual"; folderId?: string; count: number }[] = [];
  for (const root of TREE_ROOTS) {
    if (root.kind === "virtual") {
      let count = 0;
      if (root.key === "recent") count = recentCount(ctx);
      else if (root.key === "trash") count = trashTop(ctx).files.length + trashTop(ctx).folders.length;
      else if (root.key === "shared") {
        // what access lists for the caller; a badge never takes the whole tree down, so an access failure is a warning and a zero
        try { count = await sharedCount(ctx); } catch (e) { ctx.log.warn("files: could not count Shared with me", { error: e instanceof Error ? e.message : String(e) }); }
      }
      roots.push({ key: root.key, title: root.title, kind: "virtual", count });
      continue;
    }
    const row = root.key === "personal"
      ? ensurePersonal(ctx)
      : one(ctx, "SELECT * FROM files_folder WHERE root_key = ?", root.key);
    if (!row) continue;
    const counts = childCounts(ctx, String(row.id));
    roots.push({ key: root.key, title: root.title, kind: "folder", folderId: String(row.id), count: counts.fileCount + counts.folderCount });
  }
  return { roots };
}

async function filesList(ctx: Ctx, input: unknown): Promise<{ files: FileOut[]; folders: FolderOut[]; total: number; next?: string }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const section = optStr(ctx, o, "section");
  const folderId = optStr(ctx, o, "folder");
  const kind = optStr(ctx, o, "kind");
  const sort = optStr(ctx, o, "sort") ?? "name";
  const dir = optStr(ctx, o, "dir") ?? "asc";
  if (kind !== undefined && !KINDS.has(kind)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "kind" });
  if (!["name", "updated", "size", "kind"].includes(sort)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "sort" });
  if (!["asc", "desc"].includes(dir)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "dir" });
  if (section !== undefined && !["personal", "shared", "space"].includes(section)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "section" });
  const { offset, limit } = pageArgs(ctx, o, PAGE_DEFAULT);

  let folderRows: Row[] = [];
  let fileRows: Row[] = [];
  let preserveOrder = false;

  if (folderId) {
    liveFolder(ctx, folderId);
    const kids = liveChildren(ctx, folderId);
    folderRows = kids.folders;
    fileRows = kids.files;
  } else if (section === "shared") {
    folderRows = [];
    fileRows = [];
  } else if (section === "space") {
    preserveOrder = sort === "name" && dir === "asc" && optStr(ctx, o, "sort") === undefined;
    for (const root of TREE_ROOTS) {
      if (root.kind !== "folder" || root.key === "personal") continue;
      const row = one(ctx, "SELECT * FROM files_folder WHERE root_key = ? AND deleted_at IS NULL", root.key);
      if (row) folderRows.push(row);
    }
  } else {
    const personal = ensurePersonal(ctx);
    const kids = liveChildren(ctx, String(personal.id));
    folderRows = kids.folders;
    fileRows = kids.files;
  }

  if (kind) {
    fileRows = fileRows.filter((row) => String(row.kind) === kind);
    folderRows = [];
  }

  type Item = { kind: "folder" | "file"; id: string; name: string; updatedAt: number; size: number; sortKind: string; row: Row };
  let items: Item[] = [
    ...folderRows.map((row) => ({ kind: "folder" as const, id: String(row.id), name: String(row.name), updatedAt: num(row.updated_at), size: 0, sortKind: "folder", row })),
    ...fileRows.map((row) => ({ kind: "file" as const, id: String(row.id), name: String(row.name), updatedAt: num(row.updated_at), size: num(row.size), sortKind: String(row.kind), row })),
  ];
  if (!preserveOrder) {
    const folders = sortRows(items.filter((i) => i.kind === "folder").map((i) => ({ ...i, kind: i.sortKind })), sort, dir);
    const files = sortRows(items.filter((i) => i.kind === "file").map((i) => ({ ...i, kind: i.sortKind })), sort, dir);
    items = [
      ...folders.map((i) => items.find((x) => x.id === i.id)!),
      ...files.map((i) => items.find((x) => x.id === i.id)!),
    ];
  }
  const paged = slicePage(items, offset, limit);
  const out: { files: FileOut[]; folders: FolderOut[]; total: number; next?: string } = {
    files: paged.rows.filter((i) => i.kind === "file").map((i) => fileOut(i.row)),
    folders: paged.rows.filter((i) => i.kind === "folder").map((i) => folderOut(ctx, i.row)),
    total: paged.total,
  };
  if (paged.next !== undefined) out.next = paged.next;
  return out;
}

async function filesRecent(ctx: Ctx, input: unknown): Promise<{ files: FileOut[] }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const limit = optInt(ctx, o, "limit") ?? 50;
  if (limit < 1 || limit > 200) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  const rows = many(ctx, "SELECT * FROM files_recent WHERE actor = ?", ctx.principal.id)
    .sort((a, b) => num(b.at) - num(a.at));
  const files: FileOut[] = [];
  for (const row of rows) {
    if (files.length >= limit) break;
    const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", row.file_id);
    if (!file || !isNull(file.deleted_at)) continue;
    files.push(fileOut(file));
  }
  return { files };
}

async function filesResolve(ctx: Ctx, input: unknown): Promise<{ kind: "file" | "folder"; fileId?: string; folderId?: string }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const raw = reqStr(ctx, o, "path").trim().replace(/^\/+/, "");
  const parts = raw.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "path" });
  const head = parts[0]!;
  let folder: Row | undefined;
  if (head === "Personal") folder = ensurePersonal(ctx);
  else folder = one(ctx, "SELECT * FROM files_folder WHERE parent_id IS NULL AND name = ? AND deleted_at IS NULL", head);
  if (!folder || !isNull(folder.deleted_at)) fail(ctx, "validation.not_found", "That path is not in this Space.", { field: "path" });
  if (parts.length === 1) return { kind: "folder", folderId: String(folder.id) };
  for (let i = 1; i < parts.length; i++) {
    const name = parts[i]!;
    const last = i === parts.length - 1;
    const child = one(ctx, "SELECT * FROM files_folder WHERE parent_id = ? AND name = ? AND deleted_at IS NULL", folder.id, name);
    if (child) {
      if (last) return { kind: "folder", folderId: String(child.id) };
      folder = child;
      continue;
    }
    if (last) {
      const file = one(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND name = ? AND deleted_at IS NULL", folder.id, name);
      if (file) return { kind: "file", fileId: String(file.id), folderId: String(folder.id) };
    }
    fail(ctx, "validation.not_found", "That path is not in this Space.", { field: "path" });
  }
  fail(ctx, "validation.not_found", "That path is not in this Space.", { field: "path" });
}

async function filesGet(ctx: Ctx, input: unknown): Promise<{ file: FileOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  return { file: fileOut(mustFile(ctx, reqStr(ctx, o, "fileId"))) };
}

async function filesRead(ctx: Ctx, input: unknown): Promise<{ text?: string; base64?: string; url?: string; mime: string; size: number; version: number; truncated: boolean }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = mustFile(ctx, reqStr(ctx, o, "fileId"));
  const versionId = optStr(ctx, o, "versionId");
  let blobId = String(file.blob);
  let n = num(file.version);
  if (versionId) {
    const version = one(ctx, "SELECT * FROM files_file_version WHERE id = ?", versionId);
    if (!version || String(version.file_id) !== String(file.id)) fail(ctx, "validation.not_found", "That version is not on this file.", { versionId });
    blobId = String(version.blob);
    n = num(version.n);
  }
  const mime = String(file.mime);
  const size = num(file.size);
  const as = optStr(ctx, o, "as") ?? (textLike(mime) ? "text" : "base64");
  if (!["text", "base64", "url"].includes(as)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "as" });
  noteOpen(ctx, String(file.id));
  ctx.log.info("files.read", { fileId: String(file.id), version: n });
  if (as === "url") {
    return { url: `/spaces/${ctx.space}/files/${String(file.id)}?version=${n}`, mime, size, version: n, truncated: false };
  }
  const offset = optInt(ctx, o, "offset") ?? 0;
  const length = optInt(ctx, o, "length");
  if (offset < 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "offset" });
  if (length !== undefined && length < 1) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "length" });
  const plain = openBlob(ctx, blobId);
  const end = length === undefined ? plain.byteLength : Math.min(plain.byteLength, offset + length);
  const slice = plain.subarray(Math.min(offset, plain.byteLength), end);
  const truncated = offset > 0 || end < plain.byteLength;
  if (as === "text") {
    if (slice.byteLength > MAX_INLINE) fail(ctx, "validation.too_large", "This file is over the size limit to read as text.");
    return { text: new TextDecoder().decode(slice), mime, size: plain.byteLength, version: n, truncated };
  }
  return { base64: bytesToB64(slice), mime, size: plain.byteLength, version: n, truncated };
}

async function folderGet(ctx: Ctx, input: unknown): Promise<{ folder: FolderOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  return { folder: folderOut(ctx, mustFolder(ctx, reqStr(ctx, o, "folderId"))) };
}

async function folderSearch(ctx: Ctx, input: unknown): Promise<{ folders: FolderOut[] }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const q = reqStr(ctx, o, "q").trim().toLowerCase();
  const scope = optStr(ctx, o, "scope") ?? "all";
  const limit = optInt(ctx, o, "limit") ?? 20;
  if (!["folders", "channels", "all"].includes(scope)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "scope" });
  if (limit < 1 || limit > 50) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  if (!q) return { folders: [] };
  const rows = many(ctx, "SELECT * FROM files_folder WHERE deleted_at IS NULL").filter((row) => {
    if (!String(row.name).toLowerCase().includes(q)) return false;
    const path = String(row.path);
    const inChannels = path === "Channels" || path.startsWith("Channels/");
    if (scope === "channels") return inChannels;
    if (scope === "folders") return !inChannels;
    return true;
  });
  return { folders: rows.slice(0, limit).map((row) => folderOut(ctx, row)) };
}

async function trashList(ctx: Ctx, input: unknown): Promise<{ files: FileOut[]; folders: FolderOut[]; total: number; next?: string }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const { offset, limit } = pageArgs(ctx, o, PAGE_DEFAULT);
  const top = trashTop(ctx);
  type Item = { kind: "file" | "folder"; at: number; id: string; row: Row };
  const items: Item[] = [
    ...top.folders.map((row) => ({ kind: "folder" as const, at: num(row.deleted_at), id: String(row.id), row })),
    ...top.files.map((row) => ({ kind: "file" as const, at: num(row.deleted_at), id: String(row.id), row })),
  ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const paged = slicePage(items, offset, limit);
  const out: { files: FileOut[]; folders: FolderOut[]; total: number; next?: string } = {
    files: paged.rows.filter((i) => i.kind === "file").map((i) => fileOut(i.row)),
    folders: paged.rows.filter((i) => i.kind === "folder").map((i) => folderOut(ctx, i.row)),
    total: paged.total,
  };
  if (paged.next !== undefined) out.next = paged.next;
  return out;
}

async function folderCreate(ctx: Ctx, input: unknown): Promise<{ folder: FolderOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const parent = liveFolder(ctx, reqStr(ctx, o, "parentId"));
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  if (nameTaken(ctx, String(parent.id), name)) fail(ctx, "validation.duplicate", "That name is already in this folder.");
  const review = optBool(ctx, o, "reviewChanges");
  const id = nid(ctx, "fld");
  insertFolder(ctx, {
    id,
    parentId: String(parent.id),
    name,
    path: `${String(parent.path)}/${name}`,
    scope: scopeOf(parent),
    owner: ctx.principal.id,
    label: num(parent.label),
    git: flag(parent.git) ? 1 : 0,
    review: review === undefined ? (flag(parent.review_changes) ? 1 : 0) : (review ? 1 : 0),
    rootKey: null,
    systemKey: null,
  });
  ctx.emit("folder.created", `folder/${id}`, { folderId: id, parentId: String(parent.id), name });
  ctx.log.info("files.folder.create", { folderId: id });
  return { folder: folderOut(ctx, mustFolder(ctx, id)) };
}

async function folderRename(ctx: Ctx, input: unknown): Promise<{ folder: FolderOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const row = liveFolder(ctx, reqStr(ctx, o, "folderId"));
  if (isRoot(row)) fail(ctx, "validation.precondition_failed", "A root folder keeps its name.");
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  const from = String(row.name);
  if (name === from) return { folder: folderOut(ctx, row) };
  if (isNull(row.parent_id)) fail(ctx, "validation.precondition_failed", "A root folder keeps its name.");
  if (nameTaken(ctx, String(row.parent_id), name, { kind: "folder", id: String(row.id) })) {
    fail(ctx, "validation.duplicate", "That name is already in this folder.");
  }
  const parent = mustFolder(ctx, String(row.parent_id));
  const newPath = `${String(parent.path)}/${name}`;
  const oldPath = String(row.path);
  const now = ctx.now();
  ctx.db.run("UPDATE files_folder SET name = ?, path = ?, updated_at = ? WHERE id = ?", name, newPath, now, row.id);
  rewritePaths(ctx, oldPath, newPath);
  ctx.emit("folder.renamed", `folder/${String(row.id)}`, { folderId: String(row.id), from, to: name });
  return { folder: folderOut(ctx, mustFolder(ctx, String(row.id))) };
}

function underPath(row: Row, ancestor: Row): boolean {
  const path = String(row.path);
  const root = String(ancestor.path);
  return String(row.id) === String(ancestor.id) || path === root || path.startsWith(`${root}/`);
}

async function folderMove(ctx: Ctx, input: unknown): Promise<{ folder: FolderOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const row = liveFolder(ctx, reqStr(ctx, o, "folderId"));
  const dest = liveFolder(ctx, reqStr(ctx, o, "toParentId"));
  if (isRoot(row)) fail(ctx, "validation.precondition_failed", "A root folder stays where it is.");
  if (String(dest.id) === String(row.id) || underPath(dest, row)) {
    fail(ctx, "validation.precondition_failed", "A folder cannot move into itself.");
  }
  if (nameTaken(ctx, String(dest.id), String(row.name), { kind: "folder", id: String(row.id) })) {
    fail(ctx, "validation.duplicate", "That name is already in this folder.");
  }
  const fromParent = isNull(row.parent_id) ? undefined : String(row.parent_id);
  const oldPath = String(row.path);
  const newPath = `${String(dest.path)}/${String(row.name)}`;
  const now = ctx.now();
  ctx.db.run("UPDATE files_folder SET parent_id = ?, path = ?, updated_at = ? WHERE id = ?", dest.id, newPath, now, row.id);
  rewritePaths(ctx, oldPath, newPath);
  applyScope(ctx, mustFolder(ctx, String(row.id)), scopeOf(dest));
  const payload: { folderId: string; fromParentId?: string; toParentId: string } = { folderId: String(row.id), toParentId: String(dest.id) };
  if (fromParent !== undefined) payload.fromParentId = fromParent;
  ctx.emit("folder.moved", `folder/${String(row.id)}`, payload);
  return { folder: folderOut(ctx, mustFolder(ctx, String(row.id))) };
}

function markTrash(ctx: Ctx, kind: "file" | "folder", id: string, rootId: string, at: number): void {
  if (one(ctx, "SELECT * FROM files_trash WHERE id = ?", id)) return;
  ctx.db.run("INSERT INTO files_trash (id, kind, root_id, deleted_at) VALUES (?, ?, ?, ?)", id, kind, rootId, at);
}

async function folderDelete(ctx: Ctx, input: unknown): Promise<{ deleted: boolean }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const row = mustFolder(ctx, reqStr(ctx, o, "folderId"));
  if (isRoot(row)) fail(ctx, "validation.precondition_failed", "A root folder stays in the tree.");
  if (!isNull(row.deleted_at)) return { deleted: true };
  const now = ctx.now();
  const path = String(row.path);
  const folders = many(ctx, "SELECT * FROM files_folder WHERE deleted_at IS NULL").filter((f) => underPath(f, row) || String(f.path) === path);
  const folderIds = new Set(folders.map((f) => String(f.id)));
  folderIds.add(String(row.id));
  const files = many(ctx, "SELECT * FROM files_file WHERE deleted_at IS NULL").filter((f) => folderIds.has(String(f.folder_id)));
  for (const folder of folders) {
    ctx.db.run("UPDATE files_folder SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, folder.id);
    markTrash(ctx, "folder", String(folder.id), String(row.id), now);
  }
  if (!folderIds.has(String(row.id)) || !folders.some((f) => String(f.id) === String(row.id))) {
    ctx.db.run("UPDATE files_folder SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, row.id);
    markTrash(ctx, "folder", String(row.id), String(row.id), now);
  }
  for (const file of files) {
    ctx.db.run("UPDATE files_file SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, file.id);
    markTrash(ctx, "file", String(file.id), String(row.id), now);
    dropRecent(ctx.db, String(file.id));
  }
  ctx.emit("folder.deleted", `folder/${String(row.id)}`, { folderId: String(row.id) });
  return { deleted: true };
}

async function folderRestore(ctx: Ctx, input: unknown): Promise<{ folder: FolderOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const row = mustFolder(ctx, reqStr(ctx, o, "folderId"));
  if (isNull(row.deleted_at)) return { folder: folderOut(ctx, row) };
  if (!isNull(row.parent_id)) {
    const parent = mustFolder(ctx, String(row.parent_id));
    if (!isNull(parent.deleted_at)) fail(ctx, "validation.precondition_failed", "The parent folder is in Trash.");
    if (nameTaken(ctx, String(parent.id), String(row.name), { kind: "folder", id: String(row.id) })) {
      fail(ctx, "validation.duplicate", "That name is already in this folder.");
    }
  }
  const rows = many(ctx, "SELECT * FROM files_trash WHERE root_id = ?", row.id);
  for (const item of rows) {
    if (String(item.kind) === "file") ctx.db.run("UPDATE files_file SET deleted_at = ? WHERE id = ?", null, item.id);
    else ctx.db.run("UPDATE files_folder SET deleted_at = ? WHERE id = ?", null, item.id);
    ctx.db.run("DELETE FROM files_trash WHERE id = ?", item.id);
  }
  ctx.db.run("UPDATE files_folder SET deleted_at = ? WHERE id = ?", null, row.id);
  ctx.db.run("DELETE FROM files_trash WHERE id = ?", row.id);
  ctx.emit("folder.restored", `folder/${String(row.id)}`, { folderId: String(row.id) });
  return { folder: folderOut(ctx, mustFolder(ctx, String(row.id))) };
}

async function folderSettings(ctx: Ctx, input: unknown): Promise<{ folder: FolderOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const row = liveFolder(ctx, reqStr(ctx, o, "folderId"));
  const review = optBool(ctx, o, "reviewChanges");
  const labelName = optStr(ctx, o, "label");
  if (review === undefined && labelName === undefined) fail(ctx, "validation.bad_input", "The input is not valid.");
  const fields: string[] = [];
  let label = num(row.label);
  let reviewBit = flag(row.review_changes) ? 1 : 0;
  if (review !== undefined) {
    reviewBit = review ? 1 : 0;
    fields.push("reviewChanges");
  }
  if (labelName !== undefined) {
    const rank = LABEL_RANK[labelName];
    if (rank === undefined) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "label" });
    label = rank;
    fields.push("label");
  }
  const now = ctx.now();
  ctx.db.run("UPDATE files_folder SET review_changes = ?, label = ?, updated_at = ? WHERE id = ?", reviewBit, label, now, row.id);
  ctx.emit("folder.settings_changed", `folder/${String(row.id)}`, { folderId: String(row.id), fields });
  return { folder: folderOut(ctx, mustFolder(ctx, String(row.id))) };
}

function chosenKind(ctx: Ctx, given: string | undefined, name: string, mime: string): string {
  if (given === undefined) return guessKind(name, mime);
  if (!KINDS.has(given)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "kind" });
  return given;
}

async function filesCreate(ctx: Ctx, input: unknown): Promise<{ file: FileOut; changesetId?: string }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const folder = liveFolder(ctx, reqStr(ctx, o, "folderId"));
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  if (nameTaken(ctx, String(folder.id), name)) fail(ctx, "validation.duplicate", "That name is already in this folder.");
  const content = parseContent(ctx, o.content);
  const mimeHint = optStr(ctx, o, "mime") ?? guessMime(name, content.kind === "text" || content.kind === "empty");
  const kind = chosenKind(ctx, optStr(ctx, o, "kind"), name, mimeHint);
  const blob = await resolveBlob(ctx, content, mimeHint);
  const id = nid(ctx, "fil");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO files_file (id, folder_id, name, kind, mime, size, blob, owner, source_mount, created_at, updated_by, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, folder.id, name, kind, blob.mime, blob.size, blob.blobId, ctx.principal.id, null, now, ctx.principal.id, 1, now, null,
  );
  const versionId = addVersion(ctx, id, 1, blob.blobId, undefined, undefined);
  noteOpen(ctx, id);
  ctx.emit("file.created", `file/${id}`, { fileId: id, folderId: String(folder.id), name, kind, by: ctx.principal.id });
  ctx.emit("file.version_added", `file/${id}`, { fileId: id, versionId, n: 1, by: ctx.principal.id });
  ctx.log.info("files.create", { fileId: id, folderId: String(folder.id), bytes: blob.size });
  return { file: fileOut(mustFile(ctx, id)) };
}

async function filesWrite(ctx: Ctx, input: unknown): Promise<{ file: FileOut; versionId?: string; changesetId?: string }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = liveFile(ctx, reqStr(ctx, o, "fileId"));
  const base = optInt(ctx, o, "baseVersion");
  if (base !== undefined && base !== num(file.version)) {
    fail(ctx, "validation.version_conflict", "The file changed since it was read.");
  }
  const reason = optStr(ctx, o, "reason");
  const content = parseContent(ctx, o.content);
  if (content.kind === "empty" && o.content === undefined) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "content" });
  const mime = String(file.mime);
  const blob = await resolveBlob(ctx, content, mime);
  const n = num(file.version) + 1;
  const now = ctx.now();
  ctx.db.run(
    "UPDATE files_file SET blob = ?, size = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    blob.blobId, blob.size, n, now, ctx.principal.id, file.id,
  );
  const versionId = addVersion(ctx, String(file.id), n, blob.blobId, reason, undefined);
  noteOpen(ctx, String(file.id));
  const payload: { fileId: string; versionId: string; n: number; by: string; reason?: string } = {
    fileId: String(file.id), versionId, n, by: ctx.principal.id,
  };
  if (reason !== undefined) payload.reason = reason;
  ctx.emit("file.version_added", `file/${String(file.id)}`, payload);
  ctx.log.info("files.write", { fileId: String(file.id), version: n, bytes: blob.size });
  return { file: fileOut(mustFile(ctx, String(file.id))), versionId };
}

async function filesRename(ctx: Ctx, input: unknown): Promise<{ file: FileOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = liveFile(ctx, reqStr(ctx, o, "fileId"));
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  const from = String(file.name);
  if (name === from) return { file: fileOut(file) };
  if (nameTaken(ctx, String(file.folder_id), name, { kind: "file", id: String(file.id) })) {
    fail(ctx, "validation.duplicate", "That name is already in this folder.");
  }
  const now = ctx.now();
  ctx.db.run("UPDATE files_file SET name = ?, updated_at = ?, updated_by = ? WHERE id = ?", name, now, ctx.principal.id, file.id);
  noteOpen(ctx, String(file.id));
  ctx.emit("file.renamed", `file/${String(file.id)}`, { fileId: String(file.id), from, to: name });
  return { file: fileOut(mustFile(ctx, String(file.id))) };
}

async function filesMove(ctx: Ctx, input: unknown): Promise<{ file: FileOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = liveFile(ctx, reqStr(ctx, o, "fileId"));
  const dest = liveFolder(ctx, reqStr(ctx, o, "toFolderId"));
  const nextName = optStr(ctx, o, "name");
  const name = nextName === undefined ? String(file.name) : cleanName(ctx, nextName);
  const fromFolder = String(file.folder_id);
  if (fromFolder === String(dest.id) && name === String(file.name)) return { file: fileOut(file) };
  if (nameTaken(ctx, String(dest.id), name, { kind: "file", id: String(file.id) })) {
    fail(ctx, "validation.duplicate", "That name is already in this folder.");
  }
  const now = ctx.now();
  ctx.db.run(
    "UPDATE files_file SET folder_id = ?, name = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    dest.id, name, now, ctx.principal.id, file.id,
  );
  noteOpen(ctx, String(file.id));
  ctx.emit("file.moved", `file/${String(file.id)}`, { fileId: String(file.id), fromFolderId: fromFolder, toFolderId: String(dest.id) });
  if (name !== String(file.name)) ctx.emit("file.renamed", `file/${String(file.id)}`, { fileId: String(file.id), from: String(file.name), to: name });
  return { file: fileOut(mustFile(ctx, String(file.id))) };
}

async function filesCopy(ctx: Ctx, input: unknown): Promise<{ file: FileOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = liveFile(ctx, reqStr(ctx, o, "fileId"));
  const dest = liveFolder(ctx, reqStr(ctx, o, "toFolderId"));
  const name = cleanName(ctx, optStr(ctx, o, "name") ?? String(file.name));
  if (nameTaken(ctx, String(dest.id), name)) fail(ctx, "validation.duplicate", "That name is already in this folder.");
  const id = nid(ctx, "fil");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO files_file (id, folder_id, name, kind, mime, size, blob, owner, source_mount, created_at, updated_by, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, dest.id, name, file.kind, file.mime, file.size, file.blob, ctx.principal.id, null, now, ctx.principal.id, 1, now, null,
  );
  const versionId = addVersion(ctx, id, 1, String(file.blob), undefined, undefined);
  noteOpen(ctx, id);
  ctx.emit("file.created", `file/${id}`, { fileId: id, folderId: String(dest.id), name, kind: String(file.kind), by: ctx.principal.id });
  ctx.emit("file.version_added", `file/${id}`, { fileId: id, versionId, n: 1, by: ctx.principal.id });
  return { file: fileOut(mustFile(ctx, id)) };
}

async function filesDelete(ctx: Ctx, input: unknown): Promise<{ deleted: boolean }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = mustFile(ctx, reqStr(ctx, o, "fileId"));
  if (!isNull(file.deleted_at)) return { deleted: true };
  const now = ctx.now();
  ctx.db.run("UPDATE files_file SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, file.id);
  markTrash(ctx, "file", String(file.id), String(file.id), now);
  dropRecent(ctx.db, String(file.id));
  ctx.emit("file.deleted", `file/${String(file.id)}`, { fileId: String(file.id), folderId: String(file.folder_id) });
  return { deleted: true };
}

async function filesRestore(ctx: Ctx, input: unknown): Promise<{ file: FileOut }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = mustFile(ctx, reqStr(ctx, o, "fileId"));
  const toFolderId = optStr(ctx, o, "toFolderId");
  let folderId = String(file.folder_id);
  if (toFolderId !== undefined) {
    liveFolder(ctx, toFolderId);
    folderId = toFolderId;
  } else {
    const parent = mustFolder(ctx, folderId);
    if (!isNull(parent.deleted_at)) fail(ctx, "validation.precondition_failed", "The parent folder is in Trash.");
  }
  if (!isNull(file.deleted_at) && nameTaken(ctx, folderId, String(file.name), { kind: "file", id: String(file.id) })) {
    fail(ctx, "validation.duplicate", "That name is already in this folder.");
  }
  const now = ctx.now();
  ctx.db.run(
    "UPDATE files_file SET deleted_at = ?, folder_id = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    null, folderId, now, ctx.principal.id, file.id,
  );
  ctx.db.run("DELETE FROM files_trash WHERE id = ?", file.id);
  noteOpen(ctx, String(file.id));
  ctx.emit("file.restored", `file/${String(file.id)}`, { fileId: String(file.id), folderId });
  return { file: fileOut(mustFile(ctx, String(file.id))) };
}

function purgeFile(ctx: Ctx, file: Row): void {
  const versions = many(ctx, "SELECT * FROM files_file_version WHERE file_id = ?", file.id);
  const blobs = versions.map((v) => String(v.blob));
  ctx.db.run("DELETE FROM files_file_version WHERE file_id = ?", file.id);
  for (const blobId of blobs) releaseRef(ctx, blobId);
  ctx.db.run("DELETE FROM files_file WHERE id = ?", file.id);
  ctx.db.run("DELETE FROM files_trash WHERE id = ?", file.id);
  dropRecent(ctx.db, String(file.id));
  ctx.emit("file.purged", `file/${String(file.id)}`, { fileId: String(file.id) });
}

async function filesPurge(ctx: Ctx, input: unknown): Promise<{ purged: boolean }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = mustFile(ctx, reqStr(ctx, o, "fileId"));
  if (isNull(file.deleted_at)) fail(ctx, "validation.precondition_failed", "Move the file to Trash before deleting it for good.");
  purgeFile(ctx, file);
  return { purged: true };
}

function purgeFolderRow(ctx: Ctx, folder: Row): void {
  const files = many(ctx, "SELECT * FROM files_file WHERE folder_id = ?", folder.id);
  for (const file of files) purgeFile(ctx, file);
  const children = many(ctx, "SELECT * FROM files_folder WHERE parent_id = ?", folder.id);
  for (const child of children) purgeFolderRow(ctx, child);
  ctx.db.run("DELETE FROM files_folder WHERE id = ?", folder.id);
  ctx.db.run("DELETE FROM files_trash WHERE id = ?", folder.id);
}

async function trashEmpty(ctx: Ctx, input: unknown): Promise<{ purged: number }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const older = optInt(ctx, o, "olderThanDays");
  if (older !== undefined && older < 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "olderThanDays" });
  const cutoff = older === undefined ? Number.POSITIVE_INFINITY : older * 24 * 60 * 60 * 1000;
  const rows = many(ctx, "SELECT * FROM files_trash").filter((row) => String(row.id) === String(row.root_id));
  let purged = 0;
  for (const row of rows) {
    const age = ctx.now() - num(row.deleted_at);
    if (age < cutoff && older !== undefined) continue;
    if (String(row.kind) === "file") {
      const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", row.id);
      if (!file) {
        ctx.db.run("DELETE FROM files_trash WHERE id = ?", row.id);
        continue;
      }
      purgeFile(ctx, file);
      purged += 1;
    } else {
      const folder = one(ctx, "SELECT * FROM files_folder WHERE id = ?", row.id);
      if (!folder) {
        ctx.db.run("DELETE FROM files_trash WHERE id = ?", row.id);
        continue;
      }
      const before = many(ctx, "SELECT * FROM files_file");
      purgeFolderRow(ctx, folder);
      const after = new Set(many(ctx, "SELECT * FROM files_file").map((f) => String(f.id)));
      purged += before.filter((f) => !after.has(String(f.id))).length;
    }
  }
  return { purged };
}

async function filesVersions(ctx: Ctx, input: unknown): Promise<{ versions: { versionId: string; n: number; by: string; at: number; reason?: string; name?: string }[] }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = mustFile(ctx, reqStr(ctx, o, "fileId"));
  return { versions: versionsOf(ctx, String(file.id)).map(versionOut) };
}

async function filesRestoreVersion(ctx: Ctx, input: unknown): Promise<{ file: FileOut; versionId: string }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = liveFile(ctx, reqStr(ctx, o, "fileId"));
  const versionId = reqStr(ctx, o, "versionId");
  const version = one(ctx, "SELECT * FROM files_file_version WHERE id = ?", versionId);
  if (!version || String(version.file_id) !== String(file.id)) fail(ctx, "validation.not_found", "That version is not on this file.", { versionId });
  const n = num(file.version) + 1;
  const blobId = String(version.blob);
  const now = ctx.now();
  const blob = one(ctx, "SELECT * FROM files_blob WHERE id = ?", blobId);
  const size = blob ? num(blob.size) : num(file.size);
  ctx.db.run(
    "UPDATE files_file SET blob = ?, size = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    blobId, size, n, now, ctx.principal.id, file.id,
  );
  const nextId = addVersion(ctx, String(file.id), n, blobId, "restore", undefined);
  noteOpen(ctx, String(file.id));
  ctx.emit("file.version_added", `file/${String(file.id)}`, { fileId: String(file.id), versionId: nextId, n, by: ctx.principal.id, reason: "restore" });
  return { file: fileOut(mustFile(ctx, String(file.id))), versionId: nextId };
}

async function filesNameVersion(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const file = mustFile(ctx, reqStr(ctx, o, "fileId"));
  const versionId = reqStr(ctx, o, "versionId");
  const version = one(ctx, "SELECT * FROM files_file_version WHERE id = ?", versionId);
  if (!version || String(version.file_id) !== String(file.id)) fail(ctx, "validation.not_found", "That version is not on this file.", { versionId });
  const name = optStr(ctx, o, "name");
  const reason = optStr(ctx, o, "reason");
  if (name === undefined && reason === undefined) fail(ctx, "validation.bad_input", "The input is not valid.");
  const nextName = name === undefined ? version.name : name;
  const nextReason = reason === undefined ? version.reason : reason;
  ctx.db.run("UPDATE files_file_version SET name = ?, reason = ?, updated_at = ? WHERE id = ?", nextName ?? null, nextReason ?? null, ctx.now(), version.id);
  return { ok: true };
}

function token(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadUrl(ctx: Ctx, input: unknown): Promise<{ blobId: string; url: string; expiresAt: number }> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const size = optInt(ctx, o, "size");
  if (size === undefined || size < 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "size" });
  if (size > MAX_UPLOAD) fail(ctx, "validation.too_large", "This file is over the size limit.");
  const mime = optStr(ctx, o, "mime") ?? null;
  const blobId = nid(ctx, "blb");
  const secret = token();
  const expiresAt = ctx.now() + UPLOAD_MS;
  ctx.db.run(
    "INSERT INTO files_upload (id, token, size, mime, expires_at, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    blobId, secret, size, mime, expiresAt, ctx.principal.id, ctx.now(),
  );
  return { blobId, url: `/spaces/${ctx.space}/blobs/${blobId}?token=${secret}`, expiresAt };
}

async function filesHealth(ctx: Ctx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const started = ctx.now();
  ensureReady(ctx);
  const blobs = many(ctx, "SELECT * FROM files_blob");
  const used = new Set(many(ctx, "SELECT * FROM files_file_version").map((row) => String(row.blob)));
  const orphans = blobs.filter((row) => !used.has(String(row.id))).length;
  const latencyMs = Math.max(0, ctx.now() - started);
  if (orphans > 0) return { state: "degraded", detail: `${orphans} blobs have no version`, latencyMs };
  return { state: "healthy", detail: "Blob store is ready.", latencyMs };
}

/** Host blob endpoint: the one-time token from files.upload_url, then the plaintext bytes. Seals them into files_blob. */
export async function putUploadedBytes(ctx: Ctx, blobId: string, uploadToken: string, plain: Uint8Array): Promise<{ hash: string; size: number }> {
  ensureReady(ctx);
  const up = one(ctx, "SELECT * FROM files_upload WHERE id = ?", blobId);
  if (!up || String(up.token) !== uploadToken) fail(ctx, "validation.not_found", "That upload is not in this Space.", { blobId });
  if (ctx.now() > num(up.expires_at)) fail(ctx, "validation.precondition_failed", "That upload has expired.");
  if (plain.byteLength !== num(up.size)) fail(ctx, "validation.bad_input", "The uploaded size does not match the reservation.");
  if (plain.byteLength > MAX_UPLOAD) fail(ctx, "validation.too_large", "This file is over the size limit.");
  const mime = isNull(up.mime) ? "application/octet-stream" : String(up.mime);
  const stored = await putBlob(ctx, plain, mime, blobId);
  ctx.db.run("DELETE FROM files_upload WHERE id = ?", blobId);
  return { hash: stored.hash, size: plain.byteLength };
}

export const treeHandlers = {
  "files.tree": (ctx: Ctx, _input: unknown) => filesTree(ctx),
  "files.list": (ctx: Ctx, input: unknown) => filesList(ctx, input),
  "files.recent": (ctx: Ctx, input: unknown) => filesRecent(ctx, input),
  "files.resolve": (ctx: Ctx, input: unknown) => filesResolve(ctx, input),
  "files.get": (ctx: Ctx, input: unknown) => filesGet(ctx, input),
  "files.read": (ctx: Ctx, input: unknown) => filesRead(ctx, input),
  "files.folder.get": (ctx: Ctx, input: unknown) => folderGet(ctx, input),
  "files.folder.search": (ctx: Ctx, input: unknown) => folderSearch(ctx, input),
  "files.trash.list": (ctx: Ctx, input: unknown) => trashList(ctx, input),
  "files.folder.create": (ctx: Ctx, input: unknown) => folderCreate(ctx, input),
  "files.folder.rename": (ctx: Ctx, input: unknown) => folderRename(ctx, input),
  "files.folder.move": (ctx: Ctx, input: unknown) => folderMove(ctx, input),
  "files.folder.delete": (ctx: Ctx, input: unknown) => folderDelete(ctx, input),
  "files.folder.restore": (ctx: Ctx, input: unknown) => folderRestore(ctx, input),
  "files.folder.settings": (ctx: Ctx, input: unknown) => folderSettings(ctx, input),
  "files.upload_url": (ctx: Ctx, input: unknown) => uploadUrl(ctx, input),
  "files.create": (ctx: Ctx, input: unknown) => filesCreate(ctx, input),
  "files.write": (ctx: Ctx, input: unknown) => filesWrite(ctx, input),
  "files.rename": (ctx: Ctx, input: unknown) => filesRename(ctx, input),
  "files.move": (ctx: Ctx, input: unknown) => filesMove(ctx, input),
  "files.copy": (ctx: Ctx, input: unknown) => filesCopy(ctx, input),
  "files.delete": (ctx: Ctx, input: unknown) => filesDelete(ctx, input),
  "files.restore": (ctx: Ctx, input: unknown) => filesRestore(ctx, input),
  "files.purge": (ctx: Ctx, input: unknown) => filesPurge(ctx, input),
  "files.trash.empty": (ctx: Ctx, input: unknown) => trashEmpty(ctx, input),
  "files.versions": (ctx: Ctx, input: unknown) => filesVersions(ctx, input),
  "files.restore_version": (ctx: Ctx, input: unknown) => filesRestoreVersion(ctx, input),
  "files.name_version": (ctx: Ctx, input: unknown) => filesNameVersion(ctx, input),
  "files.health": (ctx: Ctx, _input: unknown) => filesHealth(ctx),
};

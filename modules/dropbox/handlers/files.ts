// dropbox.files.*: the folder and file calls behind a Dropbox mount (spec 2.16 Mounts; live folders L3). Every call names a connection and acts as the Dropbox account behind it, so Dropbox's own
// permissions decide what is seen and changed; Vyre narrows nothing here (the Gate and the mount do).
//   list_folder       one page of a folder (recursive for a mount's first pass); with `cursor` it continues that listing, and a cursor kept from before reads only what changed since
//   get_metadata      one file or folder, by path or by id ("id:...")
//   download          the bytes of a file into a blob, optionally of one revision
//   upload            a Space file into Dropbox. `rev` makes the write conditional: it only lands on that revision, and a file that moved on answers validation.version_conflict, never an overwrite
//   create_folder, delete, list_revisions, restore    the rest of the file API
//   latest_cursor, longpoll    the change feed's start point, and the wait for the next change
// Dropbox names a deleted item by path only. The module keeps an id-to-path index of what it has listed (dropbox_node), so a deleted path is answered with the id the mount knows it by, and a deleted
// folder with every item that was inside it.
import { fail } from "../../../host/src/routes/errors.ts";
import { accountOf, api, bad, codeOf, intOrUndef, list, needHost, obj, refusal, rowsOf, str, strOrUndef, text, tokenFor } from "../projections.ts";
import type { Account, DropboxCtx, Json } from "../projections.ts";

// ---- entries

export interface Entry {
  id: string;
  name: string;
  /** the path as Dropbox shows it (case kept) */
  path: string;
  pathLower: string;
  isFolder: boolean;
  deleted?: true;
  size?: number;
  rev?: string;
  /** the time Dropbox last saved the content, ISO 8601 */
  modified?: string;
  contentHash?: string;
  /** opens this item in the Dropbox website, signed in as its owner */
  webUrl: string;
}

/** The address that opens an item in Dropbox's own web app: a folder's view, or the folder holding a file with its preview open over it. */
export function webUrlOf(pathDisplay: string, isFolder: boolean): string {
  const parts = pathDisplay.replace(/^\/+/, "").split("/").filter((p) => p !== "").map((p) => encodeURIComponent(p));
  if (isFolder || parts.length === 0) return `https://www.dropbox.com/home${parts.length ? `/${parts.join("/")}` : ""}`;
  const name = parts.pop() as string;
  return `https://www.dropbox.com/home${parts.length ? `/${parts.join("/")}` : ""}?preview=${name}`;
}

export function entryOf(raw: unknown): Entry | undefined {
  const e = obj(raw);
  const tag = text(e[".tag"]);
  const pathLower = text(e["path_lower"]);
  const pathDisplay = text(e["path_display"]) || pathLower;
  const name = text(e["name"]);
  if (tag !== "file" && tag !== "folder" && tag !== "deleted") return undefined;
  if (pathLower === "" && tag !== "folder") return undefined;
  const isFolder = tag === "folder";
  const size = intOrUndef(e["size"]);
  const out: Entry = {
    id: text(e["id"]), name: name || pathDisplay.slice(pathDisplay.lastIndexOf("/") + 1), path: pathDisplay, pathLower, isFolder,
    ...(tag === "deleted" ? { deleted: true as const } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(strOrUndef(e["rev"]) !== undefined ? { rev: text(e["rev"]) } : {}),
    ...(strOrUndef(e["server_modified"]) !== undefined ? { modified: text(e["server_modified"]) } : {}),
    ...(strOrUndef(e["content_hash"]) !== undefined ? { contentHash: text(e["content_hash"]) } : {}),
    webUrl: webUrlOf(pathDisplay, isFolder),
  };
  return out;
}

// ---- the id-to-path index

function indexEntry(ctx: DropboxCtx, a: Account, e: Entry): void {
  if (e.id === "") return;
  ctx.db.run(`DELETE FROM dropbox_node WHERE "connectionId" = ? AND "nodeId" = ?`, a.connectionId, e.id);
  ctx.db.run(`INSERT OR IGNORE INTO dropbox_node ("connectionId", "nodeId", "pathLower", "isFolder") VALUES (?, ?, ?, ?)`, a.connectionId, e.id, e.pathLower, e.isFolder ? 1 : 0);
}

/** What the index knows to have been at or below a path: the item itself and, for a folder, everything listed inside it. */
function knownAt(ctx: DropboxCtx, a: Account, pathLower: string): { nodeId: string; pathLower: string; isFolder: boolean }[] {
  const rows = rowsOf(ctx.db.all(`SELECT * FROM dropbox_node WHERE "connectionId" = ?`, a.connectionId));
  return rows
    .filter((r) => str(r, "pathLower") === pathLower || str(r, "pathLower").startsWith(`${pathLower}/`))
    .map((r) => ({ nodeId: str(r, "nodeId"), pathLower: str(r, "pathLower"), isFolder: r["isFolder"] === 1 }));
}

/** The id the mount knows a path by, when the index has seen it. */
export function idAt(ctx: DropboxCtx, a: Account, pathLower: string): string | undefined {
  const row = rowsOf(ctx.db.all(`SELECT * FROM dropbox_node WHERE "connectionId" = ? AND "pathLower" = ?`, a.connectionId, pathLower))[0];
  return row ? str(row, "nodeId") : undefined;
}

/** Fold a page of entries into answers: moves and renames refresh the index, a deleted path becomes the ids it held. */
function settle(ctx: DropboxCtx, a: Account, raw: unknown[]): Entry[] {
  const out: Entry[] = [];
  for (const r of raw) {
    const e = entryOf(r);
    if (!e) continue;
    if (e.deleted) {
      const gone = knownAt(ctx, a, e.pathLower);
      if (gone.length === 0) { out.push(e); continue; }
      for (const g of gone) {
        ctx.db.run(`DELETE FROM dropbox_node WHERE "connectionId" = ? AND "nodeId" = ?`, a.connectionId, g.nodeId);
        const name = g.pathLower.slice(g.pathLower.lastIndexOf("/") + 1);
        out.push({ id: g.nodeId, name, path: g.pathLower, pathLower: g.pathLower, isFolder: g.isFolder, deleted: true, webUrl: webUrlOf(g.pathLower, g.isFolder) });
      }
      continue;
    }
    indexEntry(ctx, a, e);
    out.push(e);
  }
  return out;
}

const PATH_OK = /^(\/.*|id:.+|rev:.+|ns:\d+(\/.*)?)?$/;

/** A path Dropbox takes: "" for the root, "/Folder/file", or an id such as "id:abc". */
function pathOf(ctx: DropboxCtx, v: unknown, what = "path", allowRoot = true): string {
  const p = typeof v === "string" ? v : "";
  if (!PATH_OK.test(p) || (p === "" && !allowRoot) || p === "/" || p.endsWith("/") || p.includes("\u0000")) bad(ctx, `${what} must be a Dropbox path such as /Sales/Report.docx, or an id such as id:abc.`);
  return p;
}

// ---- calls

export async function listFolder(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const cursor = strOrUndef(i["cursor"]);
  const body = cursor !== undefined
    ? { cursor }
    : { path: pathOf(ctx, i["path"] ?? ""), recursive: i["recursive"] === true, include_deleted: false, include_non_downloadable_files: true, limit: Math.min(Math.max(intOrUndef(i["limit"]) ?? 500, 1), 2000) };
  const res = await api(ctx, a, { path: cursor !== undefined ? "/files/list_folder/continue" : "/files/list_folder", body });
  const entries = settle(ctx, a, list(res["entries"]));
  return { entries, cursor: text(res["cursor"]), hasMore: res["has_more"] === true };
}

export async function getMetadata(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const res = await api(ctx, a, { path: "/files/get_metadata", body: { path: pathOf(ctx, i["path"], "path", false), include_deleted: false } });
  const entry = settle(ctx, a, [res])[0];
  if (!entry) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Dropbox answered something unexpected." });
  return { entry };
}

const MIME: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", html: "text/html", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const mimeOf = (name: string): string | undefined => MIME[name.slice(name.lastIndexOf(".") + 1).toLowerCase()];

export async function download(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const path = pathOf(ctx, i["path"], "path", false);
  const rev = strOrUndef(i["rev"]);
  const arg: Json = { path: rev !== undefined ? `rev:${rev}` : path };
  const host = needHost(ctx);
  for (let attempt = 0; ; attempt++) {
    const r = await host.download(ctx, { token: await tokenFor(ctx, a, attempt > 0), arg, ...(mimeOf(path) ? { mime: mimeOf(path) as string } : {}) });
    if (r.status === 401 && attempt === 0) continue;
    if (r.status >= 300 || !r.blob) throw refused(ctx, r.status, r.json);
    return { blobId: r.blob.blobId, size: r.blob.size, mime: r.blob.mime };
  }
}

const refused = (ctx: DropboxCtx, status: number, json: Json) => refusal(ctx, status, JSON.stringify(json));

export async function upload(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const path = pathOf(ctx, i["path"], "path", false);
  if (path.startsWith("id:") || path.startsWith("rev:")) bad(ctx, "An upload names where the file goes, such as /Sales/Report.docx.");
  const fileId = text(i["fileId"]);
  if (fileId === "") bad(ctx, "fileId is needed.");
  const rev = strOrUndef(i["rev"]);
  // With a revision the write only lands on it; without one the file is added, and a name that is taken is kept apart ("Report (1).docx") rather than overwritten.
  const arg: Json = { path, mode: rev !== undefined ? { ".tag": "update", update: rev } : "add", autorename: rev === undefined, mute: true, strict_conflict: rev !== undefined };
  const host = needHost(ctx);
  for (let attempt = 0; ; attempt++) {
    const r = await host.upload(ctx, { token: await tokenFor(ctx, a, attempt > 0), arg, fileId });
    if (r.status === 401 && attempt === 0) continue;
    if (r.status >= 300) throw refused(ctx, r.status, r.json);
    const entry = settle(ctx, a, [{ ".tag": "file", ...r.json }])[0];
    if (!entry) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Dropbox answered something unexpected." });
    return { entry };
  }
}

export async function createFolder(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const res = await api(ctx, a, { path: "/files/create_folder_v2", body: { path: pathOf(ctx, i["path"], "path", false), autorename: false } });
  const entry = settle(ctx, a, [{ ".tag": "folder", ...obj(res["metadata"]) }])[0];
  if (!entry) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Dropbox answered something unexpected." });
  return { entry };
}

export async function deleteItem(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const path = pathOf(ctx, i["path"], "path", false);
  const rev = strOrUndef(i["rev"]);
  const res = await api(ctx, a, { path: "/files/delete_v2", body: { path, ...(rev !== undefined ? { parent_rev: rev } : {}) } });
  const meta = obj(res["metadata"]);
  const pathLower = text(meta["path_lower"]);
  if (pathLower !== "") settle(ctx, a, [{ ".tag": "deleted", path_lower: pathLower, name: text(meta["name"]) }]);
  return { deleted: true };
}

export async function listRevisions(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const res = await api(ctx, a, { path: "/files/list_revisions", body: { path: pathOf(ctx, i["path"], "path", false), mode: "path", limit: Math.min(Math.max(intOrUndef(i["limit"]) ?? 10, 1), 100) } });
  const revisions = list(res["entries"]).map((r) => entryOf({ ".tag": "file", ...obj(r) })).filter((e): e is Entry => e !== undefined);
  return { revisions, deleted: res["is_deleted"] === true };
}

export async function restore(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const rev = text(i["rev"]);
  if (rev === "") bad(ctx, "rev is needed.");
  const res = await api(ctx, a, { path: "/files/restore", body: { path: pathOf(ctx, i["path"], "path", false), rev } });
  const entry = settle(ctx, a, [{ ".tag": "file", ...res }])[0];
  if (!entry) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Dropbox answered something unexpected." });
  return { entry };
}

export async function latestCursor(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const res = await api(ctx, a, { path: "/files/list_folder/get_latest_cursor", body: { path: pathOf(ctx, i["path"] ?? ""), recursive: i["recursive"] !== false, include_deleted: false } });
  return { cursor: text(res["cursor"]) };
}

/** Wait (up to the timeout) for a change after the cursor. The call needs no token, but the connection is still checked: a cursor is only meaningful to the account it came from. */
export async function longpoll(ctx: DropboxCtx, input: unknown) {
  const i = obj(input);
  const a = accountOf(ctx, text(i["connectionId"]));
  const cursor = text(i["cursor"]);
  if (cursor === "") bad(ctx, "cursor is needed.");
  const timeout = Math.min(Math.max(intOrUndef(i["timeoutSeconds"]) ?? 30, 30), 480);
  const res = await api(ctx, a, { host: "notify", path: "/files/list_folder/longpoll", body: { cursor, timeout } });
  const backoff = intOrUndef(res["backoff"]);
  return { changes: res["changes"] === true, ...(backoff !== undefined ? { backoffSeconds: backoff } : {}) };
}

/** Whether a refusal means the saved place in the change feed is gone, so the caller reads the folder from the start. */
export const isCursorReset = (e: unknown): boolean => codeOf(e) === "validation.precondition_failed" && (e as { error?: { details?: { reason?: string } } }).error?.details?.reason === "cursor_reset";

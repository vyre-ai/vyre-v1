// files lists (P-L4_10; spec 2.4, 2.16, 3.5; ARCH 7.5): the Shared with me and Knowledge sections of the file tree. Recent and Trash are listed by tree.ts (files.recent, files.trash.list).
// Both lists are views over the same file and folder rows; nothing is stored twice (ruling 24).
//
//   files.shared_with_me   what access lists for the caller in the `shared` section (a grant or a shared folder, never what the caller owns or the whole Space holds), newest share first. Items inside a
//                          folder that is itself shared with the caller are not repeated: the folder opens to them. Trashed rows and rows the files module does not hold are left out.
//   files.knowledge        the shared knowledge folder's folders and files the caller may read, plus the Memory and Graph entries with their counts (memory.notes.list and memory.graph at the Space layer).
// Who may see what is access's answer (access.lists, the same rules as authorize and scopeFor); this module never decides it. The time of a share is the newest grant on the item or on a folder above it (access.shares_of).
// @reads ../migrations/0001_files_tree.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { KINDS, ensureReady, fail, fileOut, folderOut, isNull, many, num, one, optStr, pageArgs, rec, slicePage } from "./tree.ts";
import type { FileOut, FolderOut } from "./tree.ts";

type Row = Record<string, unknown>;

interface ListRow { type: string; id: string; title: string; via: string; level: string }
interface ListPage { rows: ListRow[]; total?: number; next?: string }
interface ShareList { shares: { grant: { createdAt?: number }; through: string }[] }

interface ListOut { files: FileOut[]; folders: FolderOut[]; total: number; next?: string }
interface KnowledgeOut extends ListOut { views: { key: "memory" | "graph"; title: string; count: number }[] }

/** Everything access lists for the caller for one resource type, in one section or in all of them. */
async function accessRows(ctx: Ctx, type: "file" | "folder", section?: "shared"): Promise<ListRow[]> {
  const out: ListRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = (await ctx.call("access.lists", { type, ...(section ? { section } : {}), limit: 500, ...(cursor ? { cursor } : {}) })) as ListPage;
    out.push(...page.rows);
    if (!page.next) return out;
    cursor = page.next;
  }
}

function liveFile(ctx: Ctx, id: string): Row | undefined {
  const row = one(ctx, "SELECT * FROM files_file WHERE id = ?", id);
  return row && isNull(row.deleted_at) ? row : undefined;
}

function liveFolder(ctx: Ctx, id: string): Row | undefined {
  const row = one(ctx, "SELECT * FROM files_folder WHERE id = ?", id);
  return row && isNull(row.deleted_at) ? row : undefined;
}

/** True when a folder above `parentId` (or that folder itself) is in `ids`. */
function under(ctx: Ctx, parentId: unknown, ids: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  let at: unknown = parentId;
  while (typeof at === "string" && at !== "" && !seen.has(at)) {
    if (ids.has(at)) return true;
    seen.add(at);
    const row = one(ctx, "SELECT * FROM files_folder WHERE id = ?", at);
    at = row ? row.parent_id : undefined;
  }
  return false;
}

/** The newest grant on the item or above it; 0 when access reports none (then name decides). */
async function sharedAt(ctx: Ctx, type: "file" | "folder", id: string): Promise<number> {
  const res = (await ctx.call("access.shares_of", { resource: { type, id } })) as ShareList;
  let at = 0;
  for (const s of res.shares) if (s.through !== "owner") at = Math.max(at, num(s.grant.createdAt));
  return at;
}

function kindOf(ctx: Ctx, o: Record<string, unknown>): string | undefined {
  const kind = optStr(ctx, o, "kind");
  if (kind !== undefined && !KINDS.has(kind)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "kind" });
  return kind;
}

/** How many items Shared with me holds for the caller: the count on the files.tree root. */
export async function sharedCount(ctx: Ctx): Promise<number> {
  return (await sharedWithMe(ctx, { limit: 1 })).total;
}

async function sharedWithMe(ctx: Ctx, input: unknown): Promise<ListOut> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const kind = kindOf(ctx, o);
  const { offset, limit } = pageArgs(ctx, o, 100);

  const sharedFolders = new Map<string, Row>();
  for (const r of await accessRows(ctx, "folder", "shared")) {
    const row = liveFolder(ctx, r.id);
    if (row) sharedFolders.set(r.id, row);
  }
  const folderIds = new Set(sharedFolders.keys());

  type Item = { kind: "file" | "folder"; id: string; name: string; at: number; row: Row };
  const items: Item[] = [];
  for (const r of await accessRows(ctx, "file", "shared")) {
    const row = liveFile(ctx, r.id);
    if (!row || under(ctx, row.folder_id, folderIds)) continue;
    if (kind !== undefined && String(row.kind) !== kind) continue;
    items.push({ kind: "file", id: r.id, name: String(row.name), at: 0, row });
  }
  if (kind === undefined) {
    for (const [id, row] of sharedFolders) {
      if (under(ctx, row.parent_id, folderIds)) continue;
      items.push({ kind: "folder", id, name: String(row.name), at: 0, row });
    }
  }
  for (const item of items) item.at = await sharedAt(ctx, item.kind, item.id);
  items.sort((a, b) => b.at - a.at || a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en") || a.id.localeCompare(b.id));

  const paged = slicePage(items, offset, limit);
  const out: ListOut = {
    files: paged.rows.filter((i) => i.kind === "file").map((i) => fileOut(i.row)),
    folders: paged.rows.filter((i) => i.kind === "folder").map((i) => folderOut(ctx, i.row)),
    total: paged.total,
  };
  if (paged.next !== undefined) out.next = paged.next;
  return out;
}

async function knowledge(ctx: Ctx, input: unknown): Promise<KnowledgeOut> {
  ensureReady(ctx);
  const o = rec(ctx, input);
  const { offset, limit } = pageArgs(ctx, o, 100);

  const root = one(ctx, "SELECT * FROM files_folder WHERE root_key = ?", "shared_knowledge");
  const readableFiles = new Set((await accessRows(ctx, "file")).map((r) => r.id));
  const readableFolders = new Set((await accessRows(ctx, "folder")).map((r) => r.id));

  type Item = { kind: "file" | "folder"; id: string; name: string; row: Row };
  const items: Item[] = [];
  if (root && isNull(root.deleted_at)) {
    for (const row of many(ctx, "SELECT * FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", root.id)) {
      if (readableFolders.has(String(row.id))) items.push({ kind: "folder", id: String(row.id), name: String(row.name), row });
    }
    for (const row of many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", root.id)) {
      if (readableFiles.has(String(row.id))) items.push({ kind: "file", id: String(row.id), name: String(row.name), row });
    }
  }
  items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1) || a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en") || a.id.localeCompare(b.id));
  const paged = slicePage(items, offset, limit);

  const notes = (await ctx.call("memory.notes.list", { layer: "space", limit: 1 })) as { total?: number; notes?: unknown[] };
  const graph = (await ctx.call("memory.graph", { scope: "space" })) as { nodes?: unknown[] };
  const out: KnowledgeOut = {
    files: paged.rows.filter((i) => i.kind === "file").map((i) => fileOut(i.row)),
    folders: paged.rows.filter((i) => i.kind === "folder").map((i) => folderOut(ctx, i.row)),
    views: [
      { key: "memory", title: "Memory", count: notes.total ?? notes.notes?.length ?? 0 },
      { key: "graph", title: "Graph", count: graph.nodes?.length ?? 0 },
    ],
    total: paged.total,
  };
  if (paged.next !== undefined) out.next = paged.next;
  return out;
}

export const listHandlers = {
  "files.shared_with_me": (ctx: Ctx, input: unknown) => sharedWithMe(ctx, input),
  "files.knowledge": (ctx: Ctx, input: unknown) => knowledge(ctx, input),
};

// files agent-stage: an agent never changes a file in a Review changes folder directly (spec 2.16; P-L4_04b).
// changesets.ts stages files.write and files.create. This file closes the other ways an agent or an outside actor can change a file: files.save, files.delete, files.rename and
// files.move. In a folder with Review changes on (or under one) the change is staged in the writer's open changeset for that folder, the file tree does not move, and Approve applies it
// (changesets.approve already understands deleted and renamed rows; a move is a renamed row whose new_name is "<folderId>/<name>", since a file name has no slash). A person's own
// writes, a service, and any folder without Review changes keep the plain handlers, so they behave exactly as before.
//
// Events: files.delete, files.rename, files.move and files.save declare no changeset.updated (and the first three no changeset.opened) in their manifest emits, and the host refuses an
// undeclared event. The changeset is announced when the manifest allows it and stays quiet when it does not (CONTRACT-CHANGE request to the lead: add changeset.opened and
// changeset.updated to the emits of those four capabilities, and changesetId to their outputs). The reviewer still finds the changeset in changesets.list either way.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { MAX_INLINE, treeHandlers } from "./tree.ts";
import { changesetFor, currentBytes, fail, filesOf, flag, isNull, isOpen, lineCounts, live, many, num, one, optStr, record, relPath, reopen, reqStr, reviewRoot, seal, stages, stagedByProvisional, touch, virtualFile } from "./changesets.ts";

type Row = Record<string, unknown>;
export type StageHandler = (ctx: Ctx, input: unknown) => Promise<unknown>;

const enc = new TextEncoder();
const UNDECLARED = "event not declared in emits";

/** True when the host refused an event because the capability's manifest does not list it. */
function undeclared(e: unknown): boolean {
  const why = (e as { error?: { details?: { why?: unknown } } }).error?.details?.why;
  return why === UNDECLARED;
}

function tell(ctx: Ctx, cs: Row, kind: "opened" | "updated" | "discarded"): void {
  const id = String(cs.id);
  const folderId = String(cs.folder_id);
  const subject = `folder/${folderId}`;
  try {
    if (kind === "opened") {
      const payload: { changesetId: string; folderId: string; by: string; fileCount: number; threadId?: string } = { changesetId: id, folderId, by: String(cs.author), fileCount: filesOf(ctx, id).length };
      if (!isNull(cs.thread_id)) payload.threadId = String(cs.thread_id);
      ctx.emit("changeset.opened", subject, payload);
    } else if (kind === "updated") {
      ctx.emit("changeset.updated", subject, { changesetId: id, folderId, fileCount: filesOf(ctx, id).length });
    } else {
      ctx.emit("changeset.discarded", subject, { changesetId: id, folderId, by: String(cs.author) });
    }
  } catch (e) {
    if (!undeclared(e)) throw e;
    ctx.log.warn("changesets.event_undeclared", { changesetId: id, event: `changeset.${kind}` });
  }
}

function cleanName(ctx: Ctx, name: string): string {
  const n = name.trim();
  if (!n || n.length > 255 || n === "." || n === ".." || n.includes("/") || n.includes("\\") || /[\u0000-\u001f]/.test(n)) {
    fail(ctx, "validation.bad_input", "That name cannot be used for a file or folder.");
  }
  return n;
}

/** A live file or folder already has this name in the folder (not counting the file being renamed). */
function nameClash(ctx: Ctx, folderId: string, name: string, selfFileId: string): boolean {
  if (many(ctx, "SELECT * FROM files_file WHERE folder_id = ? AND name = ?", folderId, name).some((r) => live(r) && String(r.id) !== selfFileId)) return true;
  return many(ctx, "SELECT * FROM files_folder WHERE parent_id = ? AND name = ?", folderId, name).some(live);
}

interface Placed { file: Row; folder: Row; root: Row }
/** The live file with the folder it sits in and the Review changes root above it; undefined when the plain handler should run (no such file, or no Review changes). */
function placed(ctx: Ctx, fileId: string): Placed | undefined {
  const file = one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId);
  if (!live(file)) return undefined;
  const folder = one(ctx, "SELECT * FROM files_folder WHERE id = ?", String(file.folder_id));
  if (!folder) return undefined;
  const root = reviewRoot(ctx, String(folder.id));
  return root ? { file, folder, root } : undefined;
}

const entryAt = (ctx: Ctx, csId: string, path: string): Row | undefined => one(ctx, "SELECT * FROM files_changeset_file WHERE changeset_id = ? AND path = ?", csId, path);

/** An agent that stages something starts from the version it can see now, unless the entry is mid-conflict (then it starts again from what is there). */
const baseOf = (entry: Row | undefined, file: Row): number => (entry && !flag(entry.conflict) && !isNull(entry.base_version) ? num(entry.base_version) : num(file.version));

function insertEntry(ctx: Ctx, csId: string, path: string, e: { status: string; file: Row; newName: string | null; content: string | null; size: number; added: number; removed: number; base: number }): void {
  ctx.db.run(
    "INSERT INTO files_changeset_file (changeset_id, path, status, file_id, folder_id, name, new_name, mime, base_version, content, size, added_lines, removed_lines, conflict, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    csId, path, e.status, String(e.file.id), String(e.file.folder_id), String(e.file.name), e.newName, String(e.file.mime), e.base, e.content, e.size, e.added, e.removed, 0, ctx.now(),
  );
}

function after(ctx: Ctx, cs: Row, fresh: boolean, path: string, status: string): void {
  if (!fresh) reopen(ctx, cs);
  tell(ctx, cs, fresh ? "opened" : "updated");
  ctx.log.info("changesets.stage", { changesetId: String(cs.id), path, status });
}

/** A changeset left with no files has nothing for the reviewer: close it the way Discard does. */
function closeIfEmpty(ctx: Ctx, cs: Row): void {
  if (filesOf(ctx, String(cs.id)).length > 0) {
    touch(ctx, cs);
    tell(ctx, cs, "updated");
    return;
  }
  const now = ctx.now();
  ctx.db.run("UPDATE files_changeset SET state = ?, updated_at = ?, closed_at = ? WHERE id = ?", "discarded", now, now, String(cs.id));
  tell(ctx, cs, "discarded");
}

async function currentFile(ctx: Ctx, fileId: string): Promise<unknown> {
  return ((await treeHandlers["files.get"](ctx, { fileId })) as { file?: unknown }).file;
}

/** The changeset this writer already has open in this Review changes root, if any (changesetFor would open one). */
function findOpen(ctx: Ctx, root: Row): Row | undefined {
  const behalf = ctx.actingFor ?? "";
  return many(ctx, "SELECT * FROM files_changeset WHERE folder_id = ? AND author = ?", String(root.id), ctx.principal.id)
    .filter((r) => isOpen(r) && String(r.on_behalf_of ?? "") === behalf)
    .sort((a, b) => num(b.opened_at) - num(a.opened_at))[0];
}

// ---- delete ----

async function stageDelete(ctx: Ctx, input: unknown, direct: StageHandler): Promise<unknown> {
  if (!stages(ctx)) return direct(ctx, input);
  const fileId = reqStr(ctx, record(ctx, input), "fileId");
  if (!one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId)) {
    const prov = stagedByProvisional(ctx, fileId);
    if (!prov) return direct(ctx, input);
    // a file the agent added in this changeset: dropping it leaves nothing behind
    ctx.db.run("DELETE FROM files_changeset_file WHERE changeset_id = ? AND path = ?", String(prov.entry.changeset_id), String(prov.entry.path));
    closeIfEmpty(ctx, prov.cs);
    return { deleted: true, changesetId: String(prov.cs.id) };
  }
  const at = placed(ctx, fileId);
  if (!at) return direct(ctx, input);
  const path = relPath(at.root, at.folder, String(at.file.name));
  const { cs, fresh } = changesetFor(ctx, at.root);
  const entry = entryAt(ctx, String(cs.id), path);
  const base = baseOf(entry, at.file);
  const removed = lineCounts(await currentBytes(ctx, fileId, base), undefined).removed;
  if (entry) {
    ctx.db.run(
      "UPDATE files_changeset_file SET status = ?, new_name = ?, base_version = ?, content = ?, size = ?, added_lines = ?, removed_lines = ?, conflict = ?, updated_at = ? WHERE changeset_id = ? AND path = ?",
      "deleted", null, base, null, 0, 0, removed, 0, ctx.now(), String(cs.id), path,
    );
  } else {
    insertEntry(ctx, String(cs.id), path, { status: "deleted", file: at.file, newName: null, content: null, size: 0, added: 0, removed, base });
  }
  after(ctx, cs, fresh, path, "deleted");
  return { deleted: false, changesetId: String(cs.id) };
}

// ---- rename and move ----

/** The folder and name the entry already moves to ("<folderId>/<name>" is a move), or the file's own. */
function targetOf(entry: Row | undefined, file: Row): { folderId: string; name: string } {
  const raw = entry && entry.status === "renamed" && !isNull(entry.new_name) ? String(entry.new_name) : "";
  const slash = raw.indexOf("/");
  if (slash > 0) return { folderId: raw.slice(0, slash), name: raw.slice(slash + 1) };
  return { folderId: String(file.folder_id), name: raw !== "" ? raw : String(file.name) };
}

async function relocate(ctx: Ctx, at: Placed, want: { toFolderId?: string; name?: string }): Promise<unknown> {
  const path = relPath(at.root, at.folder, String(at.file.name));
  const open = findOpen(ctx, at.root);
  const entry = open ? entryAt(ctx, String(open.id), path) : undefined;
  if (entry && entry.status === "deleted") fail(ctx, "validation.precondition_failed", "This file is deleted in the changeset: discard that change first.");
  const now = targetOf(entry, at.file);
  const folderId = want.toFolderId ?? now.folderId;
  const name = want.name ?? now.name;
  const here = String(at.file.folder_id) === folderId && String(at.file.name) === name;
  if (!here && nameClash(ctx, folderId, name, String(at.file.id))) fail(ctx, "validation.duplicate", "That name is already in this folder.");
  if (here && !entry) return { file: await currentFile(ctx, String(at.file.id)) }; // already there: nothing to stage, no changeset to open
  const newName = here ? null : String(at.file.folder_id) === folderId ? name : `${folderId}/${name}`;
  const { cs, fresh } = changesetFor(ctx, at.root);
  if (entry) {
    if (here && isNull(entry.content)) {
      // moved back to where it was, with nothing else staged for it: the row has no reason to exist
      ctx.db.run("DELETE FROM files_changeset_file WHERE changeset_id = ? AND path = ?", String(cs.id), path);
      closeIfEmpty(ctx, cs);
      return { file: await currentFile(ctx, String(at.file.id)), changesetId: String(cs.id) };
    }
    ctx.db.run("UPDATE files_changeset_file SET status = ?, new_name = ?, updated_at = ? WHERE changeset_id = ? AND path = ?", here ? "modified" : "renamed", newName, ctx.now(), String(cs.id), path);
  } else {
    insertEntry(ctx, String(cs.id), path, { status: "renamed", file: at.file, newName, content: null, size: 0, added: 0, removed: 0, base: num(at.file.version) });
  }
  after(ctx, cs, fresh, path, "renamed");
  return { file: await currentFile(ctx, String(at.file.id)), changesetId: String(cs.id) };
}

/** A file the agent added in this changeset has a provisional id; renaming or moving it only edits the staged row. */
async function relocateProvisional(ctx: Ctx, prov: { cs: Row; entry: Row }, want: { toFolderId?: string; name?: string }): Promise<unknown> {
  const root = one(ctx, "SELECT * FROM files_folder WHERE id = ?", String(prov.cs.folder_id));
  const entryFolderId = want.toFolderId ?? String(prov.entry.folder_id);
  const folder = one(ctx, "SELECT * FROM files_folder WHERE id = ?", entryFolderId);
  if (!root || !live(folder)) return fail(ctx, "validation.not_found", "That folder does not exist.", { folderId: entryFolderId });
  if (want.toFolderId !== undefined && reviewRoot(ctx, want.toFolderId)?.id !== root.id) {
    return fail(ctx, "validation.precondition_failed", "A file added in a changeset can only move within the folders that changeset covers; approve it first.");
  }
  const name = want.name ?? String(prov.entry.name);
  const path = relPath(root, folder, name);
  const taken = entryAt(ctx, String(prov.cs.id), path);
  if ((taken && taken.path !== prov.entry.path) || nameClash(ctx, entryFolderId, name, String(prov.entry.file_id))) fail(ctx, "validation.duplicate", "That name is already in this folder.");
  ctx.db.run("UPDATE files_changeset_file SET name = ?, folder_id = ?, path = ?, updated_at = ? WHERE changeset_id = ? AND path = ?", name, entryFolderId, path, ctx.now(), String(prov.cs.id), String(prov.entry.path));
  reopen(ctx, prov.cs);
  tell(ctx, prov.cs, "updated");
  const moved = one(ctx, "SELECT * FROM files_changeset_file WHERE changeset_id = ? AND path = ?", String(prov.cs.id), path) ?? {};
  return { file: virtualFile(ctx, moved), changesetId: String(prov.cs.id) };
}

async function stageRename(ctx: Ctx, input: unknown, direct: StageHandler): Promise<unknown> {
  if (!stages(ctx)) return direct(ctx, input);
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  if (!one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId)) {
    const prov = stagedByProvisional(ctx, fileId);
    return prov ? relocateProvisional(ctx, prov, { name }) : direct(ctx, input);
  }
  const at = placed(ctx, fileId);
  return at ? relocate(ctx, at, { name }) : direct(ctx, input);
}

async function stageMove(ctx: Ctx, input: unknown, direct: StageHandler): Promise<unknown> {
  if (!stages(ctx)) return direct(ctx, input);
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const toFolderId = reqStr(ctx, o, "toFolderId");
  const given = optStr(ctx, o, "name");
  const name = given === undefined ? undefined : cleanName(ctx, given);
  const dest = one(ctx, "SELECT * FROM files_folder WHERE id = ?", toFolderId);
  if (!live(dest)) return direct(ctx, input); // the plain handler reports the missing folder
  const want = { toFolderId, ...(name !== undefined ? { name } : {}) };
  if (!one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId)) {
    const prov = stagedByProvisional(ctx, fileId);
    return prov ? relocateProvisional(ctx, prov, want) : direct(ctx, input);
  }
  const at = placed(ctx, fileId);
  return at ? relocate(ctx, at, want) : direct(ctx, input);
}

// ---- save ----

interface LintLike { file?: unknown; problems?: { severity?: unknown; message?: unknown }[] }

async function stageSave(ctx: Ctx, input: unknown, direct: StageHandler): Promise<unknown> {
  if (!stages(ctx)) return direct(ctx, input);
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const text = o["text"];
  const at = placed(ctx, fileId);
  if (!at || typeof text !== "string") return direct(ctx, input); // the plain handler reports a bad input or a missing file; an unreviewed folder saves as before
  const baseIn = o["baseVersion"];
  if (baseIn !== undefined && baseIn !== null && (typeof baseIn !== "number" || !Number.isInteger(baseIn) || baseIn < 1)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "baseVersion" });
  const lint = (await ctx.call("files.lint", { fileId, text })) as LintLike;
  if (lint.file === "other") fail(ctx, "validation.precondition_failed", "files.save is for VYRE.md, AGENT.md, agent.toml and routine prompts; use files.write for other files.", { name: String(at.file.name) });
  const bytes = enc.encode(text);
  if (bytes.byteLength > MAX_INLINE) fail(ctx, "validation.too_large", "This file is over the size limit for a direct write.");
  const path = relPath(at.root, at.folder, String(at.file.name));
  const problems = lint.problems ?? [];
  const first = (sev: string): string | undefined => { const p = problems.find((x) => x.severity === sev); return p === undefined ? undefined : String(p.message ?? ""); };
  const error = first("error");
  const warning = first("warn");
  if (error !== undefined) fail(ctx, "validation.precondition_failed", `Not saved: ${error || "the lint found an error."}`, { lint });
  if (warning !== undefined && o["acceptWarnings"] !== true) fail(ctx, "validation.precondition_failed", `Not saved: ${warning || "the lint found a warning."} Save again with the warnings accepted.`, { lint });

  const open = findOpen(ctx, at.root);
  const entry = open ? entryAt(ctx, String(open.id), path) : undefined;
  if (entry && entry.status === "deleted") fail(ctx, "validation.precondition_failed", "This file is deleted in the changeset: discard that change first.");
  if (!entry && typeof baseIn === "number" && baseIn !== num(at.file.version)) fail(ctx, "validation.version_conflict", "The file changed since it was read.");
  const base = baseOf(entry, at.file);
  const counts = lineCounts(await currentBytes(ctx, fileId, base), bytes);
  const { cs, fresh } = changesetFor(ctx, at.root);
  const sealed = seal(ctx, String(cs.id), bytes);
  if (entry) {
    ctx.db.run(
      "UPDATE files_changeset_file SET base_version = ?, content = ?, size = ?, added_lines = ?, removed_lines = ?, conflict = ?, updated_at = ? WHERE changeset_id = ? AND path = ?",
      base, sealed, bytes.byteLength, counts.added, counts.removed, 0, ctx.now(), String(cs.id), path,
    );
  } else {
    insertEntry(ctx, String(cs.id), path, { status: "modified", file: at.file, newName: null, content: sealed, size: bytes.byteLength, added: counts.added, removed: counts.removed, base });
  }
  after(ctx, cs, fresh, path, "modified");
  // The version it would replace: nothing is saved until Approve.
  const current = many(ctx, "SELECT * FROM files_file_version WHERE file_id = ?", fileId).find((r) => num(r.n) === num(at.file.version));
  return { versionId: current ? String(current.id) : "", n: num(at.file.version), lint, added: counts.added, removed: counts.removed, changesetId: String(cs.id) };
}

/** Put staging in front of the plain handlers: an agent's save, delete, rename and move in a Review changes folder land in a changeset. Handlers the map does not have are not added. */
export function withAgentStaging<H extends Record<string, StageHandler>>(base: H): H {
  const out: Record<string, StageHandler> = { ...base };
  const wrap = (name: string, stage: (ctx: Ctx, input: unknown, direct: StageHandler) => Promise<unknown>): void => {
    const direct = base[name];
    if (direct) out[name] = (ctx, input) => stage(ctx, input, direct);
  };
  wrap("files.delete", stageDelete);
  wrap("files.rename", stageRename);
  wrap("files.move", stageMove);
  wrap("files.save", stageSave);
  return out as H;
}

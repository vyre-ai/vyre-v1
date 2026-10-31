// Projects: every project record has its own folder in Files under Projects (the owner's ask: "shouldn't new projects automatically get a folder?").
// The record's `folder` field is the one link; nothing else stores it. projects.create already makes its folder and writes the field, so that path is left alone. A project record made any
// other way (the Records page, an import, an agent, a Journey) gets its folder here, from the `record.created` event, and the boot sweep adopts any that still have none (adoptRecord).
//   create    Files > Projects > <name>; a clash takes "<name> 2", "<name> 3". The create call carries a key built from the record id, so a retried event finds the same folder.
//   rename    the folder follows the title. A folder that holds the title plus a clash number ("Plan 2") is already right and stays.
//   trash     the record moved to Trash: its folder goes to Trash with its files. Restore brings both back. Nothing is purged.
//   access    for a record with no projects row, the folder gets the record's own grants (who may see or edit the project may see or edit the folder), plus the lead (and the maker, with a source of its own) at Manage.
//             The grants carry the source `projfolder:<recordId>` so they are replaced as a set. A project with a projects row already has its roles written on the folder (applyRole).
//             In a Personal Space the owner sees everything and no grant is written.
import { call, codeOf, ensure, projectByRecord, tolerant } from "../projections.ts";
import type { ProjectsCtx } from "../projections.ts";
import { makeProject, projectsRoot } from "./project.ts";
import type { Role } from "../projections.ts";
import type { Made } from "./project.ts";

interface FolderOut { folderId: string; name: string }
export interface HookEvent { name: string; payload: Record<string, unknown>; actor?: string }

const MAX_CLASH = 200;
const LEVELS = ["view", "use", "edit", "manage"] as const;
const rank = (l: unknown): number => LEVELS.indexOf(l as (typeof LEVELS)[number]);
const fstr = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const sourceTag = (recordId: string): string => `projfolder:${recordId}`;

/** A folder name from a project title: no slashes or control characters, never empty. */
export function folderNameOf(title: unknown): string {
  const n = (fstr(title) ?? "Untitled project").replace(/[\\/]/g, "-").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 240);
  return n === "." || n === ".." || n === "" ? "Untitled project" : n;
}
const titleOf = (fields: Record<string, unknown>): string => folderNameOf(fields["title"] ?? fields["name"]);

/** Is this record type a project type (the Project template or one cloned from it)? */
async function isProjectType(ctx: ProjectsCtx, type: unknown): Promise<boolean> {
  if (typeof type !== "string") return false;
  try {
    const r = await call<{ type?: { template?: string } }>(ctx, "schema.types.get", { type });
    return r.type?.template === "project";
  } catch { return false; }
}

async function recordFields(ctx: ProjectsCtx, type: string, recordId: string): Promise<Record<string, unknown> | undefined> {
  try { return (await call<{ record?: { fields?: Record<string, unknown> } }>(ctx, "records.get", { type, recordId })).record?.fields ?? {}; }
  catch (e) { if (codeOf(e) === "validation.not_found") return undefined; throw e; }
}

/** Make Projects/<name> for a record whose folder field is empty and write its id into the field. A record that already has a folder is left alone. Returns the folder id, or undefined when none was made. */
export async function ensureFolder(ctx: ProjectsCtx, type: string, recordId: string, by?: string): Promise<string | undefined> {
  const fields = await recordFields(ctx, type, recordId);
  if (!fields) return undefined;
  if (fstr(fields["folder"])) return undefined;
  const root = await projectsRoot(ctx);
  const base = titleOf(fields);
  let folderId: string | undefined;
  for (let n = 1; n <= MAX_CLASH && !folderId; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    const key = `prj-recfolder:${recordId}:${n}`;
    try {
      folderId = (await call<{ folder: FolderOut }>(ctx, "files.folder.create", { parentId: root, name, idempotencyKey: key }, { idempotencyKey: key })).folder.folderId;
    } catch (e) { if (codeOf(e) !== "validation.duplicate") throw e; }
  }
  if (!folderId) throw new Error("No free folder name for this project.");
  await call(ctx, "records.update", { type, recordId, patch: { folder: folderId } });
  await syncAccess(ctx, type, recordId, folderId, by, fields);
  return folderId;
}

/**
 * Adopt a project record that has no project behind it (made by the old Records New, an import, an agent): it becomes a real project with its folder (the one it has, or a new one under
 * Projects) and its one channel, and its people become roles: the record's Lead leads, who could edit it is a Member, who could only read it is a Guest. The grants the folder got from
 * ensureFolder's mirror are dropped, for the roles now say who may open it. Not a capability: no input of projects.create changes, so nothing is regenerated. Idempotent: a record that already
 * has a project is left alone, and a retry reuses the channel and folder through the keys built from the record id.
 */
export async function adoptRecord(ctx: ProjectsCtx, type: string, recordId: string): Promise<Made | undefined> {
  ensure(ctx.db);
  if (projectByRecord(ctx.db, recordId)) return undefined;
  const fields = await recordFields(ctx, type, recordId);
  if (!fields) return undefined;
  const folderId = fstr(fields["folder"]);
  const lead = fstr(fields["lead"]);
  const roles = new Map<string, Role>();
  const shares = await tolerant<{ shares?: Array<{ grant?: { subject?: { kind?: string; id?: string }; level?: string } }> }>(ctx, "access.shares_of", { resource: { type: "record", id: recordId } }, {});
  for (const s of shares.shares ?? []) {
    const sub = s.grant?.subject;
    if (!sub?.id || (sub.kind !== "person" && sub.kind !== "agent" && sub.kind !== "group")) continue;
    const role: Role = rank(s.grant?.level) >= rank("edit") ? "member" : "guest";
    if (roles.get(sub.id) !== "member") roles.set(sub.id, role);
  }
  const members: Array<{ principal: string; role: Role }> = [...roles].filter(([id]) => id !== lead).map(([principal, role]) => ({ principal, role }));
  const made = await makeProject(ctx, {
    type, title: titleOf(fields), stages: [], members, source: "new", key: `adopt:${recordId}`,
    ...(lead && lead.startsWith("usr_") ? { lead } : {}),
    existing: { recordId, ...(folderId ? { folderId } : {}) },
  });
  if (folderId) {
    await tolerant(ctx, "access.unshare", { resource: { type: "folder", id: folderId }, source: sourceTag(recordId) }, {});
    await tolerant(ctx, "access.unshare", { resource: { type: "folder", id: folderId }, source: `projfolder-maker:${recordId}` }, {});
  }
  return made;
}

/** The folder follows the title of the record. */
export async function followName(ctx: ProjectsCtx, type: string, recordId: string): Promise<void> {
  const fields = await recordFields(ctx, type, recordId);
  const folderId = fstr(fields?.["folder"]);
  if (!fields || !folderId) return;
  let cur: string;
  try { cur = (await call<{ folder: FolderOut }>(ctx, "files.folder.get", { folderId })).folder.name; }
  catch (e) { if (codeOf(e) === "validation.not_found") return; throw e; }
  const base = titleOf(fields);
  for (let n = 1; n <= MAX_CLASH; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (name === cur) return;
    try { await call(ctx, "files.folder.rename", { folderId, name }); return; }
    catch (e) { if (codeOf(e) !== "validation.duplicate") throw e; }
  }
}

/** Trash or restore the folder with its record. A folder that is gone, or a call the Gate holds for approval, is not an error here: the record is already in the state the person chose. */
async function moveWithRecord(ctx: ProjectsCtx, cap: "files.folder.delete" | "files.folder.restore", folderId: string): Promise<void> {
  try { await call(ctx, cap, { folderId }); } catch (e) {
    const code = codeOf(e);
    if (code === "validation.not_found" || code === "permission.on_hold" || code === "validation.precondition_failed") { ctx.log.warn("projects: a project folder was not moved with its record", { cap, folderId, code }); return; }
    throw e;
  }
}

/** Mirror the grants of the record onto the folder (see the header). */
export async function syncAccess(ctx: ProjectsCtx, type: string, recordId: string, folderId: string, by?: string, known?: Record<string, unknown>): Promise<void> {
  ensure(ctx.db);
  if (projectByRecord(ctx.db, recordId)) return;
  const matrix = await tolerant<{ kind?: string }>(ctx, "spaces.matrix", {}, {});
  if (matrix.kind === "personal") return;
  const fields = known ?? await recordFields(ctx, type, recordId) ?? {};
  const want = new Map<string, { subject: { kind: string; id: string }; level: string }>();
  const add = (subject: { kind: string; id: string }, level: string): void => {
    if (subject.kind === "link") return;
    const k = `${subject.kind}:${subject.id}`;
    const have = want.get(k);
    if (!have || rank(level) > rank(have.level)) want.set(k, { subject, level });
  };
  const shares = await tolerant<{ shares?: Array<{ grant?: { subject?: { kind?: string; id?: string }; level?: string }; through?: string }> }>(ctx, "access.shares_of", { resource: { type: "record", id: recordId } }, {});
  for (const s of shares.shares ?? []) {
    const g = s.grant;
    if (g?.subject?.kind && g.subject.id && rank(g.level) >= 0) add({ kind: g.subject.kind, id: g.subject.id }, String(g.level));
  }
  const lead = fstr(fields["lead"]);
  if (lead && lead.startsWith("usr_")) add({ kind: "person", id: lead }, "manage");

  const source = sourceTag(recordId);
  const resource = { type: "folder", id: folderId };
  const mine = await tolerant<{ grants?: Array<{ id: string; subject: { kind: string; id: string }; level: string }> }>(ctx, "access.grants.list", { resource, source }, {});
  const kept = new Set<string>();
  for (const g of mine.grants ?? []) {
    const k = `${g.subject.kind}:${g.subject.id}`;
    if (want.get(k)?.level === g.level && !kept.has(k)) kept.add(k);
    else await call(ctx, "access.unshare", { grantId: g.id });
  }
  // the maker keeps Manage for as long as the folder lives: a later sweep does not know who made the record, so this grant has a source the sweep never replaces
  if (by && by.startsWith("usr_") && !want.has(`person:${by}`)) {
    await call(ctx, "access.share", { resource, subject: { kind: "person", id: by }, level: "manage", source: `projfolder-maker:${recordId}` }, { idempotencyKey: `prj-recfolder-maker:${recordId}:${by}` });
  }
  for (const [k, w] of want) {
    if (kept.has(k)) continue;
    await call(ctx, "access.share", { resource, subject: w.subject, level: w.level, source }, { idempotencyKey: `prj-recfolder-share:${recordId}:${k}:${w.level}:${ctx.now()}` });
  }
}

/** The consumer: record events for project types. */
/** The Space file ids a value names: "fil_..", { fileId }, or a list of them. */
export function fileIdsOf(v: unknown): string[] {
  if (typeof v === "string") return v.startsWith("fil_") ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(fileIdsOf);
  const id = obj(v)["fileId"];
  return typeof id === "string" && id.startsWith("fil_") ? [id] : [];
}

/**
 * A file that lands in a files field of a record, whichever way it got there (the record page, a form that fills the record, an intake or portal upload, an agent, the API), is filed in the record's
 * files folder, so the Files tab shows it and the field still points at the same file: it is moved, never copied. A file that cannot be moved (gone, no access) is left where it is.
 */
export async function fileFieldUploads(ctx: ProjectsCtx, event: HookEvent): Promise<void> {
  if (event.name !== "record.created" && event.name !== "record.updated") return;
  const p = event.payload;
  const type = p["type"], recordId = p["recordId"];
  if (typeof type !== "string" || typeof recordId !== "string") return;
  const changed = obj(p["fields"]);
  const keys = Object.keys(changed);
  if (keys.length === 0) return;
  let def: { fields?: Array<{ key: string; type?: string; kind?: string }> } | undefined;
  try { def = (await call<{ type?: typeof def }>(ctx, "schema.types.get", { type })).type; } catch { return; }
  const fileKeys = new Set((def?.fields ?? []).filter((f) => (f.type ?? f.kind) === "files" || (f.type ?? f.kind) === "file").map((f) => f.key));
  const ids = new Set<string>();
  for (const k of keys) if (fileKeys.has(k)) for (const id of fileIdsOf(changed[k])) ids.add(id);
  for (const fileId of ids) {
    try { await fileIntoRecord(ctx, { type, recordId, fileId }, event.actor); }
    catch (e) { ctx.log.warn("projects: a file on a record was not filed in its folder", { recordId, fileId, error: codeOf(e) }); }
  }
}

export async function onRecordEvent(ctx: ProjectsCtx, event: HookEvent): Promise<void> {
  const p = event.payload;
  const type = p["type"], recordId = p["recordId"];
  if (typeof type !== "string" || typeof recordId !== "string") return;
  await fileFieldUploads(ctx, event);
  if (!(await isProjectType(ctx, type))) return;
  switch (event.name) {
    case "record.created": await ensureFolder(ctx, type, recordId, event.actor); return;
    case "record.updated": await followName(ctx, type, recordId); return;
    case "record.deleted": { const f = fstr(obj(p["prev"])["folder"]); if (f) await moveWithRecord(ctx, "files.folder.delete", f); return; }
    case "record.restored": {
      const fields = await recordFields(ctx, type, recordId);
      const f = fstr(fields?.["folder"]);
      if (f) await moveWithRecord(ctx, "files.folder.restore", f);
      return;
    }
    default: return;
  }
}

/**
 * The boot sweep (and the slow repeat): every project record with no project behind it is adopted as a real project (a channel, roles, and a folder when it has none). Returns how many folders it made.
 */
export async function backfill(ctx: ProjectsCtx): Promise<number> {
  const described = await tolerant<{ types?: Array<{ name?: string; key?: string; template?: string }> }>(ctx, "schema.describe", {}, {});
  let made = 0;
  for (const t of described.types ?? []) {
    const type = t.name ?? t.key;
    if (t.template !== "project" || !type) continue;
    let cursor: string | undefined;
    do {
      const page = await call<{ rows?: Array<{ id: string; fields?: Record<string, unknown>; data?: Record<string, unknown> }>; next?: string }>(ctx, "records.query", { type, limit: 200, ...(cursor ? { cursor } : {}) });
      for (const row of page.rows ?? []) {
        const fields = row.fields ?? row.data ?? {};
        const had = fstr(fields["folder"]);
        try {
          if (await adoptRecord(ctx, type, row.id) && !had) made++;
        } catch (e) {
          // the record could not become a project (a person on it is gone, say): it still gets its folder, and the next sweep tries again
          ctx.log.warn("projects: a project record was not adopted", { recordId: row.id, error: codeOf(e) });
          try { if (await ensureFolder(ctx, type, row.id)) made++; } catch (e2) { ctx.log.warn("projects: a project folder was not made", { recordId: row.id, error: codeOf(e2) }); }
        }
      }
      cursor = page.next;
    } while (cursor);
  }
  return made;
}

// ---- the files folder of any record -----------------------------------------------------------------------------------------------------------------------------------------------------
// Files that belong to a record (attached on its page, uploaded through a form that fills it, a signed document) live in one folder, whatever the record's type. A project's folder is its own
// (the `folder` field). Any other record gets Files > Projects > Record files > "<title> · <last 8 of its id>", made the first time something needs it and kept in projects_record_files, with
// the record's own grants mirrored onto it (syncAccess), so whoever may see the record sees its files. One resolver for every path that puts a file on a record.
const RECORD_FILES = "Record files";
const TAIL = 8;
const RECORD_FILES_TABLE = "CREATE TABLE IF NOT EXISTS projects_record_files (record_id TEXT PRIMARY KEY, folder_id TEXT NOT NULL)";

/** The type a record id belongs to, when the caller (an e-sign envelope, an upload) only has the id: the first type that has it. */
async function typeOfRecord(ctx: ProjectsCtx, recordId: string): Promise<string | undefined> {
  const types = await call<{ types?: Array<{ key: string }> }>(ctx, "schema.types.list", {});
  for (const t of types.types ?? []) if (await recordFields(ctx, t.key, recordId)) return t.key;
  return undefined;
}

export async function recordFilesFolder(ctx: ProjectsCtx, given: { type?: string; recordId: string; create?: boolean }, by?: string): Promise<{ folderId: string | null }> {
  ensure(ctx.db);
  const type = given.type ?? await typeOfRecord(ctx, given.recordId);
  const input = { type: type ?? "", recordId: given.recordId, ...(given.create !== undefined ? { create: given.create } : {}) };
  const fields = input.type === "" ? undefined : await recordFields(ctx, input.type, input.recordId);
  if (!fields) { const e = new Error("no such record") as Error & { code: string }; e.code = "validation.not_found"; throw e; }
  const own = fstr(fields["folder"]);
  if (own) return { folderId: own };
  ctx.db.run(RECORD_FILES_TABLE);
  const kept = ctx.db.all("SELECT folder_id FROM projects_record_files WHERE record_id = ?", input.recordId)[0] as { folder_id?: string } | undefined;
  if (kept?.folder_id) return { folderId: kept.folder_id };
  if (input.create === false) return { folderId: null };
  const root = await projectsRoot(ctx);
  const found = await call<{ folders?: Array<{ folderId: string; name: string; parentId?: string }> }>(ctx, "files.folder.search", { q: RECORD_FILES, scope: "folders", limit: 20 });
  const home = (found.folders ?? []).find((f) => f.name === RECORD_FILES && f.parentId === root)?.folderId
    ?? (await call<{ folder: FolderOut }>(ctx, "files.folder.create", { parentId: root, name: RECORD_FILES, idempotencyKey: `record-files-home:${root}` }, { idempotencyKey: `record-files-home:${root}` })).folder.folderId;
  const name = `${titleOf(fields)} · ${input.recordId.slice(-TAIL)}`;
  const key = `record-files:${input.recordId}`;
  const made = (await call<{ folder: FolderOut }>(ctx, "files.folder.create", { parentId: home, name, idempotencyKey: key }, { idempotencyKey: key })).folder.folderId;
  ctx.db.run("INSERT OR REPLACE INTO projects_record_files (record_id, folder_id) VALUES (?, ?)", input.recordId, made);
  await syncAccess(ctx, input.type, input.recordId, made, by, fields);
  return { folderId: made };
}

/** Put a file that already exists into the record's folder (a move, never a copy), unless it is there already. Returns the folder's id. */
export async function fileIntoRecord(ctx: ProjectsCtx, input: { type?: string; recordId: string; fileId: string }, by?: string): Promise<string> {
  const { folderId } = await recordFilesFolder(ctx, { ...(input.type ? { type: input.type } : {}), recordId: input.recordId }, by);
  const got = await call<{ file?: { folderId?: string } }>(ctx, "files.get", { fileId: input.fileId });
  if (got.file?.folderId !== folderId) await call(ctx, "files.move", { fileId: input.fileId, toFolderId: folderId });
  return folderId!;
}

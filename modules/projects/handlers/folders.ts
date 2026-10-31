// Projects: every project record has its own folder in Files under Projects (the owner's ask: "shouldn't new projects automatically get a folder?").
// The record's `folder` field is the one link; nothing else stores it. projects.create already makes its folder and writes the field, so that path is left alone. A project record made any
// other way (the Records page, an import, an agent, a Journey) gets its folder here, from the `record.created` event, and the boot sweep fills any that still have none.
//   create    Files > Projects > <name>; a clash takes "<name> 2", "<name> 3". The create call carries a key built from the record id, so a retried event finds the same folder.
//   rename    the folder follows the title. A folder that holds the title plus a clash number ("Plan 2") is already right and stays.
//   trash     the record moved to Trash: its folder goes to Trash with its files. Restore brings both back. Nothing is purged.
//   access    for a record with no projects row, the folder gets the record's own grants (who may see or edit the project may see or edit the folder), plus the lead (and the maker, with a source of its own) at Manage.
//             The grants carry the source `projfolder:<recordId>` so they are replaced as a set. A project with a projects row already has its roles written on the folder (applyRole).
//             In a Personal Space the owner sees everything and no grant is written.
import { call, codeOf, ensure, projectByRecord, tolerant } from "../projections.ts";
import type { ProjectsCtx } from "../projections.ts";
import { projectsRoot } from "./project.ts";

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
export async function onRecordEvent(ctx: ProjectsCtx, event: HookEvent): Promise<void> {
  const p = event.payload;
  const type = p["type"], recordId = p["recordId"];
  if (typeof type !== "string" || typeof recordId !== "string") return;
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
 * The boot sweep (and the slow repeat): every project record with an empty folder field gets a folder, and every one that has a folder has its access brought back in line with the
 * record. Returns how many folders it made.
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
        try {
          const fields = row.fields ?? row.data ?? {};
          const folderId = fstr(fields["folder"]);
          if (folderId) { await syncAccess(ctx, type, row.id, folderId, undefined, fields); continue; }
          if (await ensureFolder(ctx, type, row.id)) made++;
        } catch (e) { ctx.log.warn("projects: a project folder was not made", { recordId: row.id, error: codeOf(e) }); }
      }
      cursor = page.next;
    } while (cursor);
  }
  return made;
}

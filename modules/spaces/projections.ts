// Spaces projections: this Space's tile, stars and follows, the first-run checklist (spec 2.1, 2.23, 4.1; ARCH 7.0).
// The server knows only its own Space. The client builds the switcher list from each Space session and shows a red dot for another Space whose tile has needsYou above zero.
import { fail } from "../../host/src/routes/errors.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface ResourceRef { type: string; id: string }
export interface SpacesCtx {
  space: string;
  principal?: { kind: string; id: string };
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown): unknown;
  /** Names a resource for the Starred list; kind marks people and companies, which offer Also follow. Supplied by the host from the records and files modules. */
  resources?: { describe(r: ResourceRef): { title: string; kind?: "person" | "company" } | null };
  /** Counts for the tile: what waits on this person here (Needs you) and what is unread. Supplied by the host from tasks and notifications. */
  attention?: { of(personId: string): { needsYou: number; unread: number } };
  /** The person's role name in this Space. Supplied by the host from the access projection. */
  directory?: { roleName(personId: string): string };
}

export type Step = "photo_title" | "connect_mailbox" | "meet_assistant" | "first_project" | "import";
export const STEPS: { key: Step; title: string }[] = [
  { key: "photo_title", title: "Add a photo and your title" },
  { key: "connect_mailbox", title: "Connect your mailbox and calendar" },
  { key: "meet_assistant", title: "Meet your assistant" },
  { key: "first_project", title: "Open your first project" },
  { key: "import", title: "Import your mailboxes, drives, CRM or spreadsheets" },
];
/** Events that finish a step by themselves; the host's async consumer for spaces calls autoComplete for the event's person. */
export const STEP_EVENTS: Record<string, Step> = {
  "mailbox.connected": "connect_mailbox",
  "project.created": "first_project",
  "import.completed": "import",
};
export const PERSON_KINDS = new Set(["person", "company"]);

type Code = Parameters<typeof fail>[0];
export function raise(traceId: string, code: Code, message?: string): never {
  throw fail(code, traceId, message ? { message } : {});
}
/** Random ids from the platform WebCrypto; modules import no crypto themselves (B3). */
export function nid(prefix: string): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function me(ctx: SpacesCtx): string {
  if (!ctx.principal || ctx.principal.kind !== "person") raise(ctx.trace.traceId, "auth.unauthenticated");
  return ctx.principal.id;
}

export type Table = "spaces_star" | "spaces_follow";
export interface Mark { id: string; person: string; resourceType: string; resourceId: string; createdAt: number; version: number; deleted_at: number | null }

export function markOf(ctx: SpacesCtx, table: Table, person: string, r: ResourceRef): Mark | undefined {
  return ctx.db.all(`SELECT id, person, resourceType, resourceId, createdAt, version, deleted_at FROM ${table} WHERE person = ? AND resourceType = ? AND resourceId = ?`, person, r.type, r.id)[0] as Mark | undefined;
}
/** Set a mark on or off. Returns true when the state changed. A removed mark keeps its row as a tombstone so devices converge, and comes back on re-add. */
export function setMark(ctx: SpacesCtx, table: Table, person: string, r: ResourceRef, on: boolean): boolean {
  const now = ctx.now();
  const row = markOf(ctx, table, person, r);
  const live = !!row && row.deleted_at === null;
  if (on === live) return false;
  if (on) {
    if (row) ctx.db.run(`UPDATE ${table} SET deleted_at = NULL, createdAt = ?, version = ?, updated_at = ? WHERE id = ?`, now, row.version + 1, now, row.id);
    else ctx.db.run(`INSERT INTO ${table} (id, person, resourceType, resourceId, createdAt, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      nid(table === "spaces_star" ? "str" : "flw"), person, r.type, r.id, now, 0, now, null);
  } else {
    ctx.db.run(`UPDATE ${table} SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, now, row!.version + 1, now, row!.id);
  }
  return true;
}
export function listMarks(ctx: SpacesCtx, table: Table, person: string, type?: string): { resource: ResourceRef; title: string; at: number }[] {
  const rows = (type
    ? ctx.db.all(`SELECT resourceType, resourceId, createdAt FROM ${table} WHERE person = ? AND deleted_at IS NULL AND resourceType = ? ORDER BY createdAt DESC, id DESC`, person, type)
    : ctx.db.all(`SELECT resourceType, resourceId, createdAt FROM ${table} WHERE person = ? AND deleted_at IS NULL ORDER BY createdAt DESC, id DESC`, person)) as
    { resourceType: string; resourceId: string; createdAt: number }[];
  const out: { resource: ResourceRef; title: string; at: number }[] = [];
  for (const r of rows) {
    const resource = { type: r.resourceType, id: r.resourceId };
    const d = ctx.resources?.describe(resource);
    if (d === null) continue;   // the host says the thing is gone or not visible to this person
    out.push({ resource, title: d?.title ?? r.resourceId, at: r.createdAt });
  }
  return out;
}

export function doneSteps(ctx: SpacesCtx, person: string): Set<string> {
  return new Set((ctx.db.all(`SELECT step FROM spaces_onboarding WHERE person = ?`, person) as { step: string }[]).map((r) => r.step));
}
/** Mark a step done once. Returns true when it was newly done. */
export function completeStep(ctx: SpacesCtx, person: string, step: Step): boolean {
  if (doneSteps(ctx, person).has(step)) return false;
  ctx.db.run(`INSERT INTO spaces_onboarding (person, step, done_at) VALUES (?, ?, ?)`, person, step, ctx.now());
  ctx.emit("onboarding.step_completed", person, { person, step });
  return true;
}

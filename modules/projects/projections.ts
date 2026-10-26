// @reads /modules/projects/migrations/0001_projects.sql
// Projects: rows, ports to the modules a project works through, and the plan arithmetic (spec 3.4, 2.12; ARCH 7.4).
// A project is a record of the `project` type (or a type cloned from it): its fields live in records. This module keeps what only the project knows (channel, folder, roles, stages, the start of a
// task, dependency arrows, cascade proposals, the status update, pins). Tasks are owned by module tasks and are read through tasks.list; the due date is the task's own.
// Every statement names a projects_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
// DECISION: a task is a milestone when its start equals its due (a zero-length bar, drawn as a diamond); no separate flag is stored.
// DECISION: a dependency arrow (from, to) means `to` cannot start before `from` is due.
// DECISION: a cascade is proposed by reschedule (when a due date moves later) or by projects.cascade, stored as a proposal, and applied only by a person with decision `apply`; an agent or an
// automation proposes, never applies.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintId as mint } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface Principal { kind: "person" | "agent" | "actor" | "service"; id: string }
export type Level = "view" | "use" | "edit" | "manage";

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface ProjectsCtx {
  space: string;
  principal: Principal;
  actingFor?: string | undefined;
  thread?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call?(cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<unknown>;
  authorize?(action: { perm: string | null; level: Level }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type In = Record<string, any>;

export function raise(ctx: Pick<ProjectsCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}
export const newId = (prefix: string, now: number): string => mint(prefix, now).replaceAll("-", "");
const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
const num = (v: unknown): number => Number(v);
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const parseJson = <T>(raw: unknown, fallback: T): T => { try { return raw === null || raw === undefined ? fallback : (JSON.parse(str(raw)) as T); } catch { return fallback; } };
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
/** The person behind a call: the person an agent acts for, else the caller. */
export const me = (ctx: Pick<ProjectsCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;
export const isPerson = (ctx: Pick<ProjectsCtx, "principal" | "actingFor">): boolean => ctx.principal.kind === "person" && (ctx.actingFor === undefined || ctx.actingFor.startsWith("usr_"));

// ---- schema ----

const SCHEMA = readFileSync(new URL("./migrations/0001_projects.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();

/** Make sure the projects tables exist. One cheap probe per handle; the IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT key FROM projects_key WHERE key = ?", "probe"); } catch { for (const stmt of SCHEMA) db.run(stmt); }
  ready.add(db);
}

// ---- ports to neighbours ----

export async function call<T>(ctx: ProjectsCtx, cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
  if (!ctx.call) raise(ctx, "internal.unexpected", "That part of the app is not available right now.", { cap });
  return (await ctx.call(cap, input, opts)) as T;
}
/** Like `call`, but a neighbour that is not there (or refuses) gives the fallback: what a page shows must not fail because a neighbour is down. */
export async function tolerant<T>(ctx: ProjectsCtx, cap: string, input: unknown, fallback: T): Promise<T> {
  if (!ctx.call) return fallback;
  try { return ((await ctx.call(cap, input)) as T | null | undefined) ?? fallback; } catch (e) {
    ctx.log.warn("projects: a neighbour did not answer", { cap, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    return fallback;
  }
}
/** The code of an error thrown by a call, if it has one. */
export const codeOf = (e: unknown): string => { const x = e as { error?: { code?: string }; code?: string }; return x?.error?.code ?? x?.code ?? "unknown"; };

// ---- projects ----

export type Source = "new" | "channel" | "journey" | "template";
export interface Project {
  projectId: string; recordId: string; type: string; channelId?: string | undefined; folderId?: string | undefined; threadId?: string | undefined;
  source: Source; createdBy: string; createdAt: number;
}
const toProject = (r: Row): Project => ({
  projectId: str(r["projectId"]), recordId: str(r["recordId"]), type: str(r["type"]), channelId: optStr(r["channelId"]), folderId: optStr(r["folderId"]), threadId: optStr(r["threadId"]),
  source: str(r["source"]) as Source, createdBy: str(r["createdBy"]), createdAt: num(r["createdAt"]),
});
export function saveProject(db: Db, p: Project): void {
  db.run(
    `INSERT INTO projects_project (projectId, recordId, type, channelId, folderId, threadId, source, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(projectId) DO UPDATE SET channelId = excluded.channelId, folderId = excluded.folderId, threadId = excluded.threadId`,
    p.projectId, p.recordId, p.type, p.channelId ?? null, p.folderId ?? null, p.threadId ?? null, p.source, p.createdBy, p.createdAt,
  );
}
export function projectBy(db: Db, projectId: string): Project | undefined {
  const r = (db.all("SELECT * FROM projects_project WHERE projectId = ?", projectId) as Row[])[0];
  return r ? toProject(r) : undefined;
}
export function projectByRecord(db: Db, recordId: string): Project | undefined {
  const r = (db.all("SELECT * FROM projects_project WHERE recordId = ?", recordId) as Row[])[0];
  return r ? toProject(r) : undefined;
}
export function projectByChannel(db: Db, channelId: string): Project | undefined {
  const r = (db.all("SELECT * FROM projects_project WHERE channelId = ?", channelId) as Row[])[0];
  return r ? toProject(r) : undefined;
}
export function allProjects(db: Db): Project[] {
  return (db.all("SELECT * FROM projects_project ORDER BY createdAt DESC, projectId DESC") as Row[]).map(toProject);
}

/** Does the host let the caller do this on the project? Without an authorizer nothing is allowed: a ctx that cannot ask has no answer to give (P-SEC_10). */
export function allows(ctx: ProjectsCtx, level: Level, projectId: string): boolean {
  if (!ctx.authorize) return false;
  return ctx.authorize({ perm: null, level }, { type: "project", id: projectId }).effect === "allow";
}
/** A project the caller may see, or the same answer as for one that is not there (what exists is not leaked). */
export function visible(ctx: ProjectsCtx, projectId: string, level: Level = "view"): Project {
  ensure(ctx.db);
  const p = projectBy(ctx.db, projectId);
  if (!p || !allows(ctx, level, projectId)) raise(ctx, "validation.not_found", "That project does not exist.");
  return p;
}

// ---- people ----

export type Role = "lead" | "member" | "reviewer" | "guest";
export interface Member { principal: string; role: Role; kind: "person" | "agent" | "group"; since: number }
const toMember = (r: Row): Member => ({ principal: str(r["principal"]), role: str(r["role"]) as Role, kind: str(r["kind"]) as Member["kind"], since: num(r["since"]) });
export function membersOf(db: Db, projectId: string): Member[] {
  return (db.all("SELECT * FROM projects_member WHERE projectId = ? ORDER BY since ASC, principal ASC", projectId) as Row[]).map(toMember);
}
export function memberOf(db: Db, projectId: string, principal: string): Member | undefined {
  const r = (db.all("SELECT * FROM projects_member WHERE projectId = ? AND principal = ?", projectId, principal) as Row[])[0];
  return r ? toMember(r) : undefined;
}
export function saveMember(db: Db, projectId: string, m: Member): void {
  db.run(
    "INSERT INTO projects_member (projectId, principal, role, kind, since) VALUES (?, ?, ?, ?, ?) ON CONFLICT(projectId, principal) DO UPDATE SET role = excluded.role",
    projectId, m.principal, m.role, m.kind, m.since,
  );
}
export function dropMember(db: Db, projectId: string, principal: string): boolean {
  return db.run("DELETE FROM projects_member WHERE projectId = ? AND principal = ?", projectId, principal).changes > 0;
}
export function countMembers(db: Db, projectId: string): number {
  return num((db.all("SELECT COUNT(*) AS n FROM projects_member WHERE projectId = ?", projectId) as Row[])[0]?.["n"] ?? 0);
}
export function isMember(db: Db, projectId: string, principal: string): boolean { return memberOf(db, projectId, principal) !== undefined; }
/** The kind of a principal id (usr, agt, grp); roles and automations cannot hold a project role. */
export function kindOfPrincipal(id: string): Member["kind"] | undefined {
  if (id.startsWith("usr_")) return "person";
  if (id.startsWith("agt_")) return "agent";
  if (id.startsWith("grp_")) return "group";
  return undefined;
}
/** Project roles map to grants (spec 2.4): Lead manage, Member edit, Reviewer and Guest view. */
export const LEVEL_OF: Record<Role, Level> = { lead: "manage", member: "edit", reviewer: "view", guest: "view" };

// ---- stages ----

export interface Stage { key: string; title: string; order: number }
export function stagesOf(db: Db, projectId: string): Stage[] {
  return (db.all("SELECT key, title, ord FROM projects_stage WHERE projectId = ? ORDER BY ord ASC, key ASC", projectId) as Row[]).map((r) => ({ key: str(r["key"]), title: str(r["title"]), order: num(r["ord"]) }));
}
export function replaceStages(db: Db, projectId: string, stages: readonly Stage[]): void {
  db.run("DELETE FROM projects_stage WHERE projectId = ?", projectId);
  for (const s of stages) db.run("INSERT INTO projects_stage (projectId, key, title, ord) VALUES (?, ?, ?, ?)", projectId, s.key, s.title, s.order);
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
/** Stages from a list of {key?, title}: keys kept, missing ones made from the title, no key twice. */
export function buildStages(ctx: Pick<ProjectsCtx, "trace">, input: ReadonlyArray<{ key?: string | undefined; title: string }>): Stage[] {
  const out: Stage[] = [];
  const used = new Set<string>();
  for (const s of input) {
    const title = String(s.title ?? "").trim();
    if (!title) raise(ctx, "validation.bad_input", "A stage needs a name.");
    let key = s.key;
    if (key !== undefined && !/^[a-z][a-z0-9_]*$/.test(key)) raise(ctx, "validation.bad_input", `${key} is not a stage key.`, { stage: key });
    if (key === undefined) {
      const base = /^[a-z]/.test(slug(title)) ? slug(title) : `s_${slug(title)}`;
      key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    }
    if (used.has(key)) raise(ctx, "validation.bad_input", `Two stages share the key ${key}.`, { stage: key });
    used.add(key);
    out.push({ key, title, order: out.length });
  }
  return out;
}

// ---- plan facts of a task ----

export interface PlanRow { taskId: string; stage?: string | undefined; start?: number | undefined; ord?: number | undefined; threadId?: string | undefined }
const toPlan = (r: Row): PlanRow => ({ taskId: str(r["taskId"]), stage: optStr(r["stage"]), start: optNum(r["start"]), ord: optNum(r["ord"]), threadId: optStr(r["threadId"]) });
export function plansOf(db: Db, projectId: string): Map<string, PlanRow> {
  return new Map((db.all("SELECT * FROM projects_plan WHERE projectId = ?", projectId) as Row[]).map((r) => [str(r["taskId"]), toPlan(r)]));
}
export function planOf(db: Db, projectId: string, taskId: string): PlanRow | undefined {
  const r = (db.all("SELECT * FROM projects_plan WHERE projectId = ? AND taskId = ?", projectId, taskId) as Row[])[0];
  return r ? toPlan(r) : undefined;
}
/** Write the plan facts of a task: a field left out stays as it was; `null` clears it. */
export function savePlan(db: Db, projectId: string, taskId: string, patch: { stage?: string | null; start?: number | null; ord?: number | null; threadId?: string | null }): void {
  const cur = planOf(db, projectId, taskId);
  const pick = <T>(k: T | null | undefined, old: T | undefined): T | null => (k === undefined ? (old ?? null) : k);
  db.run(
    `INSERT INTO projects_plan (projectId, taskId, stage, start, ord, threadId) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(projectId, taskId) DO UPDATE SET stage = excluded.stage, start = excluded.start, ord = excluded.ord, threadId = excluded.threadId`,
    projectId, taskId, pick(patch.stage, cur?.stage), pick(patch.start, cur?.start), pick(patch.ord, cur?.ord), pick(patch.threadId, cur?.threadId),
  );
}

// ---- dependency arrows ----

export interface Link { from: string; to: string }
export function linksOf(db: Db, projectId: string): Link[] {
  return (db.all("SELECT fromTask, toTask FROM projects_link WHERE projectId = ? ORDER BY fromTask, toTask", projectId) as Row[]).map((r) => ({ from: str(r["fromTask"]), to: str(r["toTask"]) }));
}
export function addLink(db: Db, projectId: string, l: Link): boolean {
  return db.run("INSERT OR IGNORE INTO projects_link (projectId, fromTask, toTask) VALUES (?, ?, ?)", projectId, l.from, l.to).changes > 0;
}
export function dropLink(db: Db, projectId: string, l: Link): boolean {
  return db.run("DELETE FROM projects_link WHERE projectId = ? AND fromTask = ? AND toTask = ?", projectId, l.from, l.to).changes > 0;
}
/** Would an arrow from -> to close a loop? True when `from` is already reachable from `to`. */
export function closesLoop(links: readonly Link[], l: Link): boolean {
  if (l.from === l.to) return true;
  const next = new Map<string, string[]>();
  for (const k of links) next.set(k.from, [...(next.get(k.from) ?? []), k.to]);
  const seen = new Set<string>();
  const stack = [l.to];
  while (stack.length > 0) {
    const at = stack.pop() as string;
    if (at === l.from) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    stack.push(...(next.get(at) ?? []));
  }
  return false;
}

// ---- cascade proposals ----

export interface Move { taskId: string; fromStart?: number | undefined; toStart?: number | undefined; fromDue?: number | undefined; toDue?: number | undefined }
export interface Hold { taskId: string; reason: string }
export interface Proposal { proposalId: string; projectId: string; taskId: string; by: string; createdAt: number; state: "open" | "applied" | "kept"; moves: Move[]; holds: Hold[]; summary: string }
const toProposal = (r: Row): Proposal => ({
  proposalId: str(r["proposalId"]), projectId: str(r["projectId"]), taskId: str(r["taskId"]), by: str(r["byWho"]), createdAt: num(r["createdAt"]), state: str(r["state"]) as Proposal["state"],
  moves: parseJson<Move[]>(r["moves"], []), holds: parseJson<Hold[]>(r["holds"], []), summary: str(r["summary"]),
});
export function saveProposal(db: Db, p: Proposal): void {
  db.run(
    `INSERT INTO projects_proposal (proposalId, projectId, taskId, byWho, createdAt, state, moves, holds, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(proposalId) DO UPDATE SET state = excluded.state`,
    p.proposalId, p.projectId, p.taskId, p.by, p.createdAt, p.state, JSON.stringify(p.moves), JSON.stringify(p.holds), p.summary,
  );
}
export function proposalBy(db: Db, proposalId: string): Proposal | undefined {
  const r = (db.all("SELECT * FROM projects_proposal WHERE proposalId = ?", proposalId) as Row[])[0];
  return r ? toProposal(r) : undefined;
}
export function openProposals(db: Db, projectId: string): Proposal[] {
  return (db.all("SELECT * FROM projects_proposal WHERE projectId = ? AND state = 'open' ORDER BY createdAt ASC", projectId) as Row[]).map(toProposal);
}

// ---- status update, pins, filed chats, share links, keys ----

export interface UpdateRow { text: string; at: number; by: string; drafted: boolean }
export function updateOf(db: Db, projectId: string): UpdateRow | undefined {
  const r = (db.all("SELECT * FROM projects_update WHERE projectId = ?", projectId) as Row[])[0];
  return r ? { text: str(r["text"]), at: num(r["at"]), by: str(r["byWho"]), drafted: num(r["drafted"]) === 1 } : undefined;
}
export function saveUpdate(db: Db, projectId: string, u: UpdateRow): void {
  db.run(
    "INSERT INTO projects_update (projectId, text, at, byWho, drafted) VALUES (?, ?, ?, ?, ?) ON CONFLICT(projectId) DO UPDATE SET text = excluded.text, at = excluded.at, byWho = excluded.byWho, drafted = excluded.drafted",
    projectId, u.text, u.at, u.by, u.drafted ? 1 : 0,
  );
}
export function pinsOf(db: Db, projectId: string): string[] {
  return (db.all("SELECT fileId FROM projects_pin WHERE projectId = ? ORDER BY at ASC, fileId ASC", projectId) as Row[]).map((r) => str(r["fileId"]));
}
export function addPin(db: Db, projectId: string, fileId: string, at: number): boolean { return db.run("INSERT OR IGNORE INTO projects_pin (projectId, fileId, at) VALUES (?, ?, ?)", projectId, fileId, at).changes > 0; }
export function dropPin(db: Db, projectId: string, fileId: string): boolean { return db.run("DELETE FROM projects_pin WHERE projectId = ? AND fileId = ?", projectId, fileId).changes > 0; }
export function addFiled(db: Db, projectId: string, threadId: string, at: number): boolean { return db.run("INSERT OR IGNORE INTO projects_filed (projectId, threadId, at) VALUES (?, ?, ?)", projectId, threadId, at).changes > 0; }

/** The answer a keyed call already gave, if any. */
export function keyed<T>(db: Db, key: string | undefined, cap: string): T | undefined {
  if (key === undefined) return undefined;
  const r = (db.all("SELECT result FROM projects_key WHERE key = ? AND cap = ?", key, cap) as Row[])[0];
  return r ? parseJson<T | undefined>(r["result"], undefined) : undefined;
}
export function remember(db: Db, key: string | undefined, cap: string, result: unknown): void {
  if (key === undefined) return;
  db.run("INSERT OR REPLACE INTO projects_key (key, cap, result) VALUES (?, ?, ?)", key, cap, JSON.stringify(result));
}

// ---- tasks (module tasks owns them) ----

export type TaskState = "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
export interface TaskView {
  taskId: string; title: string; state: TaskState; due?: number | undefined; assigned?: string | undefined; reviewer?: string | undefined; approver?: string | undefined;
  threadId?: string | undefined; dependsOn: string[]; createdAt: number;
}
export const isOpenState = (s: TaskState): boolean => s !== "done" && s !== "canceled";
const slot = (v: unknown): string | undefined => (v && typeof v === "object" ? optStr((v as { id?: unknown }).id) : undefined);
export function toTask(raw: unknown): TaskView {
  const r = (raw ?? {}) as Row;
  return {
    taskId: str(r["id"] ?? r["taskId"]), title: str(r["title"] ?? ""), state: str(r["state"] ?? "todo") as TaskState, due: optNum(r["due"]), assigned: slot(r["assigned"]), reviewer: slot(r["reviewer"]),
    approver: slot(r["approver"]), threadId: optStr(r["threadId"]), dependsOn: Array.isArray(r["dependsOn"]) ? (r["dependsOn"] as unknown[]).map(str) : [], createdAt: num(r["createdAt"] ?? 0),
  };
}
/** Every task linked to the project record, in pages of 500. */
export async function loadTasks(ctx: ProjectsCtx, p: Project): Promise<TaskView[]> {
  const out: TaskView[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await call<{ tasks?: unknown[]; next?: string }>(ctx, "tasks.list", { scope: "record", recordId: p.recordId, limit: 500, ...(cursor ? { cursor } : {}) });
    out.push(...(page.tasks ?? []).map(toTask));
    if (!page.next) break;
    cursor = page.next;
  }
  return out;
}

export interface PlanTask {
  taskId: string; title: string; stage?: string | undefined; start?: number | undefined; due?: number | undefined; milestone: boolean; status: TaskState;
  assigned?: string | undefined; reviewer?: string | undefined; approver?: string | undefined; ring?: "review" | "approval" | undefined; threadId?: string | undefined; order?: number | undefined;
}
/** A task as the plan shows it: the task's own facts with the project's plan facts beside them. */
export function planTask(t: TaskView, plan: PlanRow | undefined): PlanTask {
  const start = plan?.start;
  return clean({
    taskId: t.taskId, title: t.title, stage: plan?.stage, start, due: t.due, milestone: start !== undefined && t.due !== undefined && start === t.due, status: t.state,
    assigned: t.assigned, reviewer: t.reviewer, approver: t.approver, ring: t.state === "in_review" ? "review" as const : t.state === "awaiting_approval" ? "approval" as const : undefined,
    threadId: t.threadId ?? plan?.threadId, order: plan?.ord,
  });
}
export function sortPlan(tasks: PlanTask[]): PlanTask[] {
  return [...tasks].sort((a, b) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || (a.start ?? a.due ?? Number.MAX_SAFE_INTEGER) - (b.start ?? b.due ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title) || a.taskId.localeCompare(b.taskId));
}

// ---- the record of the project (module records owns it) ----

export interface RecordFields { fields: Record<string, unknown> }
export async function readRecord(ctx: ProjectsCtx, p: Project): Promise<Record<string, unknown>> {
  const r = await call<{ record?: { fields?: Record<string, unknown> } }>(ctx, "records.get", { type: p.type, recordId: p.recordId });
  return r.record?.fields ?? {};
}
export async function writeRecord(ctx: ProjectsCtx, p: Project, patch: Record<string, unknown>): Promise<void> {
  await call(ctx, "records.update", { type: p.type, recordId: p.recordId, patch });
}

export interface ProjectRowOut {
  projectId: string; recordId: string; type: string; title: string; summary?: string; status: string; lead?: string; start?: number; due?: number;
  channelId: string; folderId: string; memberCount: number; openTasks: number; lateTasks: number;
}
const fstr = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const fnum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** The project as the list and the page show it: the record's fields, the channel and folder, and counts from the tasks. */
export function projectRow(ctx: ProjectsCtx, p: Project, fields: Record<string, unknown>, tasks: readonly TaskView[]): ProjectRowOut {
  const open = tasks.filter((t) => isOpenState(t.state));
  const now = ctx.now();
  return clean({
    projectId: p.projectId, recordId: p.recordId, type: p.type, title: fstr(fields["title"]) ?? fstr(fields["name"]) ?? "", summary: fstr(fields["summary"]),
    status: fstr(fields["status"]) ?? "planning", lead: fstr(fields["lead"]), start: fnum(fields["start"]), due: fnum(fields["due"]),
    channelId: p.channelId ?? "", folderId: p.folderId ?? "", memberCount: countMembers(ctx.db, p.projectId), openTasks: open.length,
    lateTasks: open.filter((t) => t.due !== undefined && t.due < now).length,
  }) as ProjectRowOut;
}

export function emitP(ctx: ProjectsCtx, name: EventName, projectId: string, payload: Record<string, unknown>): void {
  ctx.emit(name, `project/${projectId}`, clean({ projectId, ...payload }));
}
export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

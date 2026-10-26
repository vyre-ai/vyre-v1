// Test harness for the projects module: a real in-memory SQLite behind the host's ctx.db guard (projects_* tables only), a recording ctx, a clock the tests move, and a small world standing in for
// the modules a project calls (records, tasks, files, channels, chat, access, schema) that keeps what it was asked to do, plus checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { savePlan } from "../projections.ts";
import type { Principal, ProjectsCtx } from "../projections.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

export const NOW = 1_760_000_000_000;
export const DAY = 86_400_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_projectstest";
export const DANA = "usr_dana";
export const MAYA = "usr_maya";
export const LEO = "usr_leo";
export const BOT = "agt_helper";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: any; key?: string | undefined }   // eslint-disable-line @typescript-eslint/no-explicit-any

type Handler = (input: any, opts?: { idempotencyKey?: string }) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { error: { code, message } }); };

export interface FakeTask { id: string; title: string; state: string; due?: number | undefined; assigned?: { kind: string; id: string } | undefined; recordId: string; dependsOn: string[]; threadId?: string | undefined; createdAt: number }
export interface Grant { resource: { type: string; id: string }; subject: { kind: string; id: string }; level: string; source: string }

/** The neighbours of Projects, in memory. Each keeps what it was told, so a test can look at what the project asked for. */
export function fakeWorld(clock: { t: number }) {
  const calls: Called[] = [];
  const records = new Map<string, { id: string; type: string; fields: Record<string, unknown> }>();
  const tasks = new Map<string, FakeTask>();
  const grants: Grant[] = [];
  const folders = new Map<string, { folderId: string; parentId?: string; name: string }>();
  const channels = new Map<string, { channelId: string; mainThreadId: string; name: string; folderId?: string; recordId?: string }>();
  const posts: Array<{ threadId: string; body: string }> = [];
  const threadFolders = new Map<string, string>();
  const keys = new Map<string, unknown>();
  const types = new Map<string, { key: string; title: string; template?: string }>([["project", { key: "project", title: "Project", template: "project" }], ["contact", { key: "contact", title: "Contact" }]]);
  const down = new Set<string>();
  let n = 0;
  const next = (prefix: string): string => `${prefix}_${(++n).toString(36).padStart(6, "0")}`;
  const root = { folderId: next("fld"), name: "Projects" };
  folders.set(root.folderId, root);
  const keyed = (o: { idempotencyKey?: string } | undefined, scope: string, make: () => unknown): unknown => {
    const k = o?.idempotencyKey ? `${scope}:${o.idempotencyKey}` : undefined;
    if (k && keys.has(k)) return keys.get(k);
    const out = make();
    if (k) keys.set(k, out);
    return out;
  };
  const taskRow = (t: FakeTask) => ({
    id: t.id, kind: "work", title: t.title, state: t.state, blocked: false, blocks: [], actions: [], assigned: t.assigned ?? { kind: "person", id: DANA }, dependsOn: t.dependsOn, fileIds: [], followers: [],
    workingNotes: {}, reviewLoops: 0, createdBy: DANA, createdAt: t.createdAt, updatedAt: t.createdAt, recordId: t.recordId, ...(t.due !== undefined ? { due: t.due } : {}), ...(t.threadId ? { threadId: t.threadId } : {}),
  });
  const recordOut = (r: { id: string; type: string; fields: Record<string, unknown> }) => ({ id: r.id, type: r.type, version: 1, label: 0, fields: r.fields, createdAt: clock.t, updatedAt: clock.t, holds: 0 });

  const handlers: Record<string, Handler> = {
    "schema.types.get": (i) => { const t = types.get(i.type) ?? fail("validation.not_found", "no such type"); return { type: { ...t, plural: t.title, icon: "x", label: 0, system: false, fields: [], version: 1 } }; },
    "schema.describe": () => ({ types: [...types.values()].map((t) => ({ ...t, fields: t.template ? [{ key: "status", type: "status", title: "Status", options: { stages: [{ key: "planning" }, { key: "active" }, { key: "done" }] } }] : [] })) }),
    "records.create": (i, o) => keyed(o, "rc", () => { const id = next("rec"); const r = { id, type: i.type, fields: { ...i.fields } }; records.set(id, r); return { record: recordOut(r) }; }),
    "records.get": (i) => { const r = records.get(i.recordId) ?? fail("validation.not_found", "no such record"); return { record: recordOut(r) }; },
    "records.update": (i) => { const r = records.get(i.recordId) ?? fail("validation.not_found", "no such record"); for (const [k, v] of Object.entries(i.patch)) { if (v === null) delete r.fields[k]; else r.fields[k] = v; } return { record: recordOut(r) }; },
    "files.folder.search": (i) => ({ folders: [...folders.values()].filter((f) => f.name.toLowerCase().includes(String(i.q).toLowerCase())).map((f) => ({ ...f, path: f.name })) }),
    "files.folder.create": (i, o) => keyed(o, "fc", () => {
      if ([...folders.values()].some((f) => f.parentId === i.parentId && f.name === i.name)) fail("validation.duplicate", "a folder with that name exists");
      const folderId = next("fld");
      folders.set(folderId, { folderId, parentId: i.parentId, name: i.name });
      return { folder: { folderId, parentId: i.parentId, name: i.name, path: `Projects/${i.name}` } };
    }),
    "files.get": (i) => (i.fileId === "fil_missing" ? fail("validation.not_found", "no such file") : { file: { fileId: i.fileId, name: "x.pdf" } }),
    "channels.create": (i, o) => keyed(o, "cc", () => {
      const channelId = next("chn");
      const c = { channelId, mainThreadId: next("thr"), name: i.name, ...(i.folderId ? { folderId: i.folderId } : {}), ...(i.recordId ? { recordId: i.recordId } : {}) };
      channels.set(channelId, c);
      return { channel: c };
    }),
    "channels.get": (i) => ({ channel: channels.get(i.channelId) ?? fail("validation.not_found", "no such channel") }),
    "chat.post": (i, o) => keyed(o, "cp", () => { posts.push({ threadId: i.threadId, body: i.body }); return { message: { messageId: next("msg") } }; }),
    "chat.thread": () => ({ thread: { threadId: next("thr") } }),
    "threads.get": (i) => (i.threadId === "thr_missing" ? fail("validation.not_found", "no such thread") : { thread: { threadId: i.threadId } }),
    "threads.set_folder": (i) => { threadFolders.set(i.threadId, i.folderId); return { thread: { threadId: i.threadId } }; },
    "threads.list": () => ({ threads: [{ threadId: "thr_recent", title: "Kickoff", createdAt: clock.t }] }),
    "access.share": (i, o) => keyed(o, "as", () => { grants.push({ resource: i.resource, subject: i.subject, level: i.level, source: i.source }); return { grant: { id: next("gnt") } }; }),
    "access.unshare": (i) => {
      const before = grants.length;
      for (let x = grants.length - 1; x >= 0; x--) {
        const g = grants[x] as Grant;
        if (g.source === i.source && g.resource.type === i.resource.type && g.resource.id === i.resource.id && (!i.subject || (g.subject.id === i.subject.id && g.subject.kind === i.subject.kind))) grants.splice(x, 1);
      }
      return { revoked: before - grants.length };
    },
    "tasks.create": (i, o) => keyed(o, "tc", () => {
      const t: FakeTask = { id: next("tsk"), title: i.title, state: "todo", due: i.due, assigned: i.assigned, recordId: i.recordId, dependsOn: [], createdAt: clock.t };
      tasks.set(t.id, t);
      return { task: taskRow(t) };
    }),
    "tasks.list": (i) => ({ tasks: [...tasks.values()].filter((t) => i.scope === "record" && t.recordId === i.recordId).map(taskRow) }),
    "tasks.update": (i) => {
      const t = tasks.get(i.taskId) ?? fail("validation.not_found", "no such task");
      if ("due" in i) t.due = i.due ?? undefined;
      return { task: taskRow(t) };
    },
    "tasks.dependencies.add": (i) => {
      const t = tasks.get(i.taskId) ?? fail("validation.not_found", "no such task");
      if (!t.dependsOn.includes(i.dependsOnId)) t.dependsOn.push(i.dependsOnId);
      return { task: taskRow(t) };
    },
    "tasks.dependencies.remove": (i) => { const t = tasks.get(i.taskId) ?? fail("validation.not_found", "no such task"); t.dependsOn = t.dependsOn.filter((d) => d !== i.dependsOnId); return { task: taskRow(t) }; },
  };
  return { calls, records, tasks, grants, folders, channels, posts, threadFolders, types, handlers, root, down, next };
}
export type FakeWorld = ReturnType<typeof fakeWorld>;

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: SPACE, projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export interface HarnessOptions {
  raw?: RawDb;
  principal?: Principal;
  actingFor?: string;
  clock?: { t: number };
  world?: FakeWorld;
  /** Permissions the caller holds, by action and resource. Default: everything. */
  allow?: (action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => boolean;
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  const warned: string[] = [];
  const world = o.world ?? fakeWorld(clock);
  let allow = o.allow ?? (() => true);
  const db = scopedDb("projects", raw, TRACE);
  const ctx: ProjectsCtx = {
    space: SPACE,
    principal: o.principal ?? { kind: "person", id: DANA },
    ...(o.actingFor === undefined ? {} : { actingFor: o.actingFor }),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) { emitted.push({ name, subject, payload: payload as Record<string, unknown> }); return null; },
    async call(cap, input, opts) {
      assertStrictInput(cap, input);
      world.calls.push({ cap, input, key: opts?.idempotencyKey });
      const f = world.handlers[cap];
      if (!f || world.down.has(cap)) throw Object.assign(new Error(`${cap} is not available`), { error: { code: "internal.unavailable", message: `${cap} is not available` } });
      return f(input, opts);
    },
    authorize: (action, resource) => ({ effect: allow(action, resource) ? "allow" : "deny" }),
    log: { warn(msg) { warned.push(msg); } },
  };
  const h = {
    ctx, raw, db, emitted, clock, world, warned,
    advance(ms: number) { clock.t += ms; },
    allowOnly(f: NonNullable<HarnessOptions["allow"]>) { allow = f; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    names(): string[] { return emitted.map((e) => e.name); },
    clear() { emitted.length = 0; world.calls.length = 0; },
    only(cap: string): Called[] { return world.calls.filter((c) => c.cap === cap); },
    /** The same database as another principal. */
    as(principal: Principal, actingFor?: string): ProjectsCtx { return { ...ctx, principal, ...(actingFor === undefined ? {} : { actingFor }) }; },
    person(id: string): ProjectsCtx { return h.as({ kind: "person", id }); },
    agent(id: string, actingFor?: string): ProjectsCtx { return h.as({ kind: "agent", id }, actingFor); },
    /** A task in a project, as a person would have made it in Tasks, with its start in the plan. */
    task(project: { projectId: string; recordId: string }, t: { title: string; due?: number; start?: number; state?: string; stage?: string; assigned?: string }): string {
      const id = world.next("tsk");
      world.tasks.set(id, { id, title: t.title, state: t.state ?? "todo", due: t.due, assigned: t.assigned ? { kind: t.assigned.startsWith("agt_") ? "agent" : "person", id: t.assigned } : undefined, recordId: project.recordId, dependsOn: [], createdAt: clock.t });
      if (t.start !== undefined || t.stage !== undefined) savePlan(db, project.projectId, id, { start: t.start ?? null, stage: t.stage ?? null });
      return id;
    },
  };
  return h;
}
export type Harness = ReturnType<typeof harness>;

export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}
/** Errors of a value against the frozen input or output of a capability. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}
export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}
export function codeOf(err: unknown): string {
  const e = err as { error?: { code?: string }; code?: string };
  return e?.error?.code ?? e?.code ?? "unknown";
}
export function reasonOf(err: unknown): unknown {
  return ((err as { error?: { details?: { reason?: unknown } } })?.error?.details ?? {}).reason;
}
export async function failure(f: () => unknown): Promise<string> {
  try { await f(); } catch (e) { return codeOf(e); }
  return "none";
}

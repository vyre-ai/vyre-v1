// A goal's world in one process: a real SQLite database behind the host's table guard for the goals tables, and stand-ins for the modules a goal calls (chat, tasks, files, access, the Gate,
// records, memory). The stand-ins keep just enough state for the goal to read back what it did: tasks with states and parents, folders, shares, grants, posts.
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { handlers } from "../impl.ts";
import { onMention, onMessage, onTask, onTurn, onWaiting, sweep } from "../handlers/events.ts";
import type { Db, GoalsCtx } from "../projections.ts";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
export const OWNER = "usr_owner", LEAD = "agt_lead", HELPER = "agt_helper", ALIZA = "usr_aliza", STRANGER = "usr_stranger";
/** Tue 3 Nov 2026, 10:00 in Karachi (05:00 UTC). */
export const T0 = Date.UTC(2026, 10, 3, 5, 0);
export const HOUR = 3_600_000, DAY = 24 * HOUR;

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface FakeTask { fileIds?: string[]; id: string; kind: string; title: string; state: string; parentTaskId?: string; threadId?: string; key?: string; assigned?: Obj; workingNotes: Record<string, string>; createdBy: string; summary?: string }
export interface Caller { id: string; kind?: "person" | "agent" | "service"; actingFor?: string; origin?: string; depth?: number }
export const owner: Caller = { id: OWNER, kind: "person", origin: "app" };
export const lead: Caller = { id: LEAD, kind: "agent", actingFor: OWNER };
export const host: Caller = { id: "svc_host", kind: "service" };

export function world(o: { count?: number; failRead?: string; failMembers?: string } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  const norm = (a: unknown): unknown => (a === undefined ? null : a);
  const raw: Db = {
    all: (sql, ...args) => sqlite.prepare(sql).all(...(args.map(norm) as never[])),
    run: (sql, ...args) => ({ changes: Number(sqlite.prepare(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  const db = scopedDb("goals", raw, "0123456789abcdef0123456789abcdef") as Db;
  const state = {
    now: T0, count: o.count ?? 0, failRead: o.failRead as string | undefined,
    tasks: new Map<string, FakeTask>(), folders: new Map<string, { name: string; parent?: string }>([["fld_personal", { name: "Personal" }]]),
    files: [] as Array<{ folderId: string; name: string; text: string }>, shares: [] as Array<{ resource: Obj; subject: Obj; level: string; source: string }>,
    grants: [] as Obj[], posts: [] as Array<{ threadId: string; body: string; blocks?: Obj[]; by: string }>, memory: [] as Obj[], events: [] as Array<{ name: string; payload: Obj; key?: string }>,
    calls: [] as Array<{ cap: string; input: Obj; by: string }>, members: [] as Array<{ threadId: string; id: string }>,
  };
  let seq = 0;
  const next = (p: string): string => `${p}_${(++seq).toString(36).padStart(4, "0")}`;
  const keyed = new Map<string, unknown>();

  const fake: Record<string, (i: Obj, who: Caller) => unknown> = {
    "agents.get": (i) => ({ agent: { agentId: i.agentId, runtime: "inside" } }),
    "settings.get": () => ({ row: { value: "Asia/Karachi" } }),
    "chat.start": (i) => ({ thread: { threadId: `thr_${String(i.scopeId ?? next("x")).replace(/^gol_/, "g")}` } }),
    "chat.post": (i, who) => { state.posts.push({ threadId: i.threadId, body: i.body, blocks: i.blocks, by: who.id }); return { message: { messageId: next("msg") } }; },
    "threads.members.add": (i) => { if (o.failMembers) throw new Error(o.failMembers); state.members.push({ threadId: i.threadId, id: i.personId }); return {}; },
    "threads.add_agent": (i) => { state.members.push({ threadId: i.threadId, id: i.agentId }); return {}; },
    "tasks.create": (i, who) => {
      const t: FakeTask = { id: next("tsk"), kind: i.kind ?? "work", title: i.title, state: i.kind === "approve" ? "awaiting_approval" : "todo", workingNotes: { ...(i.notes ?? {}) }, createdBy: who.id, summary: i.summary, ...(i.parentTaskId ? { parentTaskId: i.parentTaskId } : {}), assigned: i.assigned };
      state.tasks.set(t.id, t); return { task: t };
    },
    "tasks.plan": (i, who) => ({
      children: (i.children as Obj[]).map((c) => {
        const have = [...state.tasks.values()].find((t) => t.parentTaskId === i.parentTaskId && t.workingNotes["plan.key"] === c.key);
        if (have) return { key: c.key, taskId: have.id, shortKey: have.key, created: false };
        const t: FakeTask = { id: next("tsk"), kind: "work", title: c.title, state: "todo", parentTaskId: i.parentTaskId, key: `VY-${100 + seq}`, assigned: c.assigned, workingNotes: { ...(c.notes ?? {}), brief: c.brief, "plan.key": c.key }, createdBy: who.id };
        state.tasks.set(t.id, t);
        return { key: c.key, taskId: t.id, shortKey: t.key, created: true };
      }),
    }),
    "tasks.get": (i) => { const t = state.tasks.get(i.taskId); if (!t) throw new Error("no such task"); return { task: t }; },
    "tasks.index": (i) => ({ rows: [...state.tasks.values()].filter((t) => t.parentTaskId === i.parentTaskId).map((t) => ({ id: t.id, key: t.key, title: t.title, state: t.state, assigned: t.assigned, blocked: false })) }),
    "tasks.withdraw": (i) => { const t = state.tasks.get(i.taskId); if (t) t.state = "canceled"; return { withdrawn: t ? 1 : 0 }; },
    "tasks.transition": (i) => { const t = state.tasks.get(i.taskId); if (t) t.state = i.to; return { task: t }; },
    "tasks.snooze": () => ({}),
    "tasks.update": (i) => { const t = state.tasks.get(i.taskId); if (t && i.title) t.title = i.title; return { task: t }; },
    "files.tree": () => ({ roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_personal", count: 0 }] }),
    "files.list": (i) => ({ files: [], folders: [...state.folders.entries()].filter(([, f]) => f.parent === i.folder).map(([folderId, f]) => ({ folderId, name: f.name })) }),
    "files.folder.create": (i) => { const id = next("fld"); state.folders.set(id, { name: i.name, parent: i.parentId }); return { folder: { folderId: id, name: i.name } }; },
    "files.folder.rename": (i) => { const f = state.folders.get(i.folderId); if (f) f.name = i.name; return { folder: { folderId: i.folderId, name: i.name } }; },
    "files.copy": (i) => { state.files.push({ folderId: i.toFolderId, name: `copy of ${i.fileId}`, text: "" }); return { file: { fileId: next("fil") } }; },
    "chat.message.get": (i) => ({ message: { messageId: i.messageId, attachments: i.messageId === "msg_drop" ? ["fil_brief", "fil_list"] : [], ...(i.messageId === "msg_owner_start" ? { author: { kind: "person", id: OWNER }, createdAt: state.now - 60_000 } : i.messageId === "msg_owner_old" ? { author: { kind: "person", id: OWNER }, createdAt: state.now - 3_600_000 } : i.messageId === "msg_other" ? { author: { kind: "person", id: ALIZA }, createdAt: state.now - 1000 } : {}) } }),
    "files.create": (i) => { state.files.push({ folderId: i.folderId, name: i.name, text: i.content?.text ?? "" }); return { file: { fileId: next("fil") } }; },
    "access.share": (i) => { if (!state.shares.some((s) => s.resource.id === i.resource.id && s.subject.id === i.subject.id && s.source === i.source)) state.shares.push({ resource: i.resource, subject: i.subject, level: i.level, source: i.source }); return { grant: {} }; },
    "access.unshare": (i) => { const before = state.shares.length; state.shares = state.shares.filter((s) => !(s.resource.id === i.resource.id && s.source === i.source)); return { revoked: before - state.shares.length }; },
    "gate.grants.goal": (i) => { state.grants.push(i); return { acts: (i.set ?? []).length, rows: 0 }; },
    "records.counts": () => { if (state.failRead) throw new Error(state.failRead); return { count: state.count }; },
    "memory.remember": (i) => { state.memory.push(i); return {}; },
    "projects.get": () => ({ project: { folderId: "fld_project" } }),
  };

  function ctx(who: Caller): GoalsCtx {
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}), origin: who.origin ?? (who.kind === "service" ? "host" : "app"),
      depth: who.depth ?? 0, trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => state.now, db,
      emit: (name, _subject, payload, opts) => { state.events.push({ name, payload: payload as Obj, ...(opts?.idempotencyKey ? { key: opts.idempotencyKey } : {}) }); return { id: next("evt") }; },
      call: async (cap, input, _opts) => {
        const i = (input ?? {}) as Obj;
        state.calls.push({ cap, input: i, by: who.id });
        const f = fake[cap];
        if (!f) throw new Error(`no fake for ${cap}`);
        // a create with a key answers the first result again, as the kernel does
        const k = typeof i["idempotencyKey"] === "string" ? `${cap}:${i["idempotencyKey"]}` : undefined;
        if (k && keyed.has(k)) return keyed.get(k);
        const out = f(i, { ...who, depth: (who.depth ?? 0) + 1 });
        if (k) keyed.set(k, out);
        return out;
      },
      authorize: (action, resource) => ({ effect: resource.type === "space" && action.perm === "policy.manage" && who.id === "usr_admin" ? "allow" : "deny" }),
    };
  }
  const call = async (cap: string, input: Obj, who: Caller = owner): Promise<any> => (handlers as Record<string, (c: GoalsCtx, i: Obj) => Promise<unknown>>)[cap]!(ctx(who), input);   // eslint-disable-line @typescript-eslint/no-explicit-any
  const ev = (name: string, payload: Obj) => ({ name, payload });
  return {
    state, db, ctx, call,
    sweep: () => sweep(ctx(host)),
    task: (name: string, taskId: string, extra: Obj = {}) => onTask(ctx(host), ev(name, { taskId, ...extra })),
    turn: (name: string, payload: Obj) => onTurn(ctx(host), ev(name, payload)),
    waiting: (payload: Obj) => onWaiting(ctx(host), ev("turn.waiting", payload)),
    mention: (payload: Obj) => onMention(ctx(host), ev("message.mentioned", payload)),
    message: (payload: Obj) => onMessage(ctx(host), ev("message.received", payload)),
    woken: () => state.events.filter((e) => e.name === "goal.woken"),
    named: (name: string) => state.events.filter((e) => e.name === name),
    tick: (ms: number) => { state.now += ms; },
    at: (ms: number) => { state.now = ms; },
  };
}
export type World = ReturnType<typeof world>;

/** "300 registrations for Lab 8", counted from a records type the connection syncs into. */
export function labGoal(over: Obj = {}): Obj {
  return {
    title: "300 registrations for Lab 8", outcome: "A full Lab 8",
    finish: { kind: "number", line: "Luma registrations for Lab 8 reach 300 by Friday", target: 300, unit: "registrations", source: { kind: "records", type: "registration", label: "Luma, Lab 8 registrations" } },
    deadline: T0 + 4 * DAY, leadAgentId: LEAD, helpers: [{ kind: "person", id: ALIZA }, { kind: "agent", id: HELPER }], budget: { spendMicros: 10_000_000, turns: 20 },
    permissions: [{ act: "send", target: "mail.send", label: "Send email from the Lab template" }], idempotencyKey: "k1", ...over,
  };
}
export const step = (key: string, title: string): Obj => ({ key, title, why: `${title} worked for Lab 7`, impact: "+40", assigned: { kind: "agent", id: LEAD } });

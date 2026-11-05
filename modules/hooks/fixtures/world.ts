// A Space's hooks in one process: a real SQLite database behind the host's table guard for hooks_* tables, a clock, and stand-ins for the engine side (the sandbox that runs a command, a small model,
// the pipeline an action goes through) and for the modules the handlers call (threads, agents, the chat's quiet line).
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { handlers, consumers } from "../impl.ts";
import { bindHooks } from "../seams.ts";
import type { CommandResult, HostSeams } from "../seams.ts";
import type { Db, HooksCtx } from "../projections.ts";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
export const T0 = Date.UTC(2026, 10, 4, 5, 0);
export interface Caller { id: string; kind: "person" | "agent" | "service"; admin?: boolean; actingFor?: string }
export const ADMIN = "usr_admin", MAYA = "usr_maya";
export const admin: Caller = { id: ADMIN, kind: "person", admin: true };
export const maya: Caller = { id: MAYA, kind: "person" };
export const agent = (id = "agt_intake", actingFor = MAYA): Caller => ({ id, kind: "agent", actingFor });
export const host: Caller = { id: "svc_host", kind: "service" };
export const ok: CommandResult = { code: 0, stdout: "", stderr: "", timedOut: false };

export function world() {
  const sqlite = new DatabaseSync(":memory:");
  const raw: Db = { all: (sql, ...a) => sqlite.prepare(sql).all(...(a.map((x) => (x === undefined ? null : x)) as never[])), run: (sql, ...a) => ({ changes: Number(sqlite.prepare(sql).run(...(a.map((x) => (x === undefined ? null : x)) as never[])).changes) }) };
  const db = scopedDb("hooks", raw, "0123456789abcdef0123456789abcdef") as Db;
  const s = {
    now: T0, events: [] as Array<{ name: string; payload: Record<string, unknown> }>, lines: [] as Array<Record<string, unknown>>, names: {} as Record<string, string>, ran: [] as string[], actions: [] as Array<{ cap: string; input: unknown }>,
    command: (async () => ok) as (cmd: string, event: Record<string, unknown>) => Promise<CommandResult>,
    check: (async () => ({ decision: "allow" })) as (instruction: string, event: unknown) => Promise<unknown>,
    plugins: [] as Array<{ pluginId: string; plugin: string; event: string; matcher: string; command: string; args: string[] }>,
    pluginRun: (async () => ok) as () => Promise<CommandResult>,
    threadsDenied: new Set<string>(),
    /** the stop lines marked answered (chat.hook_resolve) */
    resolved: [] as Array<Record<string, unknown>>,
    /** helper thread to the chat it works for, as threads.get says it (before any helper-started event was folded in) */
    helperParents: {} as Record<string, string>,
  };
  const seams: Partial<HostSeams> = {
    command: async (_w, h, ev) => { s.ran.push(`command:${h.command}`); return s.command(h.command, ev as Record<string, unknown>); },
    check: async (_w, instruction, ev) => { s.ran.push(`check:${instruction}`); return s.check(instruction, ev) as never; },
    action: async (_w, cap, input) => { s.ran.push(`action:${cap}`); s.actions.push({ cap, input }); return {}; },
    pluginHooks: async () => s.plugins,
    plugin: async (_w, h) => { s.ran.push(`plugin:${h.command}`); return s.pluginRun(); },
  };
  bindHooks(seams);
  const calls: Record<string, (i: Record<string, unknown>) => unknown> = {
    "threads.get": (i) => { if (s.threadsDenied.has(String(i["threadId"]))) throw new Error("no"); const parent = s.helperParents[String(i["threadId"])]; return { thread: { threadId: i["threadId"], ...(parent ? { kind: "helper", parentThreadId: parent } : {}) } }; },
    "agents.get": () => ({ agent: { name: "Assistant" } }),
    // a person's display name, as access.principals.get answers it; an id with no name set here cannot be read
    "access.principals.get": (i) => { const id = String((i["principal"] as { id: string }).id), name = s.names[id]; if (!name) throw new Error("not readable"); return { principal: { id, kind: "person", name } }; },
    "chat.hook_line": (i) => { s.lines.push(i); return { messageId: "msg_1" }; },
    "chat.hook_resolve": (i) => { s.resolved.push(i); return { ok: true }; },
  };
  const ctxFor = (who: Caller): HooksCtx => ({
    space: "spc_test", principal: { kind: who.kind, id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}), trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => s.now, db,
    emit: (name, _subject, payload) => { s.events.push({ name, payload: payload as Record<string, unknown> }); return { id: "evt" }; },
    call: async (cap, input) => { const c = calls[cap]; if (!c) throw new Error(`no ${cap}`); return c(input as Record<string, unknown>); },
    authorize: () => ({ effect: who.admin || who.kind === "service" ? "allow" : "deny" }),
  });
  const call = async (cap: string, input: Record<string, unknown>, who: Caller = admin): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const h = (handlers as unknown as Record<string, (c: HooksCtx, i: never) => unknown>)[cap];
    if (!h) throw new Error(`no handler ${cap}`);
    return await h(ctxFor(who), input as never);
  };
  /** One event, as the engine asks it (as the person). */
  const fire = (f: Record<string, unknown>, who: Caller = maya) => call("hooks.fire", { agentId: "agt_intake", threadId: "thr_a", ...f }, who);
  const helperStarted = (helper: string, parent: string): void => { consumers["hooks.helpers"].run(ctxFor(host), { payload: { helperThreadId: helper, parentThreadId: parent } }); };
  return { s, call, fire, ctxFor, helperStarted, advance(ms: number) { s.now += ms; } };
}

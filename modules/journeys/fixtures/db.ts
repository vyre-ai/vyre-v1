// A real SQLite database (node:sqlite, in memory) behind the same table guard the host uses for ctx.db, plus a ctx that checks what the invoke pipeline checks, and `world`: a small
// stand-in for the modules Journeys call (schema, records, channels, tasks, automations, chat, runs) that keeps what it was asked to do.
import { readFileSync } from "node:fs";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers } from "../impl.ts";
import type { Db, JourneysCtx } from "../projections.ts";
import { NOW } from "./seed.ts";
import type { Caller } from "./seed.ts";

// Boundary B2 keeps the node:sqlite module out of the import lines of modules: only the host builds a ctx and opens databases.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migration = readFileSync(new URL("../migrations/0001_journeys.sql", import.meta.url), "utf8");
export const TRACE = "0123456789abcdef0123456789abcdef";
const IDEM_KEYED = new Set(["journeys.create", "journeys.start"]);

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface Called { cap: string; input: any }   // eslint-disable-line @typescript-eslint/no-explicit-any
type Callee = (input: any, who: { id: string }) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FakeTask { id: string; state: string; input: any }   // eslint-disable-line @typescript-eslint/no-explicit-any

export function harness(over: { now?: number; calls?: Record<string, Callee> } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  const norm = (a: unknown): unknown => (a === undefined ? null : a);
  const raw: Db = {
    all: (sql, ...args) => sqlite.prepare(sql).all(...(args.map(norm) as never[])),
    run: (sql, ...args) => ({ changes: Number(sqlite.prepare(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  let clock = over.now ?? NOW;
  let events: Ev[] = [];
  const all: Ev[] = [];
  const log: Called[] = [];
  const tasks: FakeTask[] = [];
  const runs = new Map<string, { status: string; input: any }>();   // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0;
  const id = (p: string): string => `${p}_t${++n}`;
  const world: Record<string, Callee> = {
    "schema.apply": () => ({ changeId: id("sch"), applied: 1, items: [] }),
    "records.create": () => ({ record: { id: id("rec") } }),
    "records.update": () => ({ record: {} }),
    "channels.create": () => ({ channel: { channelId: id("chn"), mainThreadId: id("thr") } }),
    "chat.post": () => ({}),
    "tasks.create": (i) => { const t: FakeTask = { id: id("tsk"), state: "todo", input: i }; tasks.push(t); return { task: { id: t.id, state: t.state } }; },
    "tasks.get": (i) => ({ task: { id: i.taskId, state: tasks.find((t) => t.id === i.taskId)?.state ?? "todo" } }),
    "tasks.withdraw": (i) => { const t = tasks.find((x) => x.id === i.taskId); if (t) t.state = "canceled"; return { withdrawn: t ? 1 : 0 }; },
    "tasks.working_notes.set": () => ({ ok: true }),
    "automations.create": () => ({ automation: { id: id("aut") } }),
    "automations.update": () => ({ automation: {} }),
    "automations.set_enabled": () => ({ automation: {} }),
    "automations.fire": () => ({ runId: id("run") }),
    "runs.start": (i) => { const r = id("run"); runs.set(r, { status: "running", input: i }); return { runId: r }; },
    "runs.get": (i) => ({ run: { id: i.runId, status: runs.get(i.runId)?.status ?? "running" } }),
    "runs.finish": (i) => { const r = runs.get(i.runId); if (r && r.status === "running") r.status = i.status; return { run: {} }; },
    ...(over.calls ?? {}),
  };
  const emitsOf = (cap: string | null): Set<string> => (cap === null
    ? new Set(registry.events.filter((e) => e.name.startsWith("journey.")).map((e) => e.name))
    : new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []));

  function ctxFor(cap: string | null, who: Caller): JourneysCtx {
    const allowed = emitsOf(cap);
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}),
      trace: { traceId: TRACE }, now: () => clock, db: scopedDb("journeys", raw, TRACE),
      emit(name, subject, payload) {
        if (!allowed.has(name)) throw new Error(`${cap ?? "the scheduler"} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        const ev: Ev = { name, subject, payload: payload as Record<string, unknown>, id: mintId("evt", clock) };
        events.push(ev);
        return { id: ev.id };
      },
      async call(c, input) {
        log.push({ cap: c, input });
        const f = world[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input, who);
      },
      authorize: () => ({ effect: "allow" }),
    };
  }

  let keys = 0;
  async function call(cap: string, raw0: unknown, who: Caller): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const input = IDEM_KEYED.has(cap) && !(raw0 as { idempotencyKey?: unknown }).idempotencyKey ? { ...(raw0 as object), idempotencyKey: `key_${++keys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: JourneysCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, who), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    all.push(...events);
    return result;
  }

  return {
    db: raw, call, ctxFor, tasks, runs, log,
    get events(): Ev[] { return events; },
    allEvents: all,
    callee(cap: string, f: Callee): void { world[cap] = f; },
    setNow(t: number): void { clock = t; },
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
    only(cap: string): Called[] { return log.filter((c) => c.cap === cap); },
    /** a person finishes a task */
    complete(taskId: string): void { const t = tasks.find((x) => x.id === taskId); if (t) t.state = "done"; },
    reset(): void { log.length = 0; },
  };
}
export type Harness = ReturnType<typeof harness>;

export const codeOf = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;
export const reasonOf = (e: unknown): unknown => ((e as { error?: { details?: { reason?: unknown } } } | null)?.error?.details ?? {}).reason;

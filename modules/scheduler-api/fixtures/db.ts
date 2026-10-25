// A real SQLite database (node:sqlite, in memory) behind the same table guard the host uses for ctx.db, plus a ctx that checks what the invoke pipeline checks:
// inputs, outputs and event payloads against the generated validators, and that a capability emits only events it declares. The clock is a fake one; nothing sleeps.
import { readFileSync } from "node:fs";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers } from "../impl.ts";
import type { Db, SchedCtx } from "../projections.ts";
import { NOW } from "./seed.ts";
import type { Caller } from "./seed.ts";

// Boundary B2 keeps the node:sqlite module out of the import lines of modules: only the host builds a ctx and opens databases.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migration = readFileSync(new URL("../migrations/0001_scheduler_api.sql", import.meta.url), "utf8");
export const TRACE = "0123456789abcdef0123456789abcdef";
const IDEM_KEYED = new Set(["scheduler.schedule", "scheduler.waits.register"]);

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface CallLog { cap: string; input: any; opts?: { idempotencyKey?: string } }   // eslint-disable-line @typescript-eslint/no-explicit-any
type Callee = (input: any, who: { id: string }) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface HarnessOptions { now?: number; calls?: Record<string, Callee> }

const norm = (a: unknown): unknown => (a === undefined ? null : a);

export function harness(o: HarnessOptions = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  const raw: Db = {
    all: (sql, ...args) => sqlite.prepare(sql).all(...(args.map(norm) as never[])),
    run: (sql, ...args) => ({ changes: Number(sqlite.prepare(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  let clock = o.now ?? NOW;
  let events: Ev[] = [];
  const all: Ev[] = [];
  const calls: CallLog[] = [];
  const calleeMap: Record<string, Callee> = { ...(o.calls ?? {}) };
  const emitsOf = (cap: string | null): Set<string> => (cap === null
    ? new Set(registry.events.filter((e) => e.name.startsWith("schedule.") || e.name.startsWith("wait.")).map((e) => e.name))
    : new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []));

  function ctxFor(cap: string | null, who: Caller, run?: string): SchedCtx {
    const allowed = emitsOf(cap);
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}), ...(run ? { run } : {}),
      trace: { traceId: TRACE }, now: () => clock, db: scopedDb("scheduler-api", raw, TRACE),
      emit(name, subject, payload) {
        if (!allowed.has(name)) throw new Error(`${cap ?? "the consumer"} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        const ev: Ev = { name, subject, payload: payload as Record<string, unknown>, id: mintId("evt", clock) };
        events.push(ev);
        return { id: ev.id };
      },
      async call(c, input, opts) {
        calls.push({ cap: c, input, ...(opts ? { opts } : {}) });
        const f = calleeMap[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input, who);
      },
    };
  }

  let keys = 0;
  async function call(cap: string, raw0: unknown, who: Caller, run?: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const input = IDEM_KEYED.has(cap) && !(raw0 as { idempotencyKey?: unknown }).idempotencyKey ? { ...(raw0 as object), idempotencyKey: `key_${++keys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: SchedCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, who, run), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    all.push(...events);
    return result;
  }

  /** Run consumer code (the tick) with a ctx that may emit every schedule.* and wait.* event. */
  async function consumer<T>(who: Caller, f: (ctx: SchedCtx) => Promise<T>): Promise<T> {
    events = [];
    const r = await f(ctxFor(null, who));
    all.push(...events);
    return r;
  }

  return {
    db: raw, call, ctxFor, consumer,
    get events(): Ev[] { return events; },
    allEvents: all, calls,
    callee(cap: string, f: Callee): void { calleeMap[cap] = f; },
    setNow(n: number): void { clock = n; },
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
    policy(key: string, value: unknown): void { raw.run("INSERT OR REPLACE INTO scheduler_api_policy (policy_key, policy_value) VALUES (?, ?)", key, JSON.stringify(value)); },
  };
}
export type Harness = ReturnType<typeof harness>;

export function codeOf(e: unknown): string | undefined { return (e as { error?: { code?: string } } | null)?.error?.code; }
export function reasonOf(e: unknown): unknown { return ((e as { error?: { details?: { reason?: unknown } } } | null)?.error?.details ?? {}).reason; }

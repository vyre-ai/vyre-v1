// A real SQLite database (node:sqlite, in memory) behind the same table guard the host uses for ctx.db, plus a ctx that checks what the invoke pipeline checks:
// inputs, outputs and event payloads against the generated validators, and that a capability emits only events it declares.
import { readFileSync } from "node:fs";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers } from "../impl.ts";
import type { Db, RunsCtx } from "../projections.ts";
import { NOW } from "./seed.ts";
import type { Caller } from "./seed.ts";

// Boundary B2 keeps the node:sqlite module out of the import lines of modules: only the host builds a ctx and opens databases. A test still needs a real SQL engine behind the host's table guard,
// so the fixture asks the runtime for the built-in.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const schema = readFileSync(new URL("../../../generated/modules/runs/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0001_runs_engine.sql", import.meta.url), "utf8");
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; opts?: Record<string, unknown> | undefined; id: string; traceId: string }
export interface CallLog { cap: string; input: unknown }
type Authorize = (who: { id: string }, action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => boolean;
type Callee = (input: any, who: { id: string }) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface HarnessOptions {
  now?: number;
  /** the kernel's answer for manage and view on runs held through a role or grant; the default denies */
  authorize?: Authorize;
  /** capabilities a handler may call, by name */
  calls?: Record<string, Callee>;
}

const norm = (a: unknown): unknown => (a === undefined ? null : a);

export function harness(o: HarnessOptions = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
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
  const authorize: Authorize = o.authorize ?? (() => false);
  const emitsOf = (cap: string | null): Set<string> => (cap === null
    ? new Set(registry.events.filter((e) => e.name.startsWith("run.")).map((e) => e.name))
    : new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []));

  /** cap null is the engine itself (drive, wake, sweeps): it may emit every run.* event. */
  function ctxFor(cap: string | null, who: Caller): RunsCtx {
    const allowed = emitsOf(cap);
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}),
      trace: { traceId: TRACE }, ...(who.device ? { device: who.device } : {}),
      now: () => clock,
      db: scopedDb("runs", raw, TRACE),
      emit(name, subject, payload, opts) {
        if (!allowed.has(name)) throw new Error(`${cap ?? "the engine"} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        const ev: Ev = { name, subject, payload: payload as Record<string, unknown>, opts: opts as Record<string, unknown> | undefined, id: mintId("evt", clock), traceId: TRACE };
        events.push(ev);
        return { id: ev.id };
      },
      async call(c, input) {
        calls.push({ cap: c, input });
        const f = calleeMap[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input, who);
      },
      authorize: (action, resource) => ({ effect: authorize(who, action, resource) ? "allow" : "deny" }),
    };
  }

  /** Call a capability the way the pipeline does: validate the input, run the handler, validate the output. */
  let keys = 0;
  async function call(cap: string, raw0: unknown, who: Caller): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const input = cap === "runs.start" && !(raw0 as { idempotencyKey?: unknown }).idempotencyKey ? { ...(raw0 as object), idempotencyKey: `key_${++keys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: RunsCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, who), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    all.push(...events);
    return result;
  }

  /** Run engine code (drive, wake, sweepWaits) with a ctx and keep its events. */
  async function engineRun<T>(who: Caller, f: (ctx: RunsCtx) => Promise<T>): Promise<T> {
    events = [];
    const r = await f(ctxFor(null, who));
    all.push(...events);
    return r;
  }

  return {
    sqlite, db: raw, call, ctxFor, engineRun,
    get events(): Ev[] { return events; },
    allEvents: all, calls,
    callee(cap: string, f: Callee): void { calleeMap[cap] = f; },
    setNow(n: number): void { clock = n; },
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
  };
}
export type Harness = ReturnType<typeof harness>;

/** The error code of a thrown HostError. */
export function codeOf(e: unknown): string | undefined {
  return (e as { error?: { code?: string } } | null)?.error?.code;
}
export function reasonOf(e: unknown): unknown {
  return ((e as { error?: { details?: { reason?: unknown } } } | null)?.error?.details ?? {}).reason;
}

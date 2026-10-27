// A real SQLite database (node:sqlite, in memory) behind the same table guard the host uses for ctx.db, plus a ctx that checks what the invoke pipeline checks:
// inputs, outputs and event payloads against the generated validators, and that a capability emits only events it declares. `runs` is a small stand-in for the runs module.
import { readdirSync, readFileSync } from "node:fs";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers } from "../impl.ts";
import type { AutoCtx, Db } from "../projections.ts";
import { NOW } from "./seed.ts";
import type { Caller } from "./seed.ts";

// Boundary B2 keeps the node:sqlite module out of the import lines of modules: only the host builds a ctx and opens databases.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migrationDir = new URL("../migrations/", import.meta.url);
const migration = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(new URL(f, migrationDir), "utf8")).join("\n");
export const TRACE = "0123456789abcdef0123456789abcdef";
const IDEM_KEYED = new Set(["automations.create", "automations.make_personal_copy", "automations.run", "automations.fire", "automations.groups.create"]);

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface CallLog { cap: string; input: any }   // eslint-disable-line @typescript-eslint/no-explicit-any
type Authorize = (who: { id: string }, action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => boolean;
type Callee = (input: any, who: { id: string }) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface HarnessOptions {
  now?: number;
  /** the kernel's answer for view/manage on automations held through a role or grant; the default denies */
  authorize?: Authorize;
  calls?: Record<string, Callee>;
}

export interface FakeRun { id: string; kind: string; status: string; owner: string; subject?: { type: string; id: string }; definitionVersion?: number; parentRun?: string; startedAt: number }

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
  const runs: FakeRun[] = [];
  const byKey = new Map<string, string>();
  const calleeMap: Record<string, Callee> = { ...(o.calls ?? {}) };
  const authorize: Authorize = o.authorize ?? (() => false);
  const emitsOf = (cap: string | null): Set<string> => (cap === null
    ? new Set(registry.events.filter((e) => e.name.startsWith("automation.")).map((e) => e.name))
    : new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []));

  // the part of the runs module Automations use: start (idempotent by key), list by subject, stop, retry
  const fakeRuns: Record<string, Callee> = {
    "runs.start": (i) => {
      const have = byKey.get(i.idempotencyKey);
      if (have) return { runId: have };
      const id = `run_t${runs.length + 1}`;
      runs.push({ id, kind: i.kind, status: "queued", owner: i.owner, subject: i.subject, definitionVersion: i.definitionVersion, parentRun: i.parentRun, startedAt: clock });
      byKey.set(i.idempotencyKey, id);
      return { runId: id };
    },
    "runs.list": (i) => {
      const rows = runs.filter((r) => (!i.subject || (r.subject?.type === i.subject.type && r.subject.id === i.subject.id)) && (!i.statuses || i.statuses.includes(r.status)));
      return { runs: rows.slice().reverse().slice(0, i.limit ?? 50), total: rows.length };
    },
    "runs.stop": (i) => { const r = runs.find((x) => x.id === i.runId); if (r) r.status = "stopped"; return { run: r }; },
    "runs.retry": (i) => {
      const old = runs.find((x) => x.id === i.runId)!;
      const id = `run_t${runs.length + 1}`;
      runs.push({ ...old, id, status: "queued", parentRun: old.id, startedAt: clock });
      return { runId: id };
    },
  };

  function ctxFor(cap: string | null, who: Caller): AutoCtx {
    const allowed = emitsOf(cap);
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}),
      trace: { traceId: TRACE }, now: () => clock, db: scopedDb("automations", raw, TRACE), baseUrl: "https://acme.example.com",
      emit(name, subject, payload) {
        if (!allowed.has(name)) throw new Error(`${cap ?? "the consumer"} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        const ev: Ev = { name, subject, payload: payload as Record<string, unknown>, id: mintId("evt", clock) };
        events.push(ev);
        return { id: ev.id };
      },
      async call(c, input) {
        calls.push({ cap: c, input });
        const f = calleeMap[c] ?? fakeRuns[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input, who);
      },
      authorize: (action, resource) => ({ effect: authorize(who, action, resource) ? "allow" : "deny" }),
    };
  }

  let keys = 0;
  async function call(cap: string, raw0: unknown, who: Caller): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const input = IDEM_KEYED.has(cap) && !(raw0 as { idempotencyKey?: unknown }).idempotencyKey ? { ...(raw0 as object), idempotencyKey: `key_${++keys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: AutoCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, who), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    all.push(...events);
    return result;
  }

  /** Run consumer code (consumeEvent) with a ctx that may emit every automation.* event. */
  async function consumer<T>(who: Caller, f: (ctx: AutoCtx) => Promise<T>): Promise<T> {
    events = [];
    const r = await f(ctxFor(null, who));
    all.push(...events);
    return r;
  }

  return {
    db: raw, call, ctxFor, consumer, runs,
    get events(): Ev[] { return events; },
    allEvents: all, calls,
    callee(cap: string, f: Callee): void { calleeMap[cap] = f; },
    setNow(n: number): void { clock = n; },
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
    policy(key: string, value: unknown): void { raw.run("INSERT OR REPLACE INTO automations_policy (policy_key, policy_value) VALUES (?, ?)", key, JSON.stringify(value)); },
  };
}
export type Harness = ReturnType<typeof harness>;

export function codeOf(e: unknown): string | undefined {
  return (e as { error?: { code?: string } } | null)?.error?.code;
}
export function reasonOf(e: unknown): unknown {
  return ((e as { error?: { details?: { reason?: unknown } } } | null)?.error?.details ?? {}).reason;
}

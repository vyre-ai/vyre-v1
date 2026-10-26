// A real SQLite database (in memory) behind the same table guard the host uses for ctx.db, plus a ctx that checks what the invoke pipeline checks: inputs, outputs and event payloads
// against the generated validators, and that a capability emits only events it declares. The neighbours the Gate calls (tasks, runs, scheduler, access, notifications) are fakes that
// record every call.
import { readFileSync } from "node:fs";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { mintId } from "../../../lib/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers } from "../impl.ts";
import type { CallOpts, Db, GateCtx } from "../projections.ts";
import { NOW } from "./seed.ts";
import type { Caller } from "./seed.ts";

// Boundary B2 keeps the node:sqlite module out of the import lines of modules: only the host builds a ctx and opens databases. A test still needs a real SQL engine behind the host's
// table guard, so the fixture asks the runtime for the built-in. Swap this for the testkit's in-memory database when it exports one.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const migration = readFileSync(new URL("../migrations/0001_gate_holds.sql", import.meta.url), "utf8");
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface CallLog { cap: string; input: any; opts?: CallOpts | undefined }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface ScheduleLog { id: string; at: number | string; cap: string; input: any }   // eslint-disable-line @typescript-eslint/no-explicit-any
type Callee = (input: any, who: Caller, opts?: CallOpts) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface HarnessOptions {
  now?: number;
  authorize?: (who: { id: string }, action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => boolean;
  /** make ctx.schedule fail, as it does while the host has no scheduler */
  noScheduler?: boolean;
}

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
  const calls: CallLog[] = [];
  const schedules: ScheduleLog[] = [];
  const callees: Record<string, Callee> = {};
  let taskSeq = 0, schSeq = 0, keys = 0;
  const emitsOf = (cap: string): Set<string> => new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []);

  function ctxFor(cap: string | null, who: Caller): GateCtx {
    const allowed = cap ? emitsOf(cap) : null;
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}), trace: { traceId: TRACE }, depth: who.depth ?? (cap === "gate.park" ? 0 : 1), ...((who.origin ?? (cap === "gate.park" ? "gate" : undefined)) ? { origin: who.origin ?? "gate" } : {}),
      ...(who.device ? { device: who.device } : {}), ...(who.run ? { run: who.run } : {}),
      now: () => clock,
      db: scopedDb("gate", raw, TRACE),
      emit(name, subject, payload) {
        if (allowed && !allowed.has(name)) throw new Error(`${cap} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        const ev: Ev = { name, subject, payload: payload as Record<string, unknown>, id: mintId("evt", clock) };
        events.push(ev);
        return { id: ev.id };
      },
      async call(c, input, opts) {
        calls.push({ cap: c, input, opts });
        const f = callees[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input, who, opts);
      },
      authorize: (action, resource) => ({ effect: (o.authorize ?? (() => false))(who, action, resource) ? "allow" : "deny" }),
      schedule: async (at, c, input) => {
        if (o.noScheduler) throw new Error("no scheduler");
        const id = `sch_${++schSeq}`;
        schedules.push({ id, at, cap: c, input });
        return id;
      },
      seal: {
        seal: (v, scope) => ({ keyId: "k1", nonce: "n1", bytes: `${Buffer.from(`${scope}\n`).toString("base64")}.${Buffer.from(v).toString("base64")}` }),
        unseal: (s) => {
          const [scope, body] = s.bytes.split(".");
          if (!scope || !body || Buffer.from(scope, "base64").toString() !== "tasks.approval\n") throw new Error("bad seal");
          return new Uint8Array(Buffer.from(body, "base64"));
        },
      },
      log: { warn: () => undefined },
    };
  }

  async function call(cap: string, raw0: unknown, who: Caller): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const input = cap === "gate.park" && !(raw0 as { idempotencyKey?: unknown }).idempotencyKey ? { ...(raw0 as object), idempotencyKey: `key_${++keys}` } : raw0;
    const bad = validateInput(cap, 1, input);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: GateCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, who), input);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    return result;
  }

  // the neighbours, with the answers the real modules give
  callees["tasks.create"] = () => ({ task: { id: `tsk_g${++taskSeq}` } });
  callees["tasks.working_notes.set"] = () => ({ task: {} });
  callees["tasks.withdraw"] = () => ({ withdrawn: 1 });
  callees["tasks.escalate"] = () => ({ task: { approver: { kind: "person", id: "usr_delegate" } } });
  callees["tasks.assign"] = (input: { to: unknown }) => ({ task: { approver: input.to } });
  callees["runs.mark_waiting"] = () => ({ run: {} });
  callees["runs.resume"] = () => ({ run: {} });
  callees["scheduler.cancel"] = () => ({ canceled: true });
  callees["access.principals.get"] = () => ({ principal: { owner: "usr_alice" } });

  return {
    sqlite, db: raw, call, ctxFor,
    get events(): Ev[] { return events; },
    calls, schedules,
    callee(cap: string, f: Callee): void { callees[cap] = f; },
    callsTo: (cap: string): CallLog[] => calls.filter((c) => c.cap === cap),
    setNow(n: number): void { clock = n; },
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
    policy(key: string, value: unknown): void { raw.run("INSERT OR REPLACE INTO gate_policy (policy_key, policy_value) VALUES (?, ?)", key, JSON.stringify(value)); },
    sealToken(claims: Record<string, unknown>): string {
      const sealed = ctxFor(null, { id: "svc_x", kind: "service" }).seal!.seal(new TextEncoder().encode(JSON.stringify({ v: 1, ...claims })), "tasks.approval");
      return `apv_${btoa(JSON.stringify(sealed)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
    },
  };
}
export type Harness = ReturnType<typeof harness>;

export function codeOf(e: unknown): string | undefined { return (e as { error?: { code?: string } } | null)?.error?.code; }
export function reasonOf(e: unknown): unknown { return ((e as { error?: { details?: { reason?: unknown } } } | null)?.error?.details ?? {}).reason; }
export { NOW };

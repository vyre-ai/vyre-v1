// A real SQLite database (in memory) behind the same table guard the host uses for ctx.db, plus a ctx that checks what the invoke pipeline checks: inputs, outputs and event payloads
// against the generated validators, and that a capability emits only events it declares. The neighbours (tasks.get, access.check) are fakes that record every call; the push
// transport is a fake port that records every push it was asked to send.
import { readFileSync } from "node:fs";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { makeId } from "../../../packages/contracts/src/ids.ts";
import { registry } from "../../../generated/registry.ts";
import { validateEvent, validateInput, validateOutput } from "../../../generated/validators.ts";
import { handlers, setPushPort } from "../impl.ts";
import type { PushMessage, PushPort } from "../impl.ts";
import type { Db, NotifCtx } from "../projections.ts";
import { NOW } from "./seed.ts";
import type { Caller } from "./seed.ts";

// Boundary B2 keeps the node:sqlite module out of the import lines of modules: only the host builds a ctx and opens databases. A test still needs a real SQL engine behind the host's table
// guard, so the fixture asks the runtime for the built-in. Swap this for the testkit's in-memory database when it exports one.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const schema = readFileSync(new URL("../../../generated/modules/notifications/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0001_notifications_state.sql", import.meta.url), "utf8");
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Ev { name: string; subject: string; payload: Record<string, unknown>; id: string }
export interface CallLog { cap: string; input: any }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface ScheduleLog { id: string; at: number | string; cap: string; input: any }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Emailed { to: string; subject: string; deepLink: string }
type Callee = (input: any, who: Caller) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface HarnessOptions {
  now?: number;
  /** milliseconds since the person last used a computer; undefined: no computer session is open */
  computerIdleMs?: number | undefined;
  /** the host has no push transport at all */
  noPort?: boolean;
  noScheduler?: boolean;
  noSeal?: boolean;
  /** what the transport answers for a send */
  sendResult?: "ok" | "gone" | "throw";
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
  const calls: CallLog[] = [];
  const schedules: ScheduleLog[] = [];
  const pushes: PushMessage[] = [];
  const emails: Emailed[] = [];
  const callees: Record<string, Callee> = {};
  const state = { idleMs: o.computerIdleMs, sendResult: o.sendResult ?? "ok" };
  let schSeq = 0;
  const emitsOf = (cap: string): Set<string> => new Set(registry.capabilities.find((c) => c.name === cap)?.emits ?? []);

  const port: PushPort = {
    async send(msg) { if (state.sendResult === "throw") throw new Error("apns down"); pushes.push(msg); return state.sendResult === "gone" ? "gone" : "ok"; },
    async computerIdleMs() { return state.idleMs; },
    spaceName: () => "Northwind",
    async email(m) { emails.push(m); },
  };
  setPushPort(o.noPort ? null : port);

  function ctxFor(cap: string | null, who: Caller): NotifCtx {
    const allowed = cap ? emitsOf(cap) : null;
    return {
      space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, ...(who.actingFor ? { actingFor: who.actingFor } : {}), trace: { traceId: TRACE },
      ...(who.device ? { device: who.device } : {}), ...(who.run ? { run: who.run } : {}),
      now: () => clock,
      db: scopedDb("notifications", raw, TRACE),
      emit(name, subject, payload) {
        if (allowed && !allowed.has(name)) throw new Error(`${cap} emitted ${name}, which it does not declare`);
        const bad = validateEvent(name, payload);
        if (bad.length) throw new Error(`${name} payload is invalid: ${bad.join("; ")}`);
        const ev: Ev = { name, subject, payload: payload as Record<string, unknown>, id: makeId("evt", globalThis.crypto.getRandomValues(new Uint8Array(14))) };
        events.push(ev);
        return { id: ev.id };
      },
      async call(c, input) {
        calls.push({ cap: c, input });
        const f = callees[c];
        if (!f) throw new Error(`unexpected call to ${c}`);
        return f(input, who);
      },
      ...(o.noScheduler ? {} : { schedule: async (at: number | string, c: string, input: unknown) => { const id = `sch_${++schSeq}`; schedules.push({ id, at, cap: c, input }); return id; } }),
      ...(o.noSeal ? {} : {
        seal: {
          seal: (v: Uint8Array, scope: string) => ({ keyId: "k1", nonce: "n1", bytes: `${Buffer.from(`${scope}\n`).toString("base64")}.${Buffer.from(v).toString("base64")}` }),
          unseal: (s: { keyId: string; nonce: string; bytes: string }) => new Uint8Array(Buffer.from(s.bytes.split(".")[1]!, "base64")),
        },
      }),
      log: { warn: () => undefined },
    };
  }

  async function call(cap: string, raw0: unknown, who: Caller): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const bad = validateInput(cap, 1, raw0);
    if (bad.length) throw new Error(`${cap} input is invalid: ${bad.join("; ")}`);
    const h = (handlers as Record<string, (ctx: NotifCtx, input: unknown) => Promise<unknown>>)[cap];
    if (!h) throw new Error(`no handler for ${cap}`);
    events = [];
    const result = await h(ctxFor(cap, who), raw0);
    const badOut = validateOutput(cap, 1, result);
    if (badOut.length) throw new Error(`${cap} output is invalid: ${badOut.join("; ")}`);
    return result;
  }

  // the neighbours, with the answers the real modules give
  callees["tasks.get"] = () => ({ task: { state: "awaiting_approval" } });
  callees["access.check"] = () => ({ decision: { effect: "deny" } });

  return {
    sqlite, db: raw, call, ctxFor,
    get events(): Ev[] { return events; },
    calls, schedules, pushes, emails,
    callee(cap: string, f: Callee): void { callees[cap] = f; },
    callsTo: (cap: string): CallLog[] => calls.filter((c) => c.cap === cap),
    setNow(n: number): void { clock = n; },
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
    idle(ms: number | undefined): void { state.idleMs = ms; },
    sendResult(r: "ok" | "gone" | "throw"): void { state.sendResult = r; },
    close(): void { setPushPort(null); },
  };
}
export type Harness = ReturnType<typeof harness>;

export function codeOf(e: unknown): string | undefined { return (e as { error?: { code?: string } } | null)?.error?.code; }
export function reasonOf(e: unknown): unknown { return ((e as { error?: { details?: { reason?: unknown } } } | null)?.error?.details ?? {}).reason; }
export { NOW };

// Test world for reports-client: a handler ctx over the in-memory SQL engine (behind the host's table guard), bundle sources with sensitive values,
// a recording reports.vyre.run client, stand-ins for tasks and settings, and a replay copy that remembers what it was asked to do.

import { scopedDb } from "../../../host/src/ctx/db.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { FakeReportsDb, NOW, SPACE, TRACE } from "./db.ts";
import { send_to_vyre } from "../handlers/submit.ts";
import type { Bundle, ReportContext, ReportEvent, ReportsCtx, ReportsDrivers } from "../handlers/submit.ts";
import type { OutwardCall, ReplayCopy, ReplayDrivers, ReplayOutcome, ReplayTarget, ReplayValue } from "../handlers/replay.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

export { NOW, SPACE, TRACE };

export const trace = (n: number): string => n.toString(16).padStart(32, "0");
export const ALL_PERMS = ["policy.manage", "server.logs", "console.access", "records.reveal"];

export interface Posted { reportId: string; space: string; reporter: string; title: string; bundle: Bundle }

export interface World {
  raw: FakeReportsDb;
  ctx: ReportsCtx;
  drivers: ReportsDrivers;
  /** sensitive values the sources report for any context */
  sensitive: string[];
  recent: { traceIds: string[]; events: ReportEvent[] };
  posted: Posted[];
  /** make the service fail: a code for an error with that code, "down" for a plain failure */
  serviceFails: string | null;
  keyRegistered: boolean;
  tasks: unknown[];
  settings: Map<string, unknown>;
  events: { name: string; subject: string; payload: unknown }[];
  /** the events capabilities called through ctx.call emitted (the pipeline keeps them apart from the caller's own); also in `events` */
  nested: { name: string; subject: string; payload: unknown }[];
  calls: { cap: string; input: unknown }[];
  /** the permissions the caller holds */
  perms: Set<string>;
  nextIssue: number;
  setNow(n: number): void;
  asPerson(id: string, perms?: string[]): void;
}

export function world(o: { policy?: string; name?: string } = {}): World {
  const raw = new FakeReportsDb();
  const w = {
    raw, sensitive: [] as string[], recent: { traceIds: [trace(1), trace(2), trace(3)], events: [{ type: "sync.pull", at: NOW - 5000, traceId: trace(3) }, { type: "error.provider", at: NOW - 1000 }] as ReportEvent[] },
    posted: [] as Posted[], serviceFails: null as string | null, keyRegistered: true, tasks: [] as unknown[], settings: new Map<string, unknown>(), events: [] as World["events"], nested: [] as World["events"], calls: [] as World["calls"],
    perms: new Set<string>(ALL_PERMS), nextIssue: 1234,
  };
  if (o.policy) w.settings.set("reports.vyre", o.policy);
  let clock = NOW;
  let principal = "usr_omar";
  const drivers: ReportsDrivers = {
    sources: {
      async recent() { return { traceIds: w.recent.traceIds, events: w.recent.events, versions: { app: "1.2.0", server: "1.2.1", device: "mac-14" } }; },
      async sensitiveValues(_ctx: ReportsCtx, _c: ReportContext) { return w.sensitive; },
      async reporterName() { return o.name ?? "Omar"; },
    },
    service: {
      async post(req) {
        if (w.serviceFails === "down") throw new Error("connect ECONNREFUSED");
        if (w.serviceFails) throw Object.assign(new Error("slow down"), { code: w.serviceFails });
        w.posted.push(req);
        return { issueNumber: w.nextIssue++, stored: true };
      },
      async ping() { if (w.serviceFails === "down") throw new Error("connect ECONNREFUSED"); return { keyRegistered: w.keyRegistered }; },
    },
  };
  const ctx = {
    space: SPACE,
    get principal() { return { kind: "person" as const, id: principal }; },
    trace: { traceId: TRACE, spanId: "abcdef0123456789" },
    now: () => clock,
    db: scopedDb("reports", raw, TRACE),
    emit: ((name: string, subject: string, payload: unknown) => { w.events.push({ name, subject, payload }); return {} as never; }) as unknown as Ctx["emit"],
    authorize: ((action: { perm: string | null }) => ({ effect: action.perm !== null && w.perms.has(action.perm) ? "allow" : "deny", reason: "test", decisionId: "dec_1" })) as unknown as Ctx["authorize"],
    call: null as unknown as Ctx["call"],
  } as unknown as ReportsCtx;
  // capabilities the handlers call: tasks, settings, and the module's own send (routed to the handler as the pipeline would)
  (ctx as { call: unknown }).call = async (cap: string, input: unknown) => {
    assertStrictInput(cap, input);
    w.calls.push({ cap, input });
    if (cap === "tasks.create") { w.tasks.push(input); return { task: { id: `tsk_${w.tasks.length}` } }; }
    if (cap === "settings.get") {
      const key = String((input as { key: string }).key);
      if (!w.settings.has(key)) throw fail("internal.not_implemented", TRACE, { details: { cap } });
      return { row: { key, value: w.settings.get(key) } };
    }
    if (cap === "settings.set") { const i = input as { key: string; value: unknown }; w.settings.set(i.key, i.value); return { row: { key: i.key, value: i.value }, previous: null }; }
    if (cap === "reports.send_to_vyre") {
      const child = { ...ctx, emit: ((name: string, subject: string, payload: unknown) => { const e = { name, subject, payload }; w.events.push(e); w.nested.push(e); return {} as never; }) as unknown as Ctx["emit"] } as ReportsCtx;
      return send_to_vyre(child, input as { reportId: string });
    }
    throw fail("internal.not_implemented", TRACE, { details: { cap } });
  };
  return Object.assign(w, {
    ctx, drivers,
    setNow(n: number) { clock = n; },
    asPerson(id: string, perms: string[] = []) { principal = id; w.perms = new Set(perms); },
  });
}

// ---- the replay copy

export interface FakeCopy extends ReplayCopy {
  /** the values in the copy now, by ref */
  state: Map<string, string>;
  disposed: boolean;
  reruns: ReplayTarget[];
  /** make the re-run throw */
  rerunFails: string | null;
}

export interface ReplayWorld {
  drivers: ReplayDrivers;
  copies: FakeCopy[];
  restored: number[];
  /** what the copy would send if nothing stopped it: real transport calls (must stay empty) */
  leaked: unknown[];
  values: ReplayValue[];
}

export function replayWorld(): ReplayWorld {
  const rw: ReplayWorld = {
    copies: [], restored: [], leaked: [],
    values: [
      { ref: "rows/contact/1/ssn", kind: "sealed", value: "123-45-6789" },
      { ref: "rows/contact/1/email", kind: "restricted", value: "ada@clientco.example" },
      { ref: "rows/deal/3/amount", kind: "restricted", value: "1,200,000 USD" },
    ],
    drivers: {
      async restoreCopy(seq: number) {
        rw.restored.push(seq);
        const state = new Map(rw.values.map((v) => [v.ref, v.value] as const));
        const copy: FakeCopy = {
          dir: `/tmp/vyre-replay-${seq}`, state, disposed: false, reruns: [], rerunFails: null,
          async values() { return rw.values.map((v) => ({ ...v, value: state.get(v.ref) ?? v.value })); },
          async replace(ref, value) { state.set(ref, value); },
          async rerun(target, outward): Promise<ReplayOutcome> {
            copy.reruns.push(target);
            if (copy.rerunFails) throw new Error(copy.rerunFails);
            // the failed Run: it mails the client and texts the owner, using the values that are in the copy right now
            const call = (c: OutwardCall): unknown => outward(c);
            call({ cap: "mail.send", input: { to: state.get("rows/contact/1/email"), subject: "Your order", body: `Reference ${state.get("rows/contact/1/ssn")} for ${state.get("rows/deal/3/amount")}` } });
            call({ cap: "telephony.sms", input: { to: "+15551230000", body: `Deal ${state.get("rows/deal/3/amount")}` } });
            return { result: "failed", failedAt: "step_3" };
          },
          async dispose() { copy.disposed = true; },
        };
        rw.copies.push(copy);
        return copy;
      },
    },
  };
  return rw;
}

// A hand-built Ctx over MemoryDb, with a scripted Records, Schema and Mail behind ctx.call.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { configureEmailBuilder } from "../handlers/compile.ts";
import { MemoryDb } from "./db.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Emitted { name: string; subject: string; payload: unknown }

export function harness(o: { principal?: string; now?: number } = {}) {
  const db = new MemoryDb();
  configureEmailBuilder({ ask: null });
  const events: Emitted[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  let clock = o.now ?? NOW;
  const scripts = {
    mailboxes: [{ id: "mbx_mine", address: "alex@example.com" }] as { id: string; address: string }[],
    records: {} as Record<string, Record<string, unknown>>,
    types: {} as Record<string, { key: string; title: string }[]>,
    sendStatus: "sent",
  };
  const ctx: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: o.principal ?? "usr_alex" },
    trace: { traceId: TRACE, spanId: "0123456789abcdef" },
    origin: "ui",
    depth: 0,
    now: () => clock,
    db,
    emit<T>(name: EventName, subject: string, payload: T): EventEnvelope<T> {
      events.push({ name, subject, payload });
      return {} as EventEnvelope<T>;
    },
    async call(cap, input) {
      assertStrictInput(cap, input);
      calls.push({ cap, input });
      if (cap === "mail.mailbox.list") return { mailboxes: scripts.mailboxes };
      if (cap === "mail.send") return { status: scripts.sendStatus };
      if (cap === "records.get") {
        const fields = scripts.records[(input as { recordId: string }).recordId];
        if (!fields) throw new Error("no such record");
        return { record: { id: (input as { recordId: string }).recordId, fields } };
      }
      if (cap === "schema.types.get") {
        const fields = scripts.types[(input as { type: string }).type];
        if (!fields) throw new Error("no such type");
        return { type: { key: (input as { type: string }).type, fields } };
      }
      throw new Error(`unscripted call ${cap}`);
    },
    authorize: () => ({ effect: "allow", reason: "granted", decisionId: "dec_1" }),
    vault: { async fill() {}, use: (handle) => ({ handle }) },
    http: async () => ({ status: 200, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_1",
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
  };
  return {
    ctx, db, events, calls, scripts,
    advance(ms: number) { clock += ms; },
    names(): string[] { return events.map((e) => e.name); },
    as(principal: string): Ctx { return { ...ctx, principal: { kind: "person", id: principal } }; },
  };
}

export type World = ReturnType<typeof harness>;

// A hand-built Ctx over MemoryDb, with a scripted Records, Schema and Mail behind ctx.call.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName } from "../../../packages/contracts/src/types.ts";
import { configureEmailBuilder } from "../handlers/compile.ts";
import { MemoryDb } from "./db.ts";

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
    /** the type of a record that is not a "contact" */
    recordTypes: {} as Record<string, string>,
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
      calls.push({ cap, input });
      if (cap === "mail.mailbox.list") return { mailboxes: scripts.mailboxes };
      if (cap === "mail.send") return { status: scripts.sendStatus };
      // the contracts of the real capabilities: records.get reads a record by type AND id (an id alone is refused), and schema.types.list names the types there are
      if (cap === "schema.types.list") return { types: [...new Set(Object.keys(scripts.records).map((id) => scripts.recordTypes[id] ?? "contact"))].map((key) => ({ key })) };
      if (cap === "records.get") {
        const { type, recordId } = input as { type?: unknown; recordId?: unknown };
        if (typeof type !== "string" || typeof recordId !== "string") throw Object.assign(new Error("/type: required"), { error: { code: "validation.bad_input" } });
        const fields = scripts.records[recordId];
        if (!fields || (scripts.recordTypes[recordId] ?? "contact") !== type) throw Object.assign(new Error("no such record"), { error: { code: "validation.not_found" } });
        return { record: { id: recordId, type, fields } };
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

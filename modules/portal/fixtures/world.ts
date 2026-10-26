// A hand-built Ctx over MemoryDb, a scripted sites/records surface and a fake mailer that records every link it is asked to send.

import type { Ctx, Decision, ResourceRef } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName, Level } from "../../../packages/contracts/src/types.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { configurePortal } from "../handlers/accounts.ts";
import type { LinkMessage, PortalMailer } from "../handlers/accounts.ts";
import { MemoryDb } from "./db.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SITE = "sit_aaaa1111";
export const OTHER_SITE = "sit_bbbb2222";

export interface Emitted { name: string; subject: string; payload: unknown }

export class FakeMailer implements PortalMailer {
  sent: LinkMessage[] = [];
  failWith: string | null = null;

  async sendLink(msg: LinkMessage): Promise<void> {
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push(msg);
  }

  last(): LinkMessage {
    const m = this.sent[this.sent.length - 1];
    if (!m) throw new Error("no link was sent");
    return m;
  }
}

export interface WorldRecord { id: string; type: string; fields: Record<string, unknown> }

function notFound(): VyreErr {
  return new VyreErr({ code: "validation.not_found", message: "The thing does not exist.", retryable: false, traceId: TRACE, next: [{ kind: "edit_input", label: "Fix the input" }] });
}

export function harness(o: { principal?: string; now?: number; configure?: boolean } = {}) {
  const db = new MemoryDb();
  const mailer = new FakeMailer();
  if (o.configure !== false) configurePortal({ mailer, iterations: 1000 });
  else configurePortal(null);
  const events: Emitted[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const warnings: string[] = [];
  const sites = new Set<string>([SITE, OTHER_SITE]);
  const records = new Map<string, WorldRecord>();
  let clock = o.now ?? NOW;
  const order: Level[] = ["view", "use", "edit", "manage"];

  const ctx: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: o.principal ?? "usr_owner" },
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
      if (cap === "sites.get") {
        const siteId = (input as { siteId: string }).siteId;
        if (!sites.has(siteId)) throw notFound();
        return { site: { siteId, name: "Harbor", kind: "site", owner: "usr_owner", state: "ready" } };
      }
      if (cap === "records.get") {
        const { type, recordId } = input as { type: string; recordId: string };
        const r = records.get(recordId);
        if (!r || r.type !== type) throw notFound();
        return { record: { id: r.id, type: r.type, version: 1, label: 0, fields: r.fields, createdAt: NOW, updatedAt: NOW, holds: 0 } };
      }
      throw new Error(`unscripted call ${cap}`);
    },
    authorize(action: { perm: string | null; level: Level }, resource: ResourceRef): Decision {
      const ok = order.indexOf(action.level) <= order.indexOf("manage");
      return { effect: ok ? "allow" : "deny", reason: ok ? "granted" : "denied", decisionId: `dec_${resource.type}/${resource.id ?? ""}` };
    },
    vault: {
      async fill() {},
      use(handle) { return { handle }; },
    },
    http: async () => { throw new Error("no network in portal tests"); },
    log: {
      debug() {},
      info() {},
      warn(msg: string) { warnings.push(msg); },
      error() {},
    },
    schedule: async () => "sch_1",
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
  };

  return {
    ctx, db, mailer, events, calls, warnings, sites, records,
    advance(ms: number) { clock += ms; },
    names(): string[] { return events.map((e) => e.name); },
    addRecord(r: WorldRecord): void { records.set(r.id, r); },
  };
}

export type World = ReturnType<typeof harness>;

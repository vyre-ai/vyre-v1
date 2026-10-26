// A hand-built Ctx over MemoryDb with a scripted records, contacts, mail, SMS, tasks and scheduler surface.
// Every scripted call records what it was asked, so a test can check what the module sent and what it asked the neighbours to screen.
// Scripted calls cover records, views, Do-not-contact, suppression, mailboxes, mail, SMS and tasks.
// Clock: Thursday 2025-10-09 10:00:00 UTC, inside the default send window (09:00 to 17:00 UTC, Monday to Friday).

import type { Ctx, Decision, Principal, ResourceRef } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName, Level } from "../../../packages/contracts/src/types.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { configureCampaigns } from "../projections.ts";
import type { ProjEvent } from "../projections.ts";
import { MemoryDb } from "./db.ts";
import { strictGuard } from "../../../packages/contracts/src/contract-check.ts";
import { registry as strictRegistry } from "../../../generated/registry.ts";
import { validateInput as strictValidate } from "../../../generated/validators.ts";
const assertStrictInput = strictGuard(strictRegistry, strictValidate);

export const NOW = 1_760_004_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Emitted { name: string; subject: string; payload: unknown }
export interface WorldRecord { id: string; type: string; fields: Record<string, unknown> }
export interface SentMail { input: Record<string, any>; messageId: string }   // eslint-disable-line @typescript-eslint/no-explicit-any

function err(code: "validation.not_found" | "internal.unexpected" | "rate_limit.exceeded" | "provider.unavailable", message: string, retryable = false): VyreErr {
  return new VyreErr({ code, message, retryable, traceId: TRACE, next: [{ kind: "report", label: "Report a problem" }] });
}

export function harness(o: { now?: number; principal?: Principal; publicBase?: string | null } = {}) {
  const db = new MemoryDb();
  configureCampaigns(o.publicBase === null ? null : { publicBase: o.publicBase ?? "https://harbor.example" });
  const events: Emitted[] = [];
  const calls: { cap: string; input: Record<string, any> }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const warnings: string[] = [];
  const records = new Map<string, WorldRecord>();
  const views = new Map<string, { type: string; filter?: unknown }>();
  const mail: SentMail[] = [];
  const sms: Record<string, any>[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const tasks: Record<string, unknown>[] = [];
  const scheduled: { at: number | string; cap: string; input: unknown }[] = [];
  const optouts: Record<string, unknown>[] = [];
  const state = {
    dndRefused: new Set<string>(),
    suppressed: new Set<string>(),
    mailboxes: { mbx_sales: "sales@harbor.example", mbx_other: "hello@other.example" } as Record<string, string>,
    mailStatus: (_i: Record<string, unknown>): string => "sent",
    mailFail: null as null | ((i: Record<string, unknown>) => Error | null),
    smsStatus: "sent",
    next: 1,
  };
  let clock = o.now ?? NOW;
  const order: Level[] = ["view", "use", "edit", "manage"];
  const principal: Principal = o.principal ?? { kind: "person", id: "usr_owner" };

  const ctx: Ctx = {
    space: "spc_test",
    principal,
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
      const i = input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      calls.push({ cap, input: i });
      switch (cap) {
        case "records.get": {
          const r = records.get(String(i.recordId));
          if (!r || r.type !== i.type) throw err("validation.not_found", "no record");
          return { record: { id: r.id, type: r.type, version: 1, label: 0, fields: r.fields, createdAt: NOW, updatedAt: NOW, holds: 0 } };
        }
        case "records.query": {
          const match = (r: WorldRecord, f: any): boolean => {   // eslint-disable-line @typescript-eslint/no-explicit-any
            if (!f) return true;
            if (f.and) return f.and.every((x: unknown) => match(r, x));
            if (f.op === "eq") return r.fields[f.field] === f.value;
            if (f.op === "contains") return String(r.fields[f.field] ?? "").includes(String(f.value));
            return true;
          };
          const rows = [...records.values()].filter((r) => r.type === i.type && match(r, i.filter));
          const off = Number(i.offset ?? 0);
          return { rows: rows.slice(off, off + Number(i.limit ?? 100)).map((r) => ({ id: r.id, type: r.type, fields: r.fields })) };
        }
        case "views.get": {
          const v = views.get(String(i.viewId));
          if (!v) throw err("validation.not_found", "no view");
          return { view: { viewId: i.viewId, type: v.type, ...(v.filter !== undefined ? { filter: v.filter } : {}) } };
        }
        case "contacts.dnd_screen": {
          const refs = (i.candidates as { ref: string }[]).map((c) => c.ref);
          return { allowed: refs.filter((r) => !state.dndRefused.has(r)), refused: refs.filter((r) => state.dndRefused.has(r)).map((r) => ({ ref: r, reason: "do_not_contact" })), removed: 0 };
        }
        case "contacts.suppression.check":
          return { suppressed: (i.addresses as string[]).filter((a) => state.suppressed.has(a.toLowerCase())).map((a) => ({ address: a, reason: "manual" })) };
        case "contacts.apply_optout":
          optouts.push(i);
          state.suppressed.add(String(i.address).toLowerCase());
          return { suppressionId: "sup_1" };
        case "mail.mailbox.get": {
          const address = state.mailboxes[String(i.mailboxId)];
          if (!address) throw err("validation.not_found", "no mailbox");
          return { mailbox: { id: i.mailboxId, address } };
        }
        case "mail.send": {
          const fail = state.mailFail?.(i);
          if (fail) throw fail;
          const messageId = `eml_${String(state.next++).padStart(4, "0")}`;
          const status = state.mailStatus(i);
          mail.push({ input: i, messageId });
          return { messageId, status, suppressed: [] };
        }
        case "telephony.send_sms": {
          sms.push(i);
          return { smsId: `sms_${String(state.next++).padStart(4, "0")}`, status: state.smsStatus };
        }
        case "tasks.create":
          tasks.push(i);
          return { task: { id: `tsk_${tasks.length}` } };
        default:
          throw new Error(`unscripted call ${cap}`);
      }
    },
    authorize(action: { perm: string | null; level: Level }, resource: ResourceRef): Decision {
      const ok = order.indexOf(action.level) <= order.indexOf("manage");
      return { effect: ok ? "allow" : "deny", reason: ok ? "granted" : "denied", decisionId: `dec_${resource.type}/${resource.id ?? ""}` };
    },
    vault: {
      async fill() {},
      use(handle) { return { handle }; },
    },
    http: async () => { throw new Error("no network in campaigns tests"); },
    log: {
      debug() {},
      info() {},
      warn(msg: string) { warnings.push(msg); },
      error() {},
    },
    schedule: async (at, cap, input) => {
      scheduled.push({ at, cap, input });
      return `sch_${scheduled.length}`;
    },
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "b" }), unseal: () => new Uint8Array() },
  };

  return {
    ctx, db, events, calls, warnings, records, views, mail, sms, tasks, scheduled, optouts, state,
    advance(ms: number) { clock += ms; },
    now: () => clock,
    names(): string[] { return events.map((e) => e.name); },
    ofName(name: string): Emitted[] { return events.filter((e) => e.name === name); },
    addRecord(r: WorldRecord): void { records.set(r.id, r); },
    /** A contact record with an email, and a zone when given. */
    contact(n: number, extra: Record<string, unknown> = {}): string {
      const id = `rec_c${String(n).padStart(3, "0")}`;
      records.set(id, { id, type: "contact", fields: { name: `Person ${n}`, email: `p${n}@client.example`, ...extra } });
      return id;
    },
  };
}

export type World = ReturnType<typeof harness>;

/** A projection event as the consumers receive it. */
export function projEvent(payload: Record<string, unknown>, at: number): ProjEvent {
  return { at, actor: "svc_mail", payload: new TextEncoder().encode(JSON.stringify(payload)) };
}

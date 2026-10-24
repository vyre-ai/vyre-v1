// A hand-built Ctx over MemoryDb with a scripted records, tasks and calendar surface and a fake captcha verifier.
// The scripted calls record what they were asked, so a test can check what the module wrote and as which principal.

import type { Ctx, Decision, Principal, ResourceRef } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName, Level } from "../../../packages/contracts/src/types.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { configureForms } from "../projections.ts";
import type { CaptchaVerifier } from "../projections.ts";
import { MemoryDb } from "./db.ts";

/** Thursday 2025-10-09 08:53:20 UTC. The first open slot of a 09:00 to 17:00 UTC page is 10:00 UTC (one hour of notice). */
export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const HOUR = 3_600_000;
export const TEN_UTC = 1_760_004_000_000;

export interface Emitted { name: string; subject: string; payload: unknown }
export interface WorldRecord { id: string; type: string; fields: Record<string, unknown> }
export interface Busy { who: string; startsAt: number; endsAt: number }
export interface CalEvent { id: string; input: Record<string, unknown> }

export class FakeCaptcha implements CaptchaVerifier {
  good = new Set<string>(["human"]);
  checked: string[] = [];
  throws = false;

  async verify(token: string): Promise<boolean> {
    this.checked.push(token);
    if (this.throws) throw new Error("captcha provider down");
    return this.good.has(token);
  }
}

function err(code: "validation.not_found" | "internal.unexpected", message: string): VyreErr {
  return new VyreErr({ code, message, retryable: false, traceId: TRACE, next: [{ kind: "report", label: "Report a problem" }] });
}

export function harness(o: { principal?: Principal; now?: number; captcha?: boolean; configure?: boolean } = {}) {
  const db = new MemoryDb();
  const captcha = new FakeCaptcha();
  if (o.configure !== false) configureForms({ publicBase: "https://harbor.example", ...(o.captcha === false ? {} : { captcha }) });
  else configureForms(null);
  const events: Emitted[] = [];
  const calls: { cap: string; input: unknown; principal: Principal }[] = [];
  const warnings: string[] = [];
  const records = new Map<string, WorldRecord>();
  const tasks: Record<string, unknown>[] = [];
  const events2: CalEvent[] = [];
  const deleted: string[] = [];
  const state = {
    busy: [] as Busy[],
    unknown: [] as string[],
    calendars: [
      { id: "cld_host1", ownerId: "usr_host1", personal: false },
      { id: "cld_host2", ownerId: "usr_host2", personal: false },
    ] as { id: string; ownerId: string; personal: boolean }[],
    failCreate: false,
    failRecords: false,
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
      calls.push({ cap, input, principal: this.principal });
      const i = input as Record<string, unknown>;
      switch (cap) {
        case "records.get": {
          const r = records.get(String(i.recordId));
          if (!r || r.type !== i.type) throw err("validation.not_found", "The thing does not exist.");
          return { record: { id: r.id, type: r.type, version: 1, label: 0, fields: r.fields, createdAt: NOW, updatedAt: NOW, holds: 0 } };
        }
        case "records.query": {
          const filter = i.filter as { and?: { field: string; op: string; value: unknown }[] } | undefined;
          const rows = [...records.values()].filter((r) => r.type === i.type && (filter?.and ?? []).every((f) => r.fields[f.field] === f.value));
          return { rows: rows.slice(0, Number(i.limit ?? 100)).map((r) => ({ id: r.id, type: r.type, fields: r.fields })) };
        }
        case "records.create": {
          if (state.failRecords) throw err("internal.unexpected", "records are down");
          const id = `rec_${String(state.next++).padStart(4, "0")}`;
          records.set(id, { id, type: String(i.type), fields: { ...(i.fields as Record<string, unknown>) } });
          return { record: { id } };
        }
        case "records.update": {
          if (state.failRecords) throw err("internal.unexpected", "records are down");
          const r = records.get(String(i.recordId));
          if (!r) throw err("validation.not_found", "The thing does not exist.");
          Object.assign(r.fields, i.patch as Record<string, unknown>);
          return { record: { id: r.id } };
        }
        case "tasks.create": {
          tasks.push(i);
          return { task: { id: `tsk_${tasks.length}` } };
        }
        case "calendar.availability": {
          const people = i.people as string[];
          return { busy: state.busy.filter((b) => people.includes(b.who)), unknown: state.unknown.filter((u) => people.includes(u)) };
        }
        case "calendar.list_calendars":
          return { calendars: state.calendars };
        case "calendar.create_event": {
          if (state.failCreate) throw err("internal.unexpected", "calendar is down");
          const id = `cev_${String(events2.length + 1).padStart(4, "0")}`;
          events2.push({ id, input: i });
          return { event: { id } };
        }
        case "calendar.delete_event":
          deleted.push(String(i.eventId));
          return { deleted: true };
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
    http: async () => { throw new Error("no network in forms tests"); },
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
    ctx, db, captcha, events, calls, warnings, records, tasks, calendarEvents: events2, deletedEvents: deleted, state,
    advance(ms: number) { clock += ms; },
    names(): string[] { return events.map((e) => e.name); },
    addRecord(r: WorldRecord): void { records.set(r.id, r); },
    /** The same world as another caller, for the public listener: a service principal svc_form_<id>. */
    as(p: Principal): Ctx { return { ...ctx, principal: p }; },
  };
}

export type World = ReturnType<typeof harness>;

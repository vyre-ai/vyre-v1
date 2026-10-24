// A hand-built Ctx over MemoryDb, the fake drivers, a scripted Vault and a scripted Files module.

import type { Ctx, Decision, ResourceRef } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { EventName, Level } from "../../../packages/contracts/src/types.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { configureSites } from "../handlers/deploy.ts";
import { MemoryDb } from "./db.ts";
import { fakeDrivers } from "./fakes.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";

export interface Emitted { name: string; subject: string; payload: unknown }
export interface Filled { handle: string; kind: string; ref: string }

export function harness(o: { principal?: string; now?: number } = {}) {
  const db = new MemoryDb();
  const fakes = fakeDrivers();
  configureSites(fakes.drivers);
  const events: Emitted[] = [];
  const filled: Filled[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const warnings: string[] = [];
  let clock = o.now ?? NOW;
  let seq = 0;
  /** Vault handles the caller may use; anything else throws like the real vault */
  const granted = new Set<string>(["#Staging_Pass", "#Stripe.key", "#Db_Url"]);
  /** (type/id) pairs the caller may not see */
  const hidden = new Set<string>();
  /** resource types and the highest level the caller holds on them */
  const levelFor = new Map<string, Level>();
  const order: Level[] = ["view", "use", "edit", "manage"];
  const folders = new Set<string>();

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
      calls.push({ cap, input });
      if (cap === "files.tree") return { roots: [{ key: "deployments", title: "Deployments", kind: "folder", folderId: "fld_deployments", count: 0 }] };
      if (cap === "files.folder.create") {
        const inp = input as { name: string };
        if (folders.has(inp.name)) {
          throw new VyreErr({ code: "validation.duplicate", message: "That name is already in this folder.", retryable: false, traceId: TRACE, next: [{ kind: "edit_input", label: "Fix the input" }] });
        }
        folders.add(inp.name);
        seq += 1;
        return { folder: { folderId: `fld_site${seq}`, name: inp.name } };
      }
      throw new Error(`unscripted call ${cap}`);
    },
    authorize(action: { perm: string | null; level: Level }, resource: ResourceRef): Decision {
      const key = `${resource.type}/${resource.id ?? ""}`;
      const held = levelFor.get(resource.type) ?? "manage";
      const ok = !hidden.has(key) && order.indexOf(action.level) <= order.indexOf(held);
      return { effect: ok ? "allow" : "deny", reason: ok ? "granted" : "denied", decisionId: `dec_${key}` };
    },
    vault: {
      async fill(handle, into) {
        filled.push({ handle, kind: into.kind, ref: into.ref });
      },
      use(handle) {
        if (!granted.has(handle)) throw new Error(`no grant on ${handle}`);
        return { handle };
      },
    },
    http: async () => ({ status: 200, text: async () => "" }),
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
    ctx, db, events, filled, calls, warnings, granted, hidden, levelFor, ...fakes,
    advance(ms: number) { clock += ms; },
    names(): string[] { return events.map((e) => e.name); },
    as(principal: string): Ctx { return { ...ctx, principal: { kind: "person", id: principal } }; },
  };
}

export type World = ReturnType<typeof harness>;

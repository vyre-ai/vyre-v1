// createTestSpace: a real kernel (event log on a copied template, authorize over an access snapshot, idempotency) and the host invoke pipeline in one process. No daemon, no port.
// The module set is the generated stub handlers unless a test passes its own `handlers`; they load on the first api() call, not at boot, so a blank Space stays fast.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { LogClient } from "../../kernel/src/log/index.ts";
import type { NewEvent, ReadQuery, StoredEvent } from "../../kernel/src/log/index.ts";
import { createInvoke, indexCapabilities } from "../../host/src/invoke.ts";
import type { AuditRow, CtxSeed, Handler, InvokeResult } from "../../host/src/invoke.ts";
import { fileImporter, loadHost, readModuleList } from "../../host/src/loader.ts";
import type { LoadedHost, RegistryLike } from "../../host/src/loader.ts";
import { registry } from "../../generated/registry.ts";
import { routes } from "../../generated/routes.ts";
import { roleDefaults } from "../../generated/permissions.ts";
import { validateEvent, validateInput } from "../../generated/validators.ts";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { createClock } from "./clock.ts";
import type { FakeClock } from "./clock.ts";
import { templateFor } from "./template.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type BuiltInRole = "owner" | "admin" | "developer" | "member" | "guest";
export const SPACE_ID = "spc_test";
const CLEARANCE: Record<BuiltInRole, number> = { owner: 3, admin: 3, developer: 2, member: 2, guest: 1 };
const SPACE_LEVEL: Partial<Record<BuiltInRole, "manage" | "edit">> = { admin: "manage", developer: "edit", member: "edit" };   // guests hold no grant until someone gives one

/** Who is in the Space: principal id to role. `seed:'small'` is the six-person starter until the frozen core seed (P-PR_22) replaces it. */
export type People = Record<string, BuiltInRole>;
const SEEDS: Record<"blank" | "small", People> = {
  blank: { usr_owner: "owner" },
  small: { usr_owner: "owner", usr_admin: "admin", usr_dev: "developer", usr_ana: "member", usr_bo: "member", usr_guest: "guest" },
};

export interface TestSpaceOptions {
  seed?: "blank" | "small";
  /** replaces the seed's people */
  roles?: People;
  clock?: FakeClock;
  /** real handlers for a module under test; capabilities not listed here are served by their generated stub */
  handlers?: Record<string, Handler>;
}

export interface Caller { id: string; kind?: "person" | "agent" | "actor" | "service"; actingFor?: string }
export interface SpaceApi {
  /** call a capability; resolves to the output or throws a HostError */
  call(cap: string, input: unknown, opts?: Partial<CtxSeed>): Promise<unknown>;
  /** the full InvokeResult (held calls included) */
  invoke(cap: string, input: unknown, opts?: Partial<CtxSeed>): Promise<InvokeResult>;
}
export interface TestSpace {
  space: string;
  api(as: string | Caller): SpaceApi;
  events: { read(q?: ReadQuery): Promise<StoredEvent[]>; head(): Promise<{ seq: number; hash: string }>; verify(): Promise<boolean> };
  /** events the bus published after commit, in order */
  published: EventEnvelope[];
  audits: AuditRow[];
  clock: FakeClock;
  access: AccessSnapshot;
  /** scripted providers arrive with the fake provider kit (P-PR_21) */
  fakeProviders: Record<string, never>;
  close(): Promise<void>;
}

let hostPromise: Promise<LoadedHost> | null = null;
/** The stub handlers of every module, loaded once per process and shared by every Space. */
function stubHost(): Promise<LoadedHost> {
  return (hostPromise ??= loadHost({ registry: registry as unknown as RegistryLike, modulesJson: readModuleList(path.join(ROOT, "host/modules.json")), routes, importer: fileImporter(ROOT) }));
}

function accessFor(people: People): AccessSnapshot {
  const s = new AccessSnapshot();
  for (const role of Object.keys(CLEARANCE) as BuiltInRole[]) {
    const perms = Object.entries(roleDefaults).filter(([, d]) => d[role] === true).map(([k]) => k);
    s.putRole({ id: role, clearance: CLEARANCE[role], perms, name: role });
  }
  s.putResource({ id: SPACE_ID, type: "space", parent_id: null, label: 0, owner_id: Object.entries(people).find(([, r]) => r === "owner")?.[0] ?? null, holds: 0 });
  for (const [id, role] of Object.entries(people)) {
    s.putPrincipal({ id, kind: "person", status: "active", name: id });
    s.addPrincipalRole({ holder: id, role });
  }
  for (const role of Object.keys(SPACE_LEVEL) as BuiltInRole[]) {
    s.putGrant({ id: `gr_${role}`, subject_kind: "role", subject_id: role, resource_type: "space", resource_id: SPACE_ID, level: SPACE_LEVEL[role]! });
  }
  return s;
}

const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
function toNew(e: EventEnvelope): NewEvent {
  return drop({
    id: e.id, type: e.type, sv: e.sv, hlc: e.hlc, trace_id: e.traceId, span_id: e.spanId, actor: e.actor, on_behalf: e.onBehalf, device: e.device, run_id: e.runId,
    cause: e.cause, origin: e.origin, depth: e.depth, entity: e.entity, entity_id: e.entityId, fields: e.fields, label: e.label, vis: e.vis, enc: e.enc, payload: e.payload,
  }) as NewEvent;
}
const fromStored = (s: StoredEvent, orig: EventEnvelope): EventEnvelope => ({ ...orig, seq: s.seq, id: s.id, hlc: s.hlc, at: s.at });

export async function createTestSpace(o: TestSpaceOptions = {}): Promise<TestSpace> {
  if (!SEEDS[o.seed ?? "blank"]) throw new Error(`seed ${String(o.seed)} is not available yet (only 'blank' and 'small')`);
  const people = o.roles ?? SEEDS[o.seed ?? "blank"];
  const clock = o.clock ?? createClock();
  const template = await templateFor(SPACE_ID);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-space-"));
  fs.copyFileSync(template, path.join(dir, "events.db"));
  let log: LogClient;
  try { log = await LogClient.open({ path: path.join(dir, "events.db"), space: SPACE_ID }); }
  catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }

  const access = accessFor(people);
  const published: EventEnvelope[] = [], audits: AuditRow[] = [];
  let invoke: ReturnType<typeof createInvoke> | null = null;
  const build = async (): Promise<ReturnType<typeof createInvoke>> => {
    if (invoke) return invoke;
    const host = await stubHost();
    const caps = registry.capabilities as unknown as CapabilityDef[];
    invoke = createInvoke({
      caps: indexCapabilities(caps), validateInput, validateEvent, authorize: (r) => authorize(access, r),
      handler: (cap, v) => o.handlers?.[cap] ?? host.handler(cap, v), services: host.services,
      commit: async (b) => {
        const out: EventEnvelope[] = [];
        for (const e of b.events) out.push(fromStored(await log.append(toNew(e)), e));
        if (b.audit) audits.push(b.audit);
        return out;
      },
      audit: (r) => { audits.push(r); },
      publish: (evs) => { published.push(...evs); },
      idem: log.idempotency(), now: clock.now,
    });
    return invoke;
  };

  return {
    space: SPACE_ID, clock, access, published, audits, fakeProviders: {},
    api(as) {
      const c = typeof as === "string" ? { id: as } : as;
      const seed = (x?: Partial<CtxSeed>): CtxSeed => ({ space: SPACE_ID, principal: { kind: c.kind ?? "person", id: c.id }, ...(c.actingFor ? { actingFor: c.actingFor } : {}), ...x });
      const run = async (cap: string, input: unknown, x?: Partial<CtxSeed>) => (await build())(cap, input, seed(x));
      return { invoke: run, call: async (cap, input, x) => { const r = await run(cap, input, x); if (r.status === "held") return r; return r.output; } };
    },
    events: { read: (q) => log.read(q), head: () => log.currentHead(), verify: async () => (await log.verify()).ok },
    async close() { await log.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

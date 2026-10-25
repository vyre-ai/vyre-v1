// Test harness for the computers handlers: a real in-memory SQLite behind the host's ctx.db guard (computers_* tables only), a recording ctx, scripted stand-ins for the capabilities the handlers
// call (agents.get, tasks.create, files.create), the fake host bound as the machine, and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { bindHost, bindKit, bindTeam, ensure, forgetSecrets } from "../projections.ts";
import type { CompCtx } from "../projections.ts";
import { fakeHost } from "./fake-host.ts";
import type { FakeHost, FakeHostOptions } from "./fake-host.ts";

export const NOW = 1_760_000_000_000;
export const MIN = 60_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const INTAKE = "agt_intake";
export const DANA = "usr_dana";
export const OMAR = "usr_omar";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
export interface Called { cap: string; input: Record<string, unknown> }
export type Responder = (input: Record<string, unknown>) => unknown;

export interface HarnessOptions {
  raw?: RawDb;
  principal?: CompCtx["principal"];
  actingFor?: string;
  clock?: { t: number };
  fake?: FakeHost;
  fakeOptions?: FakeHostOptions;
  /** The Space is not a Team Space. */
  personalSpace?: boolean;
  /** Resources the caller may not view or use, as "type:id". */
  deny?: string[];
  /** The caller holds computers.use at manage. Default true. */
  manager?: boolean;
  respond?: Record<string, Responder>;
}

export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_computerstest", projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const fake = o.fake ?? fakeHost(o.fakeOptions);
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const deny = new Set(o.deny ?? []);
  const respond: Record<string, Responder> = { ...(o.respond ?? {}) };
  let manager = o.manager !== false;
  let tasks = 0;
  let files = 0;
  const db = scopedDb("computers", raw, TRACE);
  ensure(db);
  bindHost(fake.host);
  bindTeam(o.personalSpace ? () => false : null);
  const ctx: CompCtx = {
    space: "spc_computerstest",
    principal: o.principal ?? { kind: "person", id: DANA },
    ...(o.actingFor ? { actingFor: o.actingFor } : {}),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) { emitted.push({ name, subject, payload: payload as Record<string, unknown> }); return null; },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const r = respond[cap];
      if (r) return r(body);
      if (cap === "agents.get") return { agent: { agentId: body["agentId"], folderId: `fld_${String(body["agentId"]).replace(/^agt_/, "")}` } };
      if (cap === "tasks.create") return { task: { id: `tsk_cmp${++tasks}` } };
      if (cap === "files.create") return { file: { fileId: `fil_shot${++files}` } };
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize(action, resource) {
      if (action.level === "manage" && action.perm === "computers.use" && !manager) return { effect: "deny" };
      return { effect: deny.has(`${resource.type}:${resource.id}`) ? "deny" : "allow" };
    },
    log: { warn() {} },
  };
  return {
    ctx, raw, db, fake, emitted, called, clock, respond,
    advance(ms: number) { clock.t += ms; },
    setManager(v: boolean) { manager = v; },
    deny(key: string) { deny.add(key); },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** The same database, clock and machine as another caller (a second person on one Space). */
export function asPerson(h: Harness, principal: CompCtx["principal"], extra: Omit<HarnessOptions, "raw" | "principal" | "clock" | "fake"> = {}): Harness {
  return harness({ ...extra, raw: h.raw, principal, clock: h.clock, fake: h.fake });
}

export function resetModule(): void {
  bindHost(null);
  bindKit(null);
  bindTeam(null);
  forgetSecrets("cmt_one");
}

export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}

export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}

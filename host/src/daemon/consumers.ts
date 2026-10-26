// Module hooks at boot (rulings 31 and 32): the consumers and periodic jobs a live module exports, run by the host.
//   consumer  `export const consumers = { "<module>.<name>": { on: ["event.name", ...], run(ctx, event) } }`. The host runs it once per matching event, after the event is committed, at
//             least once: a cursor per consumer lives in modules.db (`host_hook_cursor`), and a restart picks up where it stopped. A consumer first seen starts at the end of the log
//             (history is not replayed into it). A consumer that throws is retried on the next pass; after MAX_TRIES it is skipped and logged so one bad event cannot hold the rest.
//   periodic  `export const periodic = { "<module>.<name>": { everyMs, run(ctx) } }`, run by the scheduler.
//   runs      the runs module exports `onRunFailed` and `sweepEscalations` by name (P-L6_11); the host maps them to the consumer `runs.alerts` and the periodic job `runs.escalations`.
// Both kinds get a full ctx: the host runs each through the invoke pipeline as a host-only capability (`host.hook.<name>`) that declares the events its module's capabilities emit, so
// ctx.emit, ctx.call, ctx.db (the module's own tables) and ctx.log behave as they do in a handler, and what is emitted commits with the same ids, clock and publish. The caller is the
// host service with `preAuth`: a hook acts as the system, not as a person.
// The async consumers a module also exports as projections (`mode: "async"`, kernel ProjectionHost) have another shape and are not touched here.
import { isErased } from "../../../kernel/src/events/compact.ts";
import type { StoredEvent } from "../../../kernel/src/log/index.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import type { CtxSeed, Handler, Invoke } from "../invoke.ts";
import { fail } from "../routes/errors.ts";
import type { RawDb } from "../ctx/db.ts";

export const MAX_TRIES = 5;
const PAGE = 200;
/** How often the runs module's escalation clock is swept. */
export const RUNS_ESCALATION_EVERY_MS = 60_000;
export const SYSTEM_PRINCIPAL = { kind: "service", id: "svc_host" } as const;

/**
 * The host calls that read or move what a person owns (the removal wizard: `<module>.owned_by`, `<module>.reassign_owned`). They are guarded twice (P-L7_21):
 *   by permission  the capability that carries them needs `members.remove`, the permission of members.remove itself, so only an admin who may remove people passes the pipeline;
 *   by path        the handler refuses unless the call is the host's own top-level hook call (origin "hook", depth 0): not a call from another module's ctx.call (depth 1 or more), not a gateway
 *                  or MCP call (origin user or mcp). The host reaches them only through people.ts, from members.remove and members.remove_preview, as the admin doing the removal.
 * They are also not in the generated registry, so no route or MCP tool names them.
 */
export const GUARDED_CALL = /\.(owned_by|reassign_owned)$/;
export const GUARDED_CALL_PERMISSION = "members.remove";
export function guardCall(name: string, ctx: Pick<Ctx, "origin" | "depth" | "trace">): void {
  if (!GUARDED_CALL.test(name)) return;
  if (ctx.origin !== "hook" || ctx.depth !== 0) throw fail("permission.no_grant", ctx.trace.traceId, { message: "This is a host call for the removal wizard; it cannot be called from here.", details: { call: name } });
}

/** What a consumer sees of one event. `payload` is `{}` for an event whose payload is sealed. */
export interface HookEvent {
  id: string;
  seq: number;
  name: string;
  /** `entity/entityId` when the event names one */
  subject: string;
  payload: Record<string, unknown>;
  actor: string;
  traceId: string;
  at: number;
}

export interface ConsumerDef { name: string; module: string; on: readonly string[]; run(ctx: Ctx, event: HookEvent): Promise<unknown> | unknown }
export interface PeriodicDef { name: string; module: string; everyMs: number; run(ctx: Ctx): Promise<unknown> | unknown }
/** A function a module offers the host to run as that module (`export const hostCalls = { "<module>.<name>": (ctx, input) => ... }`): the host's way to hand work to a module that has no capability for it, with the module's own ctx. */
export interface CallDef { name: string; module: string; run(ctx: Ctx, input: unknown): Promise<unknown> | unknown }
export interface ModuleHooks { module: string; consumers: ConsumerDef[]; periodic: PeriodicDef[]; calls?: CallDef[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read one module's exports into the hooks the host runs. Anything that does not have the shape is ignored (the Tx-style projection consumers, plain helpers). */
export function collectHooks(module: string, ns: Record<string, unknown>): ModuleHooks {
  const out: ModuleHooks = { module, consumers: [], periodic: [], calls: [] };
  if (isRecord(ns["hostCalls"])) {
    for (const [name, run] of Object.entries(ns["hostCalls"])) if (typeof run === "function") out.calls!.push({ name, module, run: (ctx, input) => (run as (c: Ctx, i: unknown) => unknown)(ctx, input) });
  }
  if (isRecord(ns["consumers"])) {
    for (const [name, def] of Object.entries(ns["consumers"])) {
      if (!isRecord(def) || !Array.isArray(def["on"]) || typeof def["run"] !== "function") continue;   // a kernel projection has `mode: "async"` and an object `on`
      const run = def["run"] as (ctx: Ctx, event: HookEvent) => Promise<unknown> | unknown;
      out.consumers.push({ name, module, on: (def["on"] as unknown[]).filter((x): x is string => typeof x === "string"), run: (ctx, event) => run(ctx, event) });
    }
  }
  if (isRecord(ns["periodic"])) {
    for (const [name, def] of Object.entries(ns["periodic"])) {
      if (!isRecord(def) || typeof def["everyMs"] !== "number" || !(def["everyMs"] > 0) || typeof def["run"] !== "function") continue;
      const run = def["run"] as (ctx: Ctx) => Promise<unknown> | unknown;
      out.periodic.push({ name, module, everyMs: def["everyMs"], run: (ctx) => run(ctx) });
    }
  }
  // the runs module's alerts (P-L6_11), found by the names it exports
  const failed = ns["onRunFailed"], sweep = ns["sweepEscalations"];
  if (typeof failed === "function" && !out.consumers.some((c) => c.name === "runs.alerts")) {
    const f = failed as (ctx: Ctx, ev: { runId: string }) => Promise<unknown>;
    out.consumers.push({ name: "runs.alerts", module, on: ["run.failed"], run: (ctx, ev) => f(ctx, { runId: String(ev.payload["runId"] ?? "") }) });
  }
  if (typeof sweep === "function" && !out.periodic.some((p) => p.name === "runs.escalations")) {
    const f = sweep as (ctx: Ctx) => Promise<unknown>;
    out.periodic.push({ name: "runs.escalations", module, everyMs: RUNS_ESCALATION_EVERY_MS, run: (ctx) => f(ctx) });
  }
  return out;
}

/** The events a stored row becomes for a consumer. */
export function toHookEvent(e: StoredEvent): HookEvent {
  let payload: Record<string, unknown> = {};
  if (e.enc === 0) {
    try { const v: unknown = JSON.parse(new TextDecoder().decode(e.payload)); if (isRecord(v)) payload = v; } catch { /* a payload that is not JSON reads as empty */ }
  }
  return { id: e.id, seq: e.seq, name: e.type, subject: e.entity_id ? `${e.entity ?? ""}/${e.entity_id}` : (e.entity ?? ""), payload, actor: e.actor, traceId: e.trace_id, at: e.at };
}

export interface LogReader {
  read(q: { after?: number; limit?: number }): Promise<StoredEvent[]>;
  currentHead(): Promise<{ seq: number }>;
}
export interface HookRunnerDeps {
  space: string;
  now(): number;
  /** modules.db: the cursors are kept here */
  db: Pick<RawDb, "all" | "run">;
  log: LogReader;
  hooks: readonly ModuleHooks[];
  /** the invoke pipeline */
  invoke: Invoke;
  /** every event name the module's capabilities may emit; a hook may emit these */
  emitsOf(module: string): string[];
  /** one real capability of the module, so the loader's per-module services (ctx.db) are built for the right owner */
  capOf(module: string): CapabilityDef | undefined;
  warn(msg: string, attrs?: Record<string, unknown>): void;
}

export interface HookRunner {
  /** the host-only capabilities and their handlers: add to the daemon's extra caps and handlers */
  caps: CapabilityDef[];
  handlers: Record<string, Handler>;
  /** hooks.caps are not in the loader's registry: this maps one back to the real capability of its module for ctx.db and the other module services */
  serviceCap(cap: CapabilityDef): CapabilityDef;
  consumers: readonly ConsumerDef[];
  periodic: readonly PeriodicDef[];
  /** Give every consumer without a cursor one at the end of the log. Call once after boot. */
  start(): Promise<void>;
  /** Deliver everything committed since each consumer's cursor. Passes never overlap; a call made during a pass runs another when it ends. */
  pump(): Promise<void>;
  /** Run one periodic job now. */
  runPeriodic(name: string): Promise<void>;
  /** Run a module's hostCall as that module and answer what it returns. */
  /** `as`: run it for that principal (the admin whose action this is), with their authority for anything the call asks of other modules; omitted: as the host. */
  call(name: string, input: unknown, as?: { principal: { kind: "person" | "agent" | "service"; id: string } }): Promise<unknown>;
}

const capName = (kind: "consumer" | "periodic" | "call", name: string): string => `host.hook.${kind}.${name}`;

export function createHookRunner(d: HookRunnerDeps): HookRunner {
  d.db.run("CREATE TABLE IF NOT EXISTS host_hook_cursor (name TEXT PRIMARY KEY, seq INTEGER NOT NULL, at INTEGER NOT NULL)");
  const consumers = d.hooks.flatMap((h) => h.consumers);
  const periodic = d.hooks.flatMap((h) => h.periodic);
  const caps: CapabilityDef[] = [];
  const handlers: Record<string, Handler> = {};
  const moduleOf = new Map<string, string>();
  const base = (name: string, module: string, permission: string | null = null): CapabilityDef => ({
    name, v: 1, module, summary: "A module hook the host runs", permission, level: "view", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low",
    emits: d.emitsOf(module), examples: [], surfaces: {}, input: {}, output: {}, errors: [],
  } as unknown as CapabilityDef);
  const byConsumer = new Map<string, ConsumerDef>(), byPeriodic = new Map<string, PeriodicDef>();
  for (const c of consumers) {
    if (byConsumer.has(c.name)) { d.warn("two modules export a consumer with one name; the second is not run", { consumer: c.name, module: c.module }); continue; }
    byConsumer.set(c.name, c);
    const n = capName("consumer", c.name);
    caps.push(base(n, c.module)); moduleOf.set(n, c.module);
    handlers[n] = (ctx, input: { event: HookEvent }) => c.run(ctx, input.event);
  }
  for (const p of periodic) {
    if (byPeriodic.has(p.name)) { d.warn("two modules export a periodic job with one name; the second is not run", { job: p.name, module: p.module }); continue; }
    byPeriodic.set(p.name, p);
    const n = capName("periodic", p.name);
    caps.push(base(n, p.module)); moduleOf.set(n, p.module);
    handlers[n] = (ctx) => p.run(ctx);
  }
  const byCall = new Map<string, CallDef>();
  for (const c of d.hooks.flatMap((h) => h.calls ?? [])) {
    if (byCall.has(c.name)) { d.warn("two modules export a host call with one name; the second is not offered", { call: c.name, module: c.module }); continue; }
    byCall.set(c.name, c);
    const n = capName("call", c.name);
    caps.push(base(n, c.module, GUARDED_CALL.test(c.name) ? GUARDED_CALL_PERMISSION : null)); moduleOf.set(n, c.module);
    handlers[n] = (ctx, input: { input: unknown }) => { guardCall(c.name, ctx); return c.run(ctx, input.input); };
  }
  const seed = (extra: Partial<CtxSeed> = {}): CtxSeed => ({ space: d.space, principal: { ...SYSTEM_PRINCIPAL }, preAuth: true, origin: "hook", ...extra });

  const cursor = (name: string): number | undefined => {
    const r = d.db.all("SELECT seq FROM host_hook_cursor WHERE name = ?", name)[0] as { seq: number } | undefined;
    return r ? Number(r.seq) : undefined;
  };
  const setCursor = (name: string, seq: number): void => {
    d.db.run("INSERT INTO host_hook_cursor (name, seq, at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET seq = excluded.seq, at = excluded.at", name, seq, d.now());
  };
  const tries = new Map<string, number>();

  async function deliver(c: ConsumerDef, e: StoredEvent): Promise<boolean> {
    const ev = toHookEvent(e);
    try {
      await d.invoke(capName("consumer", c.name), { event: ev }, seed({ trace: { traceId: e.trace_id, spanId: "0".repeat(16) }, depth: e.depth + 1 }));
      tries.delete(`${c.name}:${e.seq}`);
      return true;
    } catch (err) {
      const key = `${c.name}:${e.seq}`;
      const n = (tries.get(key) ?? 0) + 1;
      tries.set(key, n);
      d.warn("a consumer failed on an event", { consumer: c.name, event: e.type, seq: e.seq, try: n, error: err instanceof Error ? err.message : String(err) });
      if (n < MAX_TRIES) return false;
      tries.delete(key);
      d.warn("a consumer gave up on an event and skipped it", { consumer: c.name, event: e.type, seq: e.seq });
      return true;
    }
  }

  async function passFor(c: ConsumerDef): Promise<void> {
    let at = cursor(c.name);
    if (at === undefined) return;   // start() has not run for it yet
    for (;;) {
      const page = await d.log.read({ after: at, limit: PAGE });
      if (!page.length) return;
      for (const e of page) {
        // an erased event (events.compact) has no payload to act on: it is skipped, as the projections skip it
        if (c.on.includes(e.type) && !isErased(e)) {
          if (!(await deliver(c, e))) { setCursor(c.name, at); return; }   // stop here: this event is tried again on the next pass, before any later one
          at = e.seq;
          setCursor(c.name, at);   // a delivered event is recorded at once, so a crash repeats at most the one in flight
        } else at = e.seq;
      }
      setCursor(c.name, at);
      if (page.length < PAGE) return;
    }
  }

  let running: Promise<void> | null = null, again = false;
  const run = (): Promise<void> => (async () => {
    try {
      await null;   // let `running` be assigned before the first check, even with nothing to run
      do {
        again = false;
        for (const c of byConsumer.values()) await passFor(c);
      } while (again);
    } finally { running = null; }   // set in the same tick as the last check of `again`, so a call can never be told "a pass is running" by a pass that has finished
  })();

  return {
    caps, handlers, consumers: [...byConsumer.values()], periodic: [...byPeriodic.values()],
    serviceCap(cap) {
      const m = moduleOf.get(cap.name);
      const real = m ? d.capOf(m) : undefined;
      return real ?? cap;
    },
    async start() {
      const head = (await d.log.currentHead()).seq;
      for (const c of byConsumer.values()) if (cursor(c.name) === undefined) setCursor(c.name, head);
    },
    pump() {
      if (running) { again = true; return running; }
      running = run();
      return running;
    },
    async call(name, input, as) {
      if (!byCall.has(name)) throw new Error(`no host call named ${name}`);
      const r = await d.invoke(capName("call", name), { input }, as ? seed({ principal: { ...as.principal }, preAuth: false }) : seed());
      if (r.status !== "ok") throw new Error(`${name} was held`);
      return r.output;
    },
    async runPeriodic(name) {
      if (!byPeriodic.has(name)) throw new Error(`no periodic job named ${name}`);
      await d.invoke(capName("periodic", name), {}, seed());
    },
  };
}

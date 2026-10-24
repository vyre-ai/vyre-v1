// (host/tests/invoke.* import this file)
// The capability invoke pipeline (ARCH 4.4). Every call, from HTTP, MCP, the agent engine, an automation step or another handler (ctx.call), goes through here.
//   1 resolve  2 validate  3 idempotency  4 rate limit  5 authorize (+ Gate)  6 handler  7 commit (events, audit)  8 publish
// Everything the pipeline needs from outside is a port in InvokeDeps, so the same code runs against the real kernel (authorize, LogClient idempotency, tx) and against fakes in tests.
// Errors leave as HostError (a shaped VyreError with its HTTP status); nothing here throws a raw exception to a caller.
import { formatHlc, tickHlc } from "../../lib/hlc.ts";
import type { Hlc } from "../../lib/hlc.ts";
import { mintId } from "../../lib/ids.ts";
import { mintEventId } from "./ids.ts";
import type { Decision as KernelDecision, Req as AuthReq, ResourceRef } from "../../kernel/src/authorize/index.ts";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";
import type { Ctx, Decision, EmitOpts, Logger } from "../../packages/contracts/src/ctx.ts";
import type { CapabilityDef, CapName, EventName, TraceContext } from "../../packages/contracts/src/types.ts";
import { BindingError, resolveResource } from "./routes/resource.ts";
import { codeForReason, fail, HostError, toVyreError } from "./routes/errors.ts";

export { HostError, VyreErr, fail, makeError } from "./routes/errors.ts";

export const MAX_DEPTH = 8;

export type Handler = (ctx: Ctx, input: any) => Promise<unknown> | unknown;

export interface CapIndex { get(name: string, v?: number): CapabilityDef | undefined }
/** Latest version when `v` is omitted. */
export function indexCapabilities(caps: readonly CapabilityDef[]): CapIndex {
  const m = new Map<string, CapabilityDef>(), latest = new Map<string, CapabilityDef>();
  for (const c of caps) {
    m.set(`${c.name}@${c.v}`, c);
    const l = latest.get(c.name);
    if (!l || c.v > l.v) latest.set(c.name, c);
  }
  return { get: (name, v) => (v === undefined ? latest.get(name) : m.get(`${name}@${v}`)) };
}

export interface PrincipalSeed { kind: Ctx["principal"]["kind"]; id: string }
/** What the caller knows before the pipeline starts: who, for whom, where from. */
export interface CtxSeed {
  space: string;
  principal: PrincipalSeed;
  actingFor?: string | undefined;
  trace?: TraceContext | undefined;
  run?: string | undefined;
  thread?: string | undefined;
  origin?: string | undefined;
  depth?: number | undefined;
  device?: string | undefined;
  /** AI provider of the active model when the result goes to one (label vs provider, 4.5) */
  provider?: string | undefined;
  /** an approval token for exactly this payload, from the Gate resume path */
  approval?: string | undefined;
  /** contract version; latest when omitted */
  v?: number | undefined;
  /**
   * Gate acts already settled by a call further up this chain (set only by ctx.call, never by a caller): a handler runs only after its own Gate cleared (approved, or no Gate applied),
   * so the provider calls it makes for the same act are part of that one approval. The Gate hook reads this (host/src/daemon/gate-nesting.ts).
   */
  clearedActs?: readonly string[] | undefined;
  /** caller class resolved by the gateway: 'anonymous' and 'pending' callers skip authorize (the capability declares `caller`) */
  preAuth?: boolean | undefined;
}

export interface AuditRow {
  class: "allow" | "deny" | "hold"; cap: string; v: number; principal: string; actingFor?: string | undefined; decisionId: string; reason: string;
  resource: ResourceRef | null; traceId: string; spanId: string; at: number; risk: CapabilityDef["risk"];
}
/** One atomic commit: the events a handler emitted plus its audit row (ARCH 4.4 step 7). Returns the events as stored (seq set). */
export interface CommitBatch { cap: string; v: number; principal: string; events: EventEnvelope[]; audit: AuditRow | null }

export interface SpanRecord {
  traceId: string; spanId: string; parent?: string | undefined; name: string; cap: string; startedAt: number; ms: number;
  status: "ok" | "held" | "denied" | "error"; code?: string | undefined;
}

export interface GateHook {
  /** Does a Gate apply to this call (capability `gate` with its `when`)? Null lets the call through. */
  applies(cap: CapabilityDef, input: unknown, seed: CtxSeed): { act: string } | null;
  /** Park the call as an approval task (4.6) and return its ids. */
  park(a: { cap: CapabilityDef; input: unknown; seed: CtxSeed; act: string; decisionId: string; traceId: string }): Promise<{ taskId: string; runId?: string }>;
  /** Is the approval token valid for exactly this call? */
  verify(token: string, a: { cap: CapabilityDef; input: unknown; seed: CtxSeed }): boolean;
}

export interface InvokeDeps {
  caps: CapIndex;
  validateInput(cap: string, v: number, input: unknown): string[];
  validateEvent?(name: string, payload: unknown): string[];
  /** kernel authorize bound to the Space's access snapshot */
  authorize(req: AuthReq): KernelDecision;
  handler(cap: string, v: number): Handler | undefined;
  commit(batch: CommitBatch): Promise<EventEnvelope[]>;
  /** deny and hold audit rows (an allow row rides in the commit) */
  audit?(row: AuditRow): void | Promise<void>;
  publish?(events: EventEnvelope[]): void;
  idem?: { once<T>(principal: string, cap: string, key: string | undefined | null, input: unknown, run: () => Promise<T>): Promise<T> };
  rate?: { take(key: string, spec: { n: number; perSeconds: number }, now: number): boolean };
  gate?: GateHook;
  /** vault name or handle to item id, for `resolve` bindings */
  resolveItem?(type: string, kind: "name" | "handle", value: string): string | null;
  /** spend so far per meter, for the spend policies */
  spend?(principal: string): Record<string, number> | undefined;
  /** module services for the handler context: db, vault, http, schedule, seal */
  services?(seed: CtxSeed, cap: CapabilityDef): Partial<Pick<Ctx, "db" | "vault" | "http" | "schedule" | "seal">>;
  log?: Logger;
  onSpan?(s: SpanRecord): void;
  now?(): number;
  randomHex?(bytes: number): string;
}

export type InvokeResult =
  | { status: "ok"; output: unknown; traceId: string }
  | { status: "held"; taskId: string; runId?: string | undefined; traceId: string };

const defaultHex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const DESTRUCTIVE = /(^|[._])(delete|remove|purge|erase|destroy)([._]|$)/;
const noop = (): void => {};
const nullLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };

/** Token bucket per key. n tokens refill over perSeconds. */
export function createRateLimiter(): NonNullable<InvokeDeps["rate"]> {
  const b = new Map<string, { tokens: number; at: number }>();
  return {
    take(key, spec, now) {
      const cap = spec.n, perMs = spec.perSeconds * 1000;
      const cur = b.get(key) ?? { tokens: cap, at: now };
      cur.tokens = Math.min(cap, cur.tokens + ((now - cur.at) / perMs) * cap); cur.at = now;
      if (cur.tokens < 1) { b.set(key, cur); return false; }
      cur.tokens -= 1; b.set(key, cur);
      return true;
    },
  };
}

export type Invoke = (cap: string, input: unknown, seed: CtxSeed) => Promise<InvokeResult>;

export function createInvoke(deps: InvokeDeps): Invoke {
  const now = deps.now ?? Date.now;
  const hex = deps.randomHex ?? defaultHex;
  const log = deps.log ?? nullLogger;
  let lastHlc: Hlc | null = null;
  const nextHlc = (): string => { lastHlc = tickHlc("server", now(), lastHlc); return formatHlc(lastHlc); };

  const invoke: Invoke = async (capName, input, seed) => {
    const t0 = now();
    const parent = seed.trace;
    const trace: TraceContext = { traceId: parent?.traceId ?? hex(16), spanId: hex(8), ...(parent ? { parent: parent.spanId } : {}) };
    const traceId = trace.traceId;
    let cap: CapabilityDef | undefined;
    const span = (status: SpanRecord["status"], code?: string): void => {
      deps.onSpan?.({ traceId, spanId: trace.spanId, parent: trace.parent, name: "invoke", cap: capName, startedAt: t0, ms: now() - t0, status, code });
    };
    try {
      // 1 resolve
      cap = deps.caps.get(capName, seed.v);
      if (!cap) throw fail("validation.unknown_capability", traceId, { message: "There is no such capability.", details: { cap: capName, v: seed.v ?? null } });
      const c = cap;
      const depth = seed.depth ?? 0;
      if (depth >= MAX_DEPTH) throw fail("validation.precondition_failed", traceId, { message: "Calls nest too deeply.", details: { depth, limit: MAX_DEPTH } });

      // 2 validate
      const problems = deps.validateInput(c.name, c.v, input);
      if (problems.length) throw fail("validation.bad_input", traceId, { details: { errors: problems.slice(0, 20), cap: c.name } });

      // 3 idempotency: a 'key' capability requires the key; the stored result of a repeat is returned without running anything
      let key: string | undefined;
      if (c.idempotency === "key") {
        const k = (input as { idempotencyKey?: unknown } | null)?.idempotencyKey;
        if (typeof k !== "string" || k.length === 0) throw fail("validation.bad_input", traceId, { details: { errors: ["/idempotencyKey: required"], cap: c.name } });
        key = seed.approval ? `${k}:approved` : k;
      }
      const run = (): Promise<InvokeResult> => stepsFour(c, input, seed, trace, depth);
      const result = key !== undefined && deps.idem ? await deps.idem.once(seed.principal.id, c.name, key, input, run) : await run();
      span(result.status === "held" ? "held" : "ok");
      return { ...result, traceId };
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === "idem_conflict") e = fail("validation.precondition_failed", traceId, { message: "That key was already used with different input.", details: { reason: "idempotency_conflict", cap: capName } });
      const { error, unexpected } = toVyreError(e, traceId);
      if (unexpected) log.error("handler threw", { cap: capName, traceId, stack: e instanceof Error ? e.stack : String(e) });
      span(error.code.startsWith("permission.") ? "denied" : "error", error.code);
      log.info("invoke", { cap: capName, traceId, status: error.code });
      throw new HostError(error);
    }
  };

  // 4 rate limit, 5 authorize and Gate, 6 handler, 7 commit, 8 publish
  async function stepsFour(c: CapabilityDef, input: unknown, seed: CtxSeed, trace: TraceContext, depth: number): Promise<InvokeResult> {
    const traceId = trace.traceId, t = now();
    if (c.rate && deps.rate) {
      const k = c.rate.scope === "space" ? `space:${seed.space}:${c.name}` : `${seed.principal.id}:${c.name}`;
      if (!deps.rate.take(k, c.rate, t)) throw fail("rate_limit.exceeded", traceId, { details: { cap: c.name, perSeconds: c.rate.perSeconds } });
    }

    let resource: ResourceRef | null = null;
    let kd: KernelDecision | null = null;
    let fallbackId: string | null = null;
    const did = (): string => (kd ? kd.decisionId : (fallbackId ??= mintId("dec", t)));   // minted only when an audit row or a parked task needs it
    let approved = false;
    if (!seed.preAuth) {
      try { resource = resolveResource(c, input, seed.space, deps.resolveItem); }
      catch (e) {
        if (e instanceof BindingError) throw fail("validation.bad_input", traceId, { details: { errors: [`${e.pointer}: ${e.message}`], cap: c.name } });
        throw e;
      }
      approved = seed.approval !== undefined && deps.gate !== undefined && deps.gate.verify(seed.approval, { cap: c, input, seed });
      const req: AuthReq = {
        principal: seed.principal.id, actingFor: seed.actingFor,
        action: { perm: c.permission, level: c.level, destructive: DESTRUCTIVE.test(c.name) },
        resource, provider: seed.provider, cap: c.name, input, spendMicros: deps.spend?.(seed.principal.id), approved, now: t,
      };
      const d = deps.authorize(req);
      kd = d;
      const audit = (cls: AuditRow["class"], reason: string): AuditRow => ({
        class: cls, cap: c.name, v: c.v, principal: seed.principal.id, actingFor: seed.actingFor, decisionId: d.decisionId, reason,
        resource, traceId, spanId: trace.spanId, at: t, risk: c.risk,
      });
      if (d.effect === "deny") {
        await deps.audit?.(audit("deny", d.reason));
        const code = codeForReason(d.reason);
        throw fail(code, traceId, { details: { cap: c.name, reason: d.reason, steps: d.steps.map((s) => s.text) } });
      }
      if (d.effect === "hold") {
        const g = d.obligations.find((o) => o.type === "gate");
        return park(c, input, seed, traceId, d.decisionId, g && g.type === "gate" ? g.act : (c.gate?.act ?? "approve"), audit("hold", d.reason));
      }
    }
    // the capability's own Gate (spec 2.14): fail closed when a Gate is declared and nothing can park the call
    if (c.gate && c.gate.act !== "none" && !approved) {
      if (!deps.gate) throw fail("internal.unavailable", traceId, { message: "Approvals are not available right now.", details: { cap: c.name, act: c.gate.act } });
      const g = deps.gate.applies(c, input, seed);
      if (g) {
        return park(c, input, seed, traceId, did(), g.act, null);
      }
    }

    // 6 handler, with a ctx whose emit buffers events for the one commit
    const h = deps.handler(c.name, c.v);
    if (!h) throw fail("internal.not_implemented", traceId, { details: { cap: c.name } });
    const events: EventEnvelope[] = [];
    const ctx = makeCtx(c, seed, trace, depth, events);
    const output = await h(ctx, input);   // a throw here is mapped by the outer catch: VyreErr and HostError keep their code, anything else is internal.unexpected

    // 7 commit: events, inline projections and the audit row land together
    const auditRow: AuditRow | null = shouldAudit(c)
      ? { class: "allow", cap: c.name, v: c.v, principal: seed.principal.id, actingFor: seed.actingFor, decisionId: did(), reason: "ok", resource, traceId, spanId: trace.spanId, at: t, risk: c.risk }
      : null;
    let stored = events;
    if (events.length || auditRow) stored = await deps.commit({ cap: c.name, v: c.v, principal: seed.principal.id, events, audit: auditRow });
    // 8 publish after commit
    if (stored.length) deps.publish?.(stored);
    return { status: "ok", output, traceId };
  }

  async function park(c: CapabilityDef, input: unknown, seed: CtxSeed, traceId: string, decisionId: string, act: string, row: AuditRow | null): Promise<InvokeResult> {
    if (!deps.gate) throw fail("internal.unavailable", traceId, { message: "Approvals are not available right now.", details: { cap: c.name } });
    if (row) await deps.audit?.(row);
    const p = await deps.gate.park({ cap: c, input, seed, act, decisionId, traceId });
    return { status: "held", taskId: p.taskId, runId: p.runId, traceId };
  }

  const shouldAudit = (c: CapabilityDef): boolean => c.audit === "always" || (c.audit === "sensitive" && c.risk !== "low");

  function makeCtx(c: CapabilityDef, seed: CtxSeed, trace: TraceContext, depth: number, buf: EventEnvelope[]): Ctx {
    const svc = deps.services?.(seed, c) ?? {};
    const unavailable = (what: string) => (): never => { throw fail("internal.not_implemented", trace.traceId, { details: { service: what, cap: c.name } }); };
    const ctx: Ctx = {
      space: seed.space, principal: seed.principal, ...(seed.actingFor ? { actingFor: seed.actingFor } : {}), trace,
      ...(seed.run ? { run: seed.run } : {}), ...(seed.thread ? { thread: seed.thread } : {}), origin: seed.origin ?? "user", depth,
      ...(seed.device ? { device: seed.device } : {}), now,
      db: svc.db ?? { all: unavailable("db"), run: unavailable("db") },
      emit<T>(name: EventName, subject: string, payload: T, opts?: EmitOpts): EventEnvelope<T> {
        if (!c.emits.includes(name)) throw fail("internal.unexpected", trace.traceId, { message: "Something went wrong on our side.", details: { cap: c.name, event: name, why: "event not declared in emits" } });
        const bad = deps.validateEvent?.(name, payload);
        if (bad?.length) throw fail("internal.unexpected", trace.traceId, { message: "Something went wrong on our side.", details: { cap: c.name, event: name, errors: bad.slice(0, 5) } });
        const parts = subject.split("/").filter(Boolean);
        const ev: EventEnvelope<T> = {
          seq: 0, id: mintEventId(now()), type: name, sv: 1, hlc: nextHlc(), at: now(), traceId: trace.traceId, spanId: trace.spanId,
          actor: seed.principal.id, ...(seed.actingFor ? { onBehalf: seed.actingFor } : {}), ...(seed.device ? { device: seed.device } : {}),
          ...(seed.run ? { runId: seed.run } : {}), ...(opts?.cause ? { cause: opts.cause } : {}), origin: seed.origin ?? "user", depth,
          entity: parts.length > 1 ? parts[parts.length - 2]! : subject, ...(parts.length > 1 ? { entityId: parts[parts.length - 1]! } : {}),
          label: 0, vis: opts?.vis ?? "space", enc: 0, payload,
        };
        buf.push(ev as EventEnvelope);
        return ev;
      },
      async call<C extends CapName>(name: C, callInput: unknown): Promise<unknown> {
        const cleared = c.gate && c.gate.act !== "none" ? [...(seed.clearedActs ?? []), c.gate.act] : seed.clearedActs;
        const r = await invoke(name, callInput, { ...seed, depth: depth + 1, trace, approval: undefined, v: undefined, clearedActs: cleared });
        if (r.status === "held") throw fail("permission.needs_approval", trace.traceId, { details: { taskId: r.taskId, cap: name } });
        return r.output;
      },
      authorize(action, resource): Decision {
        const d = deps.authorize({ principal: seed.principal.id, actingFor: seed.actingFor, action, resource, provider: seed.provider, now: now() });
        return { effect: d.effect, reason: d.reason, decisionId: d.decisionId };
      },
      vault: svc.vault ?? { fill: unavailable("vault"), use: unavailable("vault") },
      http: svc.http ?? unavailable("http"),
      log,
      schedule: svc.schedule ?? unavailable("schedule"),
      seal: svc.seal ?? { seal: unavailable("seal"), unseal: unavailable("seal") },
    };
    return ctx;
  }

  return invoke;
}

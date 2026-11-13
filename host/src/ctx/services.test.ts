// The host services through the real invoke pipeline: a handler seals a value and schedules a later call, the queue runs that call as the same principal on the same trace.
import test from "node:test";
import assert from "node:assert/strict";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import { createInvoke, indexCapabilities } from "../invoke.ts";
import type { CtxSeed, Handler, InvokeDeps } from "../invoke.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { createCtxSeal } from "./seal.ts";
import { ScheduleQueue } from "./schedule.ts";
import { hostServices, invokeRunner } from "./services.ts";

const cap = (name: string): CapabilityDef =>
  ({
    name,
    v: 1,
    summary: "s",
    input: { type: "object" },
    output: { type: "object" },
    errors: [],
    resource: { type: "record", id: "/id" },
    permission: "records.edit",
    level: "edit",
    risk: "low",
    effects: "write",
    emits: [],
    idempotency: "natural",
    surfaces: {},
    examples: [],
  }) as unknown as CapabilityDef;

const enc = new TextEncoder();
const dec = new TextDecoder();
const TRACE = "d".repeat(32);
const seed: CtxSeed = {
  space: "spc_1",
  principal: { kind: "person", id: "usr_dana" },
  trace: { traceId: TRACE, spanId: "e".repeat(16) },
};

function rig(extra: Partial<Parameters<typeof hostServices>[0]> = {}) {
  const clock = { t: 1_760_000_000_000 };
  const db = openRecordStore({ path: ":memory:", space: "sp_svc" }).host.tx;
  const seal = createCtxSeal({ key: "0123456789abcdef0123456789abcdef", keyId: "k1" });
  const later: { principal: string; origin: string; trace: string; input: unknown }[] = [];
  const ranDuring: number[] = [];
  const handlers: Record<string, Handler> = {
    "demo.seal": async (ctx: Ctx) => {
      const sealed = ctx.seal.seal(enc.encode("secret"), "demo");
      const id = await ctx.schedule("+1m", "demo.later", { id: "rec_1", n: 7 });
      return { back: dec.decode(ctx.seal.unseal(sealed)), keyId: sealed.keyId, id };
    },
    "demo.later": (ctx: Ctx, input: unknown) => {
      later.push({ principal: ctx.principal.id, origin: ctx.origin, trace: ctx.trace.traceId, input });
      return {};
    },
    // schedules a job that is due now, then lets the queue tick while this call is still open (a tick of the real daemon can land there)
    "demo.mid": async (ctx: Ctx) => {
      await ctx.schedule(clock.t, "demo.later", { id: "mid" });
      ranDuring.push(await queue.tick());
      return {};
    },
    "demo.mid_fail": async (ctx: Ctx) => {
      await ctx.schedule(clock.t, "demo.later", { id: "mid_fail" });
      throw new Error("the call failed after it asked for a job");
    },
    "demo.plain": (ctx: Ctx) => ({ sealIsFn: typeof ctx.seal.seal, dbIs: typeof ctx.db.all }),
    "demo.vault": async (ctx: Ctx) => {
      await ctx.vault.fill("#x", { kind: "k", ref: "r" });
      return {};
    },
  };
  const queue = new ScheduleQueue({
    db,
    now: () => clock.t,
    run: async (c) => {
      await runner(c);
    },
  });
  const services = hostServices({
    base: () => ({ db: { all: () => [], run: () => ({ changes: 0 }) } }),
    seal,
    queue,
    ...extra,
  });
  const deps: InvokeDeps = {
    caps: indexCapabilities(Object.keys(handlers).map(cap)),
    validateInput: () => [],
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_1" }) as never,
    handler: (c) => handlers[c],
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    services,
  };
  const invoke = createInvoke(deps);
  const runner = invokeRunner(invoke);
  return { clock, queue, invoke, later, services, ranDuring };
}

test("ctx.seal and ctx.schedule reach a handler through the pipeline", async () => {
  const r = rig();
  const res = await r.invoke("demo.seal", { id: "rec_1" }, seed);
  assert.equal(res.status, "ok");
  const out = (res as { output: { back: string; keyId: string; id: string } }).output;
  assert.equal(out.back, "secret");
  assert.equal(out.keyId, "k1/demo");
  assert.match(out.id, /^sch_/);
  assert.equal(r.queue.counts().pending, 1);
});

test("the scheduled call runs once the time comes, as the same principal, on the same trace", async () => {
  const r = rig();
  const first = await r.invoke("demo.seal", { id: "rec_1" }, seed);
  assert.equal(await r.queue.tick(), 0, "not due yet");
  assert.equal(r.later.length, 0);
  r.clock.t += 60_000;
  assert.equal(await r.queue.tick(), 1);
  assert.equal(r.later.length, 1);
  assert.deepEqual(r.later[0]!.input, { id: "rec_1", n: 7 });
  assert.equal(r.later[0]!.principal, "usr_dana");
  assert.equal(r.later[0]!.origin, "schedule");
  assert.equal(first.traceId, TRACE);
  assert.equal(r.later[0]!.trace, TRACE);
  assert.deepEqual(r.queue.counts(), { pending: 0, dead: 0 });
});

test("a top-level call that started no trace schedules without one, and the run gets a fresh trace", async () => {
  const r = rig();
  const { trace: _t, ...bare } = seed;
  const first = await r.invoke("demo.seal", { id: "rec_1" }, bare);
  r.clock.t += 60_000;
  assert.equal(await r.queue.tick(), 1);
  assert.match(r.later[0]!.trace, /^[0-9a-f]{32}$/);
  assert.notEqual(r.later[0]!.trace, first.traceId);
});

test("the loader's own services (ctx.db) are kept next to the host's", async () => {
  const r = rig();
  const res = await r.invoke("demo.plain", { id: "rec_1" }, seed);
  assert.deepEqual((res as { output: unknown }).output, { sealIsFn: "function", dbIs: "function" });
});

test("ctx.vault refuses until a Vault is given, and is the Vault's once it is", async () => {
  const none = rig();
  await assert.rejects(
    none.invoke("demo.vault", { id: "rec_1" }, seed),
    (e: unknown) => (e as { error?: { code?: string } }).error?.code === "internal.not_implemented",
  );
  const filled: string[] = [];
  const withVault = rig({
    vault: () => ({
      fill: async (h: string) => {
        filled.push(h);
      },
      use: (h: string) => ({ handle: h }),
    }),
  });
  await withVault.invoke("demo.vault", { id: "rec_1" }, seed);
  assert.deepEqual(filled, ["#x"]);
});

// P-H_01 final run: each named test shows its own ok line in the run on the last commit.

// 13 Nov 2026 (crm.journey1 failed on CI twice on an unchanged commit): the first pull of a synced app is scheduled inside the call that makes the connection. A tick that landed before that call
// committed ran the pull as a stranger to a connection that did not exist yet (permission.not_found), the Run failed, and one type of the person's CRM stayed empty until the next poll.
test("a job scheduled inside a call does not run until that call has committed", async () => {
  const r = rig();
  const res = await r.invoke("demo.mid", { id: "rec_1" }, seed);
  assert.equal(res.status, "ok");
  assert.deepEqual(r.ranDuring, [0], "a tick while the call was still open ran nothing");
  assert.equal(r.later.length, 0, "the job has not run yet");
  assert.equal(await r.queue.tick(), 1, "once the call has committed the job is due");
  assert.deepEqual(r.later[0]!.input, { id: "mid" });
  assert.equal(r.later[0]!.principal, "usr_dana");
});

test("a job scheduled by a call that then failed is never run", async () => {
  const r = rig();
  await assert.rejects(r.invoke("demo.mid_fail", { id: "rec_1" }, seed));
  assert.equal(await r.queue.tick(), 0);
  r.clock.t += 10 * 60_000;
  assert.equal(await r.queue.tick(), 0, "nor later");
  assert.equal(r.later.length, 0);
});

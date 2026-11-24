// The Gate sees the call's own trace: what it notes for a handler (the Gate's note of files, a person's yes) is found by a trace both sides see. For a top-level call that came with no trace, and for a nested call, the seed the Gate is
// handed (applies, verify, seen, park) carries the same trace id as the handler's ctx.trace, and the span the park records is the call's own.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = (name: string, gated: boolean): CapabilityDef =>
  ({
    v: 1,
    name,
    summary: "s",
    input: { type: "object" },
    output: { type: "object" },
    errors: [],
    resource: { type: "space" },
    permission: null,
    level: "view",
    risk: "low",
    effects: "write",
    emits: [],
    idempotency: "natural",
    surfaces: {},
    examples: [],
    ...(gated ? { gate: { act: "send" } } : {}),
  }) as unknown as CapabilityDef;

function rig(hold: boolean) {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const seen: { where: string; cap: string; trace: { traceId: string; spanId: string } | undefined }[] = [];
  const handled: { cap: string; trace: { traceId: string; spanId: string } }[] = [];
  const gate = {
    applies: async (c: CapabilityDef, _i: unknown, seed: CtxSeed) => (
      seen.push({ where: "applies", cap: c.name, trace: seed.trace }),
      hold ? { act: "send" } : null
    ),
    verify: (_t: string, a: { cap: CapabilityDef; seed: CtxSeed }) => (
      seen.push({ where: "verify", cap: a.cap.name, trace: a.seed.trace }),
      true
    ),
    seen: async (c: CapabilityDef, _i: unknown, _o: unknown, seed: CtxSeed) =>
      void seen.push({ where: "seen", cap: c.name, trace: seed.trace }),
    park: async (a: { cap: CapabilityDef; seed: CtxSeed }) => (
      seen.push({ where: "park", cap: a.cap.name, trace: a.seed.trace }),
      { taskId: "tsk_1" }
    ),
  };
  const deps = {
    caps: indexCapabilities([cap("example.outer", true), cap("example.inner", true)]),
    validateInput: () => [],
    authorize: (req: Parameters<InvokeDeps["authorize"]>[0]) => authorize(s, req),
    handler:
      (name: string) =>
      async (ctx: { trace: { traceId: string; spanId: string }; call: (c: never, i: unknown) => Promise<unknown> }) => {
        handled.push({ cap: name, trace: ctx.trace });
        if (name === "example.outer") await ctx.call("example.inner" as never, {});
        return {};
      },
    commit: async (b: { events: unknown[] }) => b.events.map((e, i) => ({ ...(e as object), seq: i + 1 })),
    publish: () => {},
    now: () => 1_000,
    gate,
  } as unknown as InvokeDeps;
  return { invoke: createInvoke(deps), seen, handled };
}
const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };

test("the Gate and the handler share the trace id for a top-level call that came with no trace, and for the call it makes", async () => {
  const r = rig(false);
  await r.invoke("example.outer", {}, seed);
  const outer = r.handled.find((h) => h.cap === "example.outer")!;
  const inner = r.handled.find((h) => h.cap === "example.inner")!;
  assert.match(outer.trace.traceId, /^[0-9a-f]{32}$/);
  assert.equal(inner.trace.traceId, outer.trace.traceId, "a nested call is on the same trace");
  const outerSeen = r.seen.filter((x) => x.cap === "example.outer");
  const innerSeen = r.seen.filter((x) => x.cap === "example.inner");
  assert.deepEqual(outerSeen.map((x) => x.where).sort(), ["applies", "seen"], "the Gate was asked and was told");
  assert.deepEqual(
    innerSeen.map((x) => x.where),
    ["applies"],
    "and was asked for the nested call",
  );
  for (const x of [...outerSeen, ...innerSeen])
    assert.equal(x.trace?.traceId, outer.trace.traceId, `${x.cap} ${x.where}`);
  // the Gate is handed the call's own span, the one the handler runs on
  assert.equal(outerSeen.find((x) => x.where === "applies")!.trace!.spanId, outer.trace.spanId);
});

test("a call that arrives with a trace keeps it for the Gate and the handler", async () => {
  const r = rig(false);
  const given = { traceId: "ab".repeat(16), spanId: "cd".repeat(8) };
  await r.invoke("example.outer", {}, { ...seed, trace: given });
  const outer = r.handled.find((h) => h.cap === "example.outer")!;
  assert.equal(outer.trace.traceId, given.traceId);
  for (const x of r.seen.filter((y) => y.cap === "example.outer"))
    assert.equal(x.trace?.traceId, given.traceId, x.where);
});

test("a held call is parked with its own trace id and a real span, not the zeros a call with no parent used to get", async () => {
  const r = rig(true);
  const res = await r.invoke("example.outer", {}, seed);
  assert.equal((res as { status: string }).status, "held");
  const parked = r.seen.find((x) => x.where === "park")!;
  assert.match(parked.trace!.traceId, /^[0-9a-f]{32}$/);
  assert.match(parked.trace!.spanId, /^[0-9a-f]{16}$/);
  assert.notEqual(parked.trace!.spanId, "0".repeat(16));
  assert.equal(r.handled.length, 0, "nothing ran");
});

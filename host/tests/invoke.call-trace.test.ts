// CallOpts.traceId: a nested ctx.call runs on the trace it names when that is a real trace id (32 lowercase hex, not all zeros); anything else is ignored and the parent's trace is kept.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = (name: string): CapabilityDef => ({
  v: 1, name, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "view",
  risk: "low", effects: "read", emits: [], idempotency: "natural", surfaces: {}, examples: [],
} as unknown as CapabilityDef);

/** The trace the inner call ran on, and the trace of the outer call, when the outer asks for `want`. */
async function run(want: string | undefined): Promise<{ outer: string; inner: string }> {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  let inner = "", outer = "";
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap("example.outer"), cap("example.inner")]),
    validateInput: () => [],
    authorize: (req) => authorize(s, req),
    handler: (name: string) => async (ctx) => {
      if (name === "example.inner") { inner = ctx.trace.traceId; return {}; }
      outer = ctx.trace.traceId;
      await ctx.call("example.inner" as never, {}, want === undefined ? undefined : { traceId: want });
      return {};
    },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    publish: () => {},
    now: () => 1_000,
  };
  const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };
  await createInvoke(deps)("example.outer", {}, seed);
  return { outer, inner };
}

test("a nested call with a valid traceId runs on that trace", async () => {
  const want = "ab".repeat(16);
  const r = await run(want);
  assert.equal(r.inner, want);
  assert.notEqual(r.outer, want, "the outer call keeps its own trace");
});

test("no traceId keeps the parent's trace", async () => {
  const r = await run(undefined);
  assert.equal(r.inner, r.outer);
});

test("a traceId of the wrong length, in uppercase, or all zeros is ignored", async () => {
  for (const bad of ["abc123", "AB".repeat(16), "0".repeat(32), "ab".repeat(17)]) {
    const r = await run(bad);
    assert.equal(r.inner, r.outer, `${bad} keeps the parent's trace`);
  }
});

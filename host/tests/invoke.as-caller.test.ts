// CallOpts.asCaller: a module that forwards a capability someone else chose (a stored schedule, a template's step) makes that call with the asker's own standing, not as module code.
// The called capability sees ctx.forwarded, so a check that trusts a call one level down (notifications.send's system kinds) does not trust it; the call after that is ordinary again.
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

test("a call made asCaller is marked forwarded for the capability it reaches, and only that one", async () => {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const seen: Record<string, unknown> = {};
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap("example.outer"), cap("example.inner"), cap("example.deeper"), cap("example.plain")]),
    validateInput: () => [],
    authorize: (req) => authorize(s, req),
    handler: (name: string) => async (ctx) => {
      seen[name] = (ctx as { forwarded?: boolean }).forwarded === true;
      if (name === "example.outer") { await ctx.call("example.inner" as never, {}, { asCaller: true } as never); await ctx.call("example.plain" as never, {}); }
      if (name === "example.inner") await ctx.call("example.deeper" as never, {});
      return {};
    },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    publish: () => {},
    now: () => 1_000,
  };
  const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };
  await createInvoke(deps)("example.outer", {}, seed);
  assert.deepEqual(seen, { "example.outer": false, "example.inner": true, "example.deeper": false, "example.plain": false });
});

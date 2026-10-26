// EmitOpts.afterFailure (P-GF_06): an event a handler marks afterFailure is written even when the call ends in an error; the other events the call buffered are not. A call that succeeds
// commits all of them in one batch, as before.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = (emits: string[]): CapabilityDef => ({
  v: 1, name: "example.try", summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "view",
  risk: "low", effects: "write", emits, idempotency: "natural", surfaces: {}, examples: [],
} as unknown as CapabilityDef);

function world(fails: boolean) {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const batches: string[][] = [], published: string[][] = [];
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap(["example.failed", "example.note"])]),
    validateInput: () => [],
    authorize: (req) => authorize(s, req),
    handler: () => async (ctx) => {
      ctx.emit("example.note" as never, "entity/a", { n: 1 });
      ctx.emit("example.failed" as never, "entity/a", { n: 2 }, { afterFailure: true });
      if (fails) throw new Error("refused");
      return { ok: true };
    },
    commit: async (b) => { batches.push(b.events.map((e) => e.type)); return b.events.map((e, i) => ({ ...e, seq: i + 1 })); },
    publish: (events) => { published.push(events.map((e) => e.type)); },
    now: () => 1_000,
  };
  return { invoke: createInvoke(deps), batches, published };
}
const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };

test("a refused call still writes its afterFailure event and nothing else it buffered, and the error reaches the caller", async () => {
  const w = world(true);
  await assert.rejects(() => w.invoke("example.try", {}, seed), (e: unknown) => e instanceof HostError);
  assert.deepEqual(w.batches, [["example.failed"]]);
  assert.deepEqual(w.published, [["example.failed"]], "and it is published like any committed event");
});

test("a call that succeeds commits every event in one batch", async () => {
  const w = world(false);
  const r = await w.invoke("example.try", {}, seed);
  assert.equal(r.status, "ok");
  assert.deepEqual(w.batches, [["example.note", "example.failed"]]);
});

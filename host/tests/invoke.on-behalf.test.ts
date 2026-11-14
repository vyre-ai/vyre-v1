// EmitOpts.onBehalf: only the host service may make an event on a person's behalf (a mute that ended, a sweep); the event then carries that person as `onBehalf`, so a private event reaches them.
// Anyone else who asks is refused, so no module can write something into another person's private stream.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = {
  v: 1,
  name: "example.try",
  summary: "s",
  input: { type: "object" },
  output: { type: "object" },
  errors: [],
  resource: { type: "space" },
  permission: null,
  level: "view",
  risk: "low",
  effects: "write",
  emits: ["example.note"],
  idempotency: "natural",
  surfaces: {},
  examples: [],
} as unknown as CapabilityDef;

function world() {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const written: { onBehalf?: string | undefined; vis: string }[] = [];
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap]),
    validateInput: () => [],
    authorize: (req) => authorize(s, req),
    handler: () => async (ctx) => {
      ctx.emit("example.note" as never, "entity/a", { n: 1 }, { vis: "private", onBehalf: "usr_maya" });
      return { ok: true };
    },
    commit: async (b) => {
      for (const e of b.events) written.push({ onBehalf: e.onBehalf, vis: e.vis });
      return b.events.map((e, i) => ({ ...e, seq: i + 1 }));
    },
    publish: () => undefined,
    now: () => 1_000,
  };
  return { invoke: createInvoke(deps), written };
}

test("the host service makes an event on a person's behalf, and the person reads it as their own", async () => {
  const w = world();
  const seed: CtxSeed = { space: "spc_1", principal: { kind: "service", id: "svc_host" }, preAuth: true };
  const r = await w.invoke("example.try", {}, seed);
  assert.equal(r.status, "ok");
  assert.deepEqual(w.written, [{ onBehalf: "usr_maya", vis: "private" }]);
});

test("a person, or any other caller, may not make an event on someone else's behalf", async () => {
  const w = world();
  await assert.rejects(
    () => w.invoke("example.try", {}, { space: "spc_1", principal: { kind: "person", id: "usr_dana" } }),
    (e: unknown) => e instanceof HostError,
  );
  assert.deepEqual(w.written, []);
});

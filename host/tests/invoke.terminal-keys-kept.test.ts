// What idempotency keeps of a terminal.keys call (15 Nov, review of c73831547): the copy it stores holds {ok} only, never the screen, and the stored input leaves the typed text out. The wiring in `invoke` is held
// here, not only by the docker walk: a build that stopped passing the filter or the trimmed input would fail this file.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = (name: string): CapabilityDef =>
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
    idempotency: "key",
    surfaces: {},
    examples: [],
  }) as unknown as CapabilityDef;

function world(name: string) {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const seen: Array<{ input: unknown; kept: unknown }> = [];
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap(name)]),
    validateInput: () => [],
    authorize: (req) => authorize(s, req),
    handler: () => async () => ({ ok: true, screen: { text: "TOKEN=sk-live-SECRET" } }),
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    idem: {
      once: async (_p, _c, _k, input, run, keep) => {
        const result = await run();
        seen.push({ input, kept: keep ? keep(result) : result });
        return result;
      },
    },
    now: () => 1_000,
  };
  return { invoke: createInvoke(deps), seen };
}
const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };

test("terminal.keys: the idempotency copy has no screen and the stored input has no typed text; the caller still gets the screen", async () => {
  const w = world("terminal.keys");
  const r = await w.invoke(
    "terminal.keys",
    { idempotencyKey: "k1", terminalId: "trm_1", lease: "lse_1", seq: 1, keys: [{ text: "cat .env" }] },
    seed,
  );
  assert.ok(JSON.stringify(r).includes("SECRET"), "the person gets the screen");
  const stored = JSON.stringify(w.seen[0]);
  assert.ok(!stored.includes("SECRET"), "no screen in the kept copy");
  assert.ok(!stored.includes("cat .env"), "no typed text in the stored input");
});

test("another capability keeps its whole answer (the filter is for terminal.keys alone)", async () => {
  const w = world("example.try");
  await w.invoke("example.try", { idempotencyKey: "k1", keys: [{ text: "visible" }] }, seed);
  assert.ok(JSON.stringify(w.seen[0]).includes("SECRET") && JSON.stringify(w.seen[0]).includes("visible"));
});

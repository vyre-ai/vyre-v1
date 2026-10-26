// P-L4_LIVE: a capability's `when` that names a module function (git.push: git.is_protected(input.branch)) is answered by that module, not read as an unknown expression that always holds.
import test from "node:test";
import assert from "node:assert/strict";
import { createGateHook } from "../src/daemon/gate-hook.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const push = { name: "git.push", v: 1, gate: { act: "push_protected", when: "git.is_protected(input.branch)" } } as unknown as CapabilityDef;
const seed = { principal: { kind: "person" as const, id: "usr_noah" } } as never;

function hook(evaluators?: Parameters<typeof createGateHook>[0]["evaluators"]) {
  return createGateHook({
    call: async (cap) => (cap === "gate.effective_rule" ? { hold: true } : null),
    unseal: () => new Uint8Array(), now: () => 0, hold: () => null,
    ...(evaluators ? { evaluators } : {}),
  });
}

test("gate when: the module's answer decides whether the Gate asks", async () => {
  const h = hook({ "git.is_protected": (input) => (input as { branch?: string }).branch === "main" });
  assert.deepEqual(await h.applies(push, { folderId: "fld_a", branch: "main" }, seed), { act: "push_protected" }, "a protected branch is held");
  assert.equal(await h.applies(push, { folderId: "fld_a", branch: "topic" }, seed), null, "an unprotected branch goes through");
});

test("gate when: an evaluator that throws, or none registered, counts as holding", async () => {
  const boom = hook({ "git.is_protected": () => { throw new Error("no repository"); } });
  assert.deepEqual(await boom.applies(push, { folderId: "fld_a" }, seed), { act: "push_protected" });
  assert.deepEqual(await hook().applies(push, { folderId: "fld_a", branch: "topic" }, seed), { act: "push_protected" });
});

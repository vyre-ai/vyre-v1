// The Gate wrapper's rule for the host's own follow-ups (lane r42-email-in): mail.delivery.retry is refused to anyone but the host service BEFORE the Gate is asked (an agent's call
// would otherwise be parked as an approval task), the host's own scheduled call is not asked again, and every other call is the inner hook's answer.
import test from "node:test";
import assert from "node:assert/strict";
import { HostError } from "../routes/errors.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import type { CtxSeed, GateHook } from "../invoke.ts";
import { withGateNesting } from "./gate-nesting.ts";

const retry = { name: "mail.delivery.retry", gate: { act: "send" } } as unknown as CapabilityDef;
const send = { name: "mail.send", gate: { act: "send" } } as unknown as CapabilityDef;
const asked: string[] = [];
const inner: GateHook = {
  applies: (c) => {
    asked.push(c.name);
    return { act: "send" };
  },
  park: async () => ({ taskId: "tsk_x", holdId: "hld_x" }) as never,
  verify: async () => true as never,
};
const hook = withGateNesting(inner);
const seed = (o: Partial<CtxSeed>): CtxSeed => ({ space: "spc_1", principal: { kind: "person", id: "usr_a" }, ...o }) as CtxSeed;

test("a person, an agent, an actor or another service calling the retry is refused and the Gate is never asked", async () => {
  for (const principal of [{ kind: "person", id: "usr_a" }, { kind: "agent", id: "agt_a" }, { kind: "actor", id: "act_a" }, { kind: "service", id: "svc_flow" }] as const) {
    asked.length = 0;
    await assert.rejects(async () => hook.applies(retry, {}, seed({ principal })), (e) => e instanceof HostError && e.error.code === "permission.no_grant");
    assert.deepEqual(asked, [], "no hold, so no approval task");
  }
});

test("the host's own scheduled retry passes without a question; the host calling it any other way, or another capability, is the inner hook's", async () => {
  asked.length = 0;
  assert.equal(await hook.applies(retry, {}, seed({ principal: { kind: "service", id: "svc_host" }, preAuth: true, origin: "schedule" })), null);
  assert.deepEqual(asked, []);
  assert.deepEqual(await hook.applies(retry, {}, seed({ principal: { kind: "service", id: "svc_host" } })), { act: "send" });
  assert.deepEqual(await hook.applies(send, {}, seed({ principal: { kind: "agent", id: "agt_a" } })), { act: "send" });
  assert.deepEqual(asked, ["mail.delivery.retry", "mail.send"]);
});

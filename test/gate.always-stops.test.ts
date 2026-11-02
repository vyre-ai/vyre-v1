// The Gate hook against the real rule: connection_change and signin_change stop from a chat in Auto, an agent with an Always allow, a task, and a step of an automation that runs as its owner. A person pressing the button is the one thing that goes.
import test from "node:test";
import assert from "node:assert/strict";
import { createGateHook } from "../host/src/daemon/gate-hook.ts";
import { harness } from "../modules/gate/fixtures/db.ts";
import { effectiveRule } from "../modules/gate/impl.ts";
import type { CapabilityDef } from "../packages/contracts/src/types.ts";
import { registry } from "../generated/registry.ts";

const gated = (act: string) => ({ name: "x.change", v: 1, gate: { act, when: "actor.kind != 'person'" } }) as unknown as CapabilityDef;
const step = { automationId: "aut_1", nodeId: "n", defHash: "h" };

function hook() {
  const taken: unknown[] = [];
  const gate = harness();
  const h = createGateHook({
    call: async (cap, i) => {
      const input = i as { principal?: { kind: "person" | "agent" | "service"; id: string }; act?: string; adminOnly?: boolean };
      if (cap === "gate.effective_rule") return effectiveRule(gate.db, input.principal!, input.act!, undefined, input.adminOnly === true);
      if (cap === "gate.grants.take") { taken.push(i); return { granted: true }; }
      return null;
    },
    unseal: () => new Uint8Array(), now: () => 0, hold: () => null, threads: (id) => [id],
  });
  return { h, taken };
}

for (const act of ["connection_change", "signin_change"]) {
  test(`${act} stops in every mode and from a task or an automation`, async () => {
    const seeds = {
      "Auto, the person asked for it": { principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_noah", thread: "thr_1", chatMode: "auto" },
      "Ask first": { principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_noah", thread: "thr_1", chatMode: "ask" },
      "a task": { principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_noah", run: "run_1" },
      "an automation running as its owner": { principal: { kind: "person", id: "usr_noah" }, step },
      "an automation set not to ask": { principal: { kind: "person", id: "usr_noah" }, step, gateMode: "admin_only" },
      "a Space automation": { principal: { kind: "service", id: `svc_${"a".repeat(32)}` } },
    };
    for (const [where, seed] of Object.entries(seeds)) {
      const { h, taken } = hook();
      assert.deepEqual(await h.applies(gated(act), {}, seed as never), { act }, where);
      assert.deepEqual(taken, [], `${where}: no grant is even looked at`);
    }
  });

  test(`${act}: a person pressing it themselves goes through`, async () => {
    assert.equal(await hook().h.applies(gated(act), {}, { principal: { kind: "person", id: "usr_noah" } } as never), null);
  });
}

test("every capability that changes the company or how people sign in declares the act", () => {
  const latest = (name: string) => registry.capabilities.filter((c) => c.name === name).sort((a, b) => b.v - a.v)[0];
  const connection = ["google.dwd.setup", "google.dwd.set_excluded", "google.dwd.map_member", "google.dwd.disable", "google.dwd.sync_members", "google.dwd.set_data", "google.dwd.connect_all", "google.user.app_set",
    "ms.consent.setup", "ms.consent.set_excluded", "ms.consent.map_member", "ms.consent.disable", "ms.consent.sync_members", "ms.consent.set_data", "ms.consent.connect_all", "ms.user.app_set", "company.connect", "company.disconnect"];
  for (const cap of connection) assert.equal(latest(cap)?.gate?.act, "connection_change", cap);
  for (const cap of ["members.sso.set", "members.sso.remove", "members.sign_in_policy.set", "members.sign_in_github.set", "members.sign_in_github.clear"]) assert.equal(latest(cap)?.gate?.act, "signin_change", cap);
});

test("sending as a person follows the outward rule: every send declares it, and a person's own click is the only thing that skips it", () => {
  const latest = (name: string) => registry.capabilities.filter((c) => c.name === name).sort((a, b) => b.v - a.v)[0];
  for (const cap of ["mail.send", "mail.send_as", "google.gmail.send_message", "google.user.send_message", "ms.mail.send_message", "ms.user.send_message", "google.calendar.create_event", "ms.calendar.create_event"]) assert.equal(latest(cap)?.gate?.act, "send", cap);
});

test("an agent's send as a person stops unless the person asked this turn; a step needs a grant", async () => {
  const send = { name: "mail.send_as", v: 1, gate: { act: "send" } } as unknown as CapabilityDef;
  const none = createGateHook({ call: async (cap) => (cap === "gate.effective_rule" ? { hold: true } : { granted: false }), unseal: () => new Uint8Array(), now: () => 0, hold: () => null, threads: (id) => [id] });
  assert.deepEqual(await none.applies(send, { to: ["a@b.test"] }, { principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_noah", thread: "thr_1", chatMode: "auto" } as never), { act: "send" });
  assert.deepEqual(await none.applies(send, { to: ["a@b.test"] }, { principal: { kind: "person", id: "usr_noah" }, step } as never), { act: "send" });
});

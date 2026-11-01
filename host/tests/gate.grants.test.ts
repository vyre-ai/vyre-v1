// The Gate hook and grants: an automation step needs one whoever the Run runs as, and in Auto a person's own message lifts a default hold on the act and target it named. A written rule beats both.
import test from "node:test";
import assert from "node:assert/strict";
import { createGateHook } from "../src/daemon/gate-hook.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const mail = { name: "mail.send", v: 1, gate: { act: "send" } } as unknown as CapabilityDef;
const connector = { name: "connectors.run", v: 1, gate: { act: "send", when: "actor.kind != 'person'" } } as unknown as CapabilityDef;
const pay = { name: "stripe.charge", v: 1, gate: { act: "pay" } } as unknown as CapabilityDef;
const del = { name: "records.delete", v: 1, gate: { act: "delete" } } as unknown as CapabilityDef;
const input = { to: ["lee@acme.test"] };
const agent = { principal: { kind: "agent" as const, id: "agt_a" }, actingFor: "usr_noah", thread: "thr_job", chatMode: "auto" } as never;
const person = { principal: { kind: "person" as const, id: "usr_noah" } } as never;
const step = { automationId: "aut_1", nodeId: "n", defHash: "h" };

function hook(o: { granted?: boolean; rule?: { hold: boolean; adminRule?: boolean } } = {}) {
  const asked: { cap: string; input: Record<string, unknown> }[] = [];
  const h = createGateHook({
    call: async (cap, i) => { asked.push({ cap, input: i as Record<string, unknown> }); return cap === "gate.effective_rule" ? (o.rule ?? { hold: true }) : { granted: o.granted === true }; },
    unseal: () => new Uint8Array(), now: () => 0, hold: () => null, threads: (id) => [id, "thr_chat"],
  });
  return { h, asked, takes: () => asked.filter((a) => a.cap === "gate.grants.take") };
}

test("a step's outward act with no grant holds, though the Run runs as a person", async () => {
  const { h } = hook({ granted: false, rule: { hold: false } });
  assert.deepEqual(await h.applies(mail, input, { ...(person as object), step } as never), { act: "send" });
});

test("a step with a grant goes on to the ordinary rule", async () => {
  const { h, takes } = hook({ granted: true, rule: { hold: false } });
  assert.equal(await h.applies(mail, input, { ...(person as object), step } as never), null);
  assert.deepEqual(takes()[0]!.input, { act: "send", targets: ["lee@acme.test"], step });
});

test("a condition that lets a person's own act through does not let a step through", async () => {
  const { h } = hook({ granted: false, rule: { hold: false } });
  assert.deepEqual(await h.applies(connector, {}, { ...(person as object), step } as never), { act: "send" });
  assert.equal(await hook({ rule: { hold: false } }).h.applies(connector, {}, person), null, "the person's own call still skips it");
});

test("a step set to ask holds without looking for a grant", async () => {
  const { h, takes } = hook({ granted: true, rule: { hold: false } });
  assert.deepEqual(await h.applies(mail, input, { ...(person as object), step: { ...step, ask: true } } as never), { act: "send" });
  assert.equal(takes().length, 0);
});

test("in Auto a person's ask lifts the default hold, matched on the thread and the threads above it", async () => {
  const { h, takes } = hook({ granted: true });
  assert.equal(await h.applies(mail, input, agent), null);
  assert.deepEqual(takes()[0]!.input, { act: "send", targets: ["lee@acme.test"], turn: { person: "usr_noah", threads: ["thr_job", "thr_chat"] } });
});

test("no match is a Need", async () => {
  assert.deepEqual(await hook({ granted: false }).h.applies(mail, input, agent), { act: "send" });
});

test("a rule somebody wrote holds even when asked, and spends nothing", async () => {
  const { h, takes } = hook({ granted: true, rule: { hold: true, adminRule: true } });
  assert.deepEqual(await h.applies(mail, input, agent), { act: "send" });
  assert.equal(takes().length, 0);
});

test("only Auto spends a grant: Ask first and a turn with no mode keep the hold", async () => {
  for (const chatMode of ["ask", "plan", undefined]) {
    const { h, takes } = hook({ granted: true });
    assert.deepEqual(await h.applies(mail, input, { ...(agent as object), chatMode } as never), { act: "send" });
    assert.equal(takes().length, 0);
  }
});

test("money and a non-outward act are never lifted by an ask", async () => {
  for (const cap of [pay, del]) {
    const { h, takes } = hook({ granted: true });
    assert.deepEqual(await h.applies(cap, {}, agent), { act: cap.gate!.act });
    assert.equal(takes().length, 0);
  }
});

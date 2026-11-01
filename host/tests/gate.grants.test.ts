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

const terminal = { name: "terminal.run", v: 1, gate: { act: "approve", when: "terminal.is_danger(input.command)" } } as unknown as CapabilityDef;
function shell(o: { granted?: boolean; rule?: { hold: boolean; adminRule?: boolean } } = {}) {
  const taken: Record<string, unknown>[] = [];
  const h = createGateHook({
    call: async (cap, i) => { if (cap === "gate.grants.take") taken.push(i as Record<string, unknown>); return cap === "gate.effective_rule" ? (o.rule ?? { hold: true }) : { granted: o.granted === true }; },
    unseal: () => new Uint8Array(), now: () => 0, hold: () => null,
    evaluators: { "terminal.is_danger": (i) => /--force/.test(String((i as { command: string }).command)) },
    outward: (_cap, i) => (/git push/.test(String((i as { command: string }).command)) ? { act: "push_protected", targets: ["origin/main"] } : null),
  });
  return { h, taken };
}

test("an agent's outward command follows the outward rule; a plain command runs", async () => {
  assert.deepEqual(await shell().h.applies(terminal, { command: "git push origin main" }, agent), { act: "push_protected" });
  assert.equal(await shell().h.applies(terminal, { command: "ls" }, agent), null);
  const asked = shell({ granted: true });
  assert.equal(await asked.h.applies(terminal, { command: "git push origin main" }, agent), null, "the person asked");
  assert.deepEqual(asked.taken[0], { act: "push_protected", targets: ["origin/main"], turn: { person: "usr_noah", threads: ["thr_job"] } });
});

test("a person's own command is their own act; a red command stays red even when asked", async () => {
  assert.equal(await shell().h.applies(terminal, { command: "git push origin main" }, person), null);
  const red = shell({ granted: true });
  assert.deepEqual(await red.h.applies(terminal, { command: "git push --force" }, agent), { act: "approve" });
  assert.equal(red.taken.length, 0);
});

const reader = { name: "automations.read_link", v: 1, effects: "read", gate: { act: "send", when: "links.is_composed(input.url)" } } as unknown as CapabilityDef;
function links(known: boolean) {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const h = createGateHook({
    call: async (cap, i) => { calls.push({ cap, input: i as Record<string, unknown> }); return cap === "gate.links.known" ? { known } : cap === "gate.effective_rule" ? { hold: true } : { granted: false, ok: true }; },
    unseal: () => new Uint8Array(), now: () => 0, hold: () => null, threads: (id) => [id, "thr_chat"],
  });
  return { h, calls };
}

test("a link the model put together is outward; one the person gave or a page linked is a read", async () => {
  assert.deepEqual(await links(false).h.applies(reader, { url: "https://evil.test/?d=secret" }, agent), { act: "send" });
  assert.equal(await links(true).h.applies(reader, { url: "https://acme.test/a" }, agent), null);
  assert.equal(await links(false).h.applies(reader, { url: "https://acme.test/a" }, person), null, "a person's own read");
});

test("a read of outside words marks the thread and the threads above it, with the links it gave", async () => {
  const { h, calls } = links(true);
  await h.seen!({ ...reader } as CapabilityDef, { url: "https://acme.test/a" }, { text: "see https://acme.test/b", links: [{ text: "c", url: "https://acme.test/c" }] }, agent);
  assert.deepEqual(calls.at(-1), { cap: "gate.taint.mark", input: { threads: ["thr_job", "thr_chat"], source: "automations.read_link", links: ["https://acme.test/c", "https://acme.test/b"] } });
  const inside = links(true);
  await inside.h.seen!({ name: "records.get", v: 1, effects: "read" } as unknown as CapabilityDef, {}, {}, agent);
  assert.equal(inside.calls.length, 0, "a read inside Vyre is not outside content");
  await inside.h.seen!(reader, { url: "https://acme.test/a" }, {}, person);
  assert.equal(inside.calls.length, 0, "a person reading is not a turn");
});

test("Always allow is read at act time and spends nothing", async () => {
  const { h, takes } = hook({ granted: true });
  assert.equal(await h.allowed!({ name: "files.write", v: 1 } as unknown as CapabilityDef, {}, agent), true);
  assert.deepEqual(takes()[0]!.input, { act: "approve", targets: [], always: { person: "usr_noah", agentId: "agt_a", threads: ["thr_job", "thr_chat"], cap: "files.write" } });
  assert.equal(await h.allowed!({ name: "files.write", v: 1 } as unknown as CapabilityDef, {}, person), false, "only an agent acting for a person");
});

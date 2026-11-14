// scheduler.can_hold: may a person hold scheduled work for an agent, and read its channel? The answer comes with reasons, so a hand-over can say why not.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, bob } from "../fixtures/seed.ts";

const AGENT = `agt_${"a".repeat(32)}`;
const CHANNEL = `chn_${"c".repeat(32)}`;
type Agent = { kind?: string; runtime?: string; ownerId?: string };

function world(o: { agent?: Agent | null; gone?: string[]; denied?: string[] } = {}) {
  return harness({
    calls: {
      "access.principals.get": (i) => {
        const id = (i.principal as { id: string }).id;
        if (id === "usr_nobody") throw Object.assign(new Error("nope"), { error: { code: "validation.not_found" } });
        return { principal: { id, status: (o.gone ?? []).includes(id) ? "removed" : "active" } };
      },
      "agents.get": () => {
        if (o.agent === null) throw Object.assign(new Error("nope"), { error: { code: "validation.not_found" } });
        return { agent: o.agent ?? { kind: "agent", runtime: "vyre", ownerId: alice.id } };
      },
    },
    mayAll: (people, action, resource) => !(o.denied ?? []).includes(`${people[0]}:${resource.type}:${action.level}`),
  });
}
const ask = (h: ReturnType<typeof harness>, input: Record<string, unknown>) =>
  h.call("scheduler.can_hold", { agentId: AGENT, ...input }, alice);

test("a member who may use the agent and read the channel can hold its work", async () => {
  const h = world();
  assert.deepEqual(await ask(h, { person: bob.id, channelId: CHANNEL }), { ok: true, reasons: [] });
});

test("someone who is not in the Space, or has left it, cannot; nothing else is said about them", async () => {
  const h = world({ gone: [bob.id] });
  assert.deepEqual(await ask(h, { person: "usr_nobody" }), { ok: false, reasons: ["not_in_space"] });
  assert.deepEqual(await ask(h, { person: bob.id }), { ok: false, reasons: ["not_in_space"] });
});

test("someone without Can use on the agent cannot; the owner always can", async () => {
  const h = world({ denied: [`${bob.id}:agent:use`] });
  assert.deepEqual(await ask(h, { person: bob.id }), { ok: false, reasons: ["cannot_use_agent"] });
  assert.deepEqual(await ask(h, { person: alice.id }), { ok: true, reasons: [] });
});

test("an outside agent takes work from its owner only, and an Assistant is its person's alone", async () => {
  for (const agent of [{ runtime: "outside" }, { kind: "assistant" }]) {
    const h = world({ agent: { ...agent, ownerId: alice.id } });
    assert.deepEqual(await ask(h, { person: bob.id }), { ok: false, reasons: ["cannot_use_agent"] });
    assert.deepEqual(await ask(h, { person: alice.id }), { ok: true, reasons: [] });
  }
});

test("someone who cannot read the channel cannot hold work that posts there", async () => {
  const h = world({ denied: [`${bob.id}:channel:view`] });
  assert.deepEqual(await ask(h, { person: bob.id, channelId: CHANNEL }), {
    ok: false,
    reasons: ["cannot_read_channel"],
  });
  assert.deepEqual(
    await ask(h, { person: bob.id }),
    { ok: true, reasons: [] },
    "a routine with no channel has none to read",
  );
});

test("reasons add up, and an agent that is not there is named", async () => {
  const h = world({ denied: [`${bob.id}:agent:use`, `${bob.id}:channel:view`] });
  assert.deepEqual(await ask(h, { person: bob.id, channelId: CHANNEL }), {
    ok: false,
    reasons: ["cannot_use_agent", "cannot_read_channel"],
  });
  const gone = world({ agent: null });
  assert.deepEqual(await ask(gone, { person: bob.id }), { ok: false, reasons: ["agent_missing"] });
});

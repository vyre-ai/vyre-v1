// An Automation an agent created for Alice is Alice's. The agent created it, but that is its standing, not Bob's: asked by Bob it neither shows nor lets him use it (lib/agent-asker.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, bob, create } from "../fixtures/seed.ts";

const agentFor = (person?: string) => ({
  id: "agt_dex",
  kind: "agent" as const,
  ...(person ? { actingFor: person } : {}),
});

test("an Automation the agent made for Alice is shown to Alice and to the agent acting for nobody, not to Bob asking that agent", async () => {
  const h = harness();
  const id = (await h.call("automations.create", create({ name: "Alice's private flow" }), agentFor(alice.id)))
    .automation.id as string;
  const seen = async (who: ReturnType<typeof agentFor>): Promise<boolean> =>
    h.call("automations.get", { automationId: id }, who).then(
      () => true,
      () => false,
    );
  assert.equal(await seen(agentFor(alice.id)), true, "for Alice");
  assert.equal(await seen(agentFor()), true, "for nobody");
  assert.equal(await seen(agentFor(bob.id)), false, "for Bob");
  const listed = async (who: ReturnType<typeof agentFor>): Promise<string[]> =>
    ((await h.call("automations.list", {}, who)).automations as Array<{ name: string }>).map((a) => a.name);
  assert.ok((await listed(agentFor(alice.id))).includes("Alice's private flow"));
  assert.ok(!(await listed(agentFor(bob.id))).includes("Alice's private flow"), "Bob's list");
});

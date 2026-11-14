// A Run an agent started for Alice is Alice's. The agent started it, but that is its standing, not Bob's: asked by Bob it shows him nothing of it (lib/agent-asker.ts). Asked by Alice, or by nobody, it works as before.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, bob, newRun } from "../fixtures/seed.ts";

const agentFor = (person?: string) => ({
  id: "agt_bot",
  kind: "agent" as const,
  ...(person ? { actingFor: person } : {}),
  depth: 0,
});

test("a Run the agent started for Alice is not shown to Bob who asks that agent, but is to Alice and to the agent acting for nobody", async () => {
  const h = harness();
  const runId = (
    await h.call("runs.start", newRun({ owner: alice.id, name: "Alice's private routine" }), agentFor(alice.id))
  ).runId as string;
  const names = async (who: Parameters<typeof h.call>[2], f: Record<string, unknown>): Promise<string[]> =>
    ((await h.call("runs.list", f, who)).runs as Array<{ name?: string }>).map((r) => r.name ?? "");
  // asked by Bob
  await assert.rejects(
    h.call("runs.get", { runId }, agentFor(bob.id)),
    /does not exist|not.found|not available/i,
    "runs.get",
  );
  assert.deepEqual(await names(agentFor(bob.id), { scope: "mine" }), [], "scope mine");
  assert.deepEqual(
    await names(agentFor(bob.id), { scope: "subject", subject: { type: "automation", id: "aut_x" } }).catch(() => []),
    [],
  );
  // asked by Alice, and by nobody
  assert.equal(((await h.call("runs.get", { runId }, agentFor(alice.id))).run as { id: string }).id, runId);
  assert.equal(((await h.call("runs.get", { runId }, agentFor())).run as { id: string }).id, runId);
});

test("a Run owned by the agent itself (its own work) is not managed or read by Bob through it", async () => {
  const h = harness();
  const runId = (
    await h.call("runs.start", newRun({ owner: "agt_bot", name: "The agent's own run" }), {
      id: "svc_engine",
      kind: "service" as const,
      depth: 0,
    })
  ).runId as string;
  await assert.rejects(h.call("runs.get", { runId }, agentFor(bob.id)), /does not exist|not.found|not available/i);
  assert.equal(((await h.call("runs.get", { runId }, agentFor())).run as { id: string }).id, runId);
});

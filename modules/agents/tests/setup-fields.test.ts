// Which key pays for an agent, the Vault handles it holds and what it may spend are for people who may change it. Someone who can only see the agent reads it without them, on every read of an agent. The server's own reads stay whole: a turn is built from them whoever asked.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { LEO, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const viewOnly = <T extends object>(ctx: T): T => ({ ...ctx, authorize: (action: { level: string }) => ({ effect: action.level === "view" ? "allow" : "deny" }) });
const setup = { accountPolicy: "key", accountKey: "#Team_Key", accountFallback: ["#Backup_Key"], memoryKey: "#Memory_Key", vaultKeys: ["#Stripe"], limits: { dayCostMicros: 5_000_000 } };

async function world(): Promise<{ hn: Harness; agentId: string; viewer: Harness["ctx"] }> {
  const hn = harness();
  const made = await h["agents.create"]!(hn.ctx, { name: "Intake", role: "Use me first.", idempotencyKey: "a1" });
  const agentId = made.agent.agentId as string;
  await h["agents.update"]!(hn.ctx, { agentId, patch: { accountPolicy: "key", accountKey: "#Team_Key", accountFallback: ["#Backup_Key"], memoryKey: "#Memory_Key", vaultKeys: ["#Stripe"], limits: { dayCostMicros: 5_000_000 } } });
  return { hn, agentId, viewer: viewOnly(hn.person(LEO)) };
}
const hidden = (a: Record<string, unknown>): void => {
  assert.equal(a["accountKey"], undefined);
  assert.equal(a["memoryKey"], undefined);
  assert.deepEqual([a["accountFallback"], a["vaultKeys"], a["limits"]], [[], [], {}]);
};

test("someone who can only see an agent reads it without its keys, handles and limits, in the shape the contract promises", async () => {
  const { agentId, viewer } = await world();
  const got = await h["agents.get"]!(viewer, { agentId });
  assert.deepEqual(contractErrors("agents.get", "out", got), []);
  assert.equal(got.agent.name, "Intake", "the agent itself is still there");
  assert.equal(got.agent.accountPolicy, "key", "that a shared key pays is not private; which one is");
  hidden(got.agent);
  const listed = await h["agents.list"]!(viewer, { section: "shared" });
  assert.equal(listed.agents.length, 1);
  hidden(listed.agents[0]);
});

test("every other read of an agent keeps them too: its memory key, its limits and its effective configuration", async () => {
  const { agentId, viewer } = await world();
  assert.equal((await h["agents.memory_key.get"]!(viewer, { agentId })).memoryKey, undefined);
  assert.deepEqual((await h["agents.limits.get"]!(viewer, { agentId })).limits, {});
  hidden((await h["agents.config.get"]!(viewer, { agentId })).effective);
});

test("those who may change it read it whole: the owner, and anyone with edit", async () => {
  const { hn, agentId } = await world();
  const whole = (await h["agents.get"]!(hn.ctx, { agentId })).agent;
  assert.deepEqual(whole.accountKey, setup.accountKey);
  assert.deepEqual([whole.accountFallback, whole.memoryKey, whole.vaultKeys, whole.limits], [setup.accountFallback, setup.memoryKey, setup.vaultKeys, setup.limits]);
  assert.equal((await h["agents.get"]!(hn.person(LEO), { agentId })).agent.accountKey, setup.accountKey);
});

test("the server's own reads stay whole: a turn asked for by a viewer, a module's nested call, and an agent reading itself", async () => {
  const { hn, agentId, viewer } = await world();
  const inTurn = (await h["agents.get"]!({ ...viewer, origin: "engine", depth: 0 } as never, { agentId })).agent;
  assert.deepEqual([inTurn.accountKey, inTurn.vaultKeys, inTurn.limits], [setup.accountKey, setup.vaultKeys, setup.limits]);
  assert.equal((await h["agents.get"]!({ ...viewer, depth: 1 } as never, { agentId })).agent.accountKey, setup.accountKey);
  const self = viewOnly(hn.as({ kind: "agent", id: agentId }, LEO));
  assert.deepEqual((await h["agents.get"]!(self, { agentId })).agent.vaultKeys, setup.vaultKeys);
  hidden((await h["agents.get"]!({ ...viewer, origin: "mcp", depth: 0 } as never, { agentId })).agent);
  hidden((await h["agents.get"]!({ ...viewOnly(hn.as({ kind: "agent", id: "agt_other" }, LEO)), origin: "agent", depth: 0 } as never, { agentId })).agent);
});

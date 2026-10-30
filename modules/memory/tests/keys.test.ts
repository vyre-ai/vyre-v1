// Who pays for memory upkeep: the pickers, who may set them, and which account a scope resolves to.
import test from "node:test";
import assert from "node:assert/strict";
import { keyResolve, keySet, keysGet } from "../handlers/keys.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";

const P = (o: Record<string, unknown>) => ({ id: `prv_${o["handle"]}`, providerKey: "anthropic", name: String(o["handle"]), connection: "api_key", scope: "shared", itemId: `vit_${o["handle"]}`, engine: "anthropic", state: "ok", spaceMayUse: false, ...o });
const LIST = [P({ handle: "#Team_Key" }), P({ handle: "#Dana_Key", scope: "mine" }), P({ handle: "#Dana_Claude", connection: "subscription", scope: "mine", spaceMayUse: true }), P({ handle: "#Dana_Sub_Off", connection: "subscription", scope: "mine" }), P({ handle: "#Broken", state: "failing" })];
const world = (memoryKey?: string) => ({ "providers.list": () => ({ providers: LIST }), "agents.memory_key.get": () => ({ ...(memoryKey ? { memoryKey } : {}), ownerId: "usr_dana" }) });

test("a person picks their own account or a shared one; a subscription shows only when the Space may use it", async () => {
  const h = harness({ respond: world() });
  const got = await keysGet(h.ctx, {});
  assert.deepEqual(contractErrors("memory.keys.get", "out", got), []);
  assert.deepEqual(got.personal.choices.map((c) => c.ref), ["#Team_Key", "#Dana_Key", "#Dana_Claude", "#Broken"]);
  assert.equal(got.admin, false);
  assert.equal(got.space, undefined, "the Space's key is for admins");
  assert.deepEqual(await keySet(h.ctx, { layer: "person", accountRef: "#Dana_Key" }), { layer: "person", accountRef: "#Dana_Key" });
  assert.equal((await keysGet(h.ctx, {})).personal.accountRef, "#Dana_Key");
  await assert.rejects(() => keySet(h.ctx, { layer: "person", accountRef: "#Sana_Secret" }), /not one you can use/);
  await assert.rejects(() => keySet(h.ctx, { layer: "person", accountRef: "#Dana_Sub_Off" }), /not one you can use/);
  assert.deepEqual(await keySet(h.ctx, { layer: "person", accountRef: null }), { layer: "person", accountRef: null });
  assert.equal((await keysGet(h.ctx, {})).personal.accountRef, null);
});

test("only an admin sets the Space and project keys, and only from shared accounts", async () => {
  const h = harness({ respond: world() });
  await assert.rejects(() => keySet(h.ctx, { layer: "space", accountRef: "#Team_Key" }), /Only a Space admin/);
  h.setAdmin(true);
  await assert.rejects(() => keySet(h.ctx, { layer: "space", accountRef: "#Dana_Key" }), /shared account/);
  await assert.rejects(() => keySet(h.ctx, { layer: "project", accountRef: "#Team_Key" }), /Name the project/);
  await keySet(h.ctx, { layer: "space", accountRef: "#Team_Key" });
  await keySet(h.ctx, { layer: "project", projectId: "prj_a", accountRef: "#Team_Key" });
  const got = await keysGet(h.ctx, {});
  assert.deepEqual([got.space?.accountRef, got.projectKeys], ["#Team_Key", { prj_a: "#Team_Key" }]);
  assert.deepEqual(got.space?.choices.map((c) => c.ref), ["#Team_Key", "#Broken"], "no personal accounts in the Space picker");
});

test("resolve: agent key, then project, then Space; a person's own only for that person; none is rule-based; a dead key is said", async () => {
  const h = harness({ respond: world("#Team_Key") });
  h.setAdmin(true);
  assert.deepEqual(await keyResolve(h.ctx, { layer: "space", ownerRef: "spc_memorytest" }), { reason: "no_key" });
  await keySet(h.ctx, { layer: "space", accountRef: "#Team_Key" });
  const space = await keyResolve(h.ctx, { layer: "space", ownerRef: "spc_memorytest" });
  assert.deepEqual(contractErrors("memory.key.resolve", "out", space), []);
  assert.equal(space.key?.source, "space");
  assert.equal(space.key?.model, "claude-haiku-5-5");
  // agent memory uses the agent's Memory key before the Space's
  const own = harness({ raw: h.raw, respond: world("#Broken") });
  assert.deepEqual(await keyResolve(own.ctx, { layer: "agent", ownerRef: "agt_a", agentId: "agt_a" }), { reason: "key_unavailable", key: { accountRef: "#Broken", source: "agent" } });
  const mid = harness({ raw: h.raw, respond: world("#Team_Key") });
  assert.equal((await keyResolve(mid.ctx, { layer: "agent", ownerRef: "agt_a", agentId: "agt_a" })).key?.source, "agent");
  const none = harness({ raw: h.raw, respond: world() });
  assert.equal((await keyResolve(none.ctx, { layer: "agent", ownerRef: "agt_a", agentId: "agt_a" })).key?.source, "space", "an agent with no key of its own falls to the Space key");
  assert.equal((await keyResolve(none.ctx, { layer: "agent", ownerRef: "agt_a", agentId: "agt_a", projectId: "prj_z" })).key?.source, "space");
  // personal memory: the person's key, only when that person asks
  await keySet(none.ctx, { layer: "person", accountRef: "#Dana_Key" });
  assert.equal((await keyResolve(none.ctx, { layer: "person", ownerRef: "usr_dana" })).key?.accountRef, "#Dana_Key");
  const system = harness({ raw: h.raw, respond: world(), principal: { kind: "service", id: "svc_host" } });
  assert.deepEqual(await keyResolve(system.ctx, { layer: "person", ownerRef: "usr_dana" }), { reason: "no_key" }, "the server cannot spend a person's key on their memory");
});

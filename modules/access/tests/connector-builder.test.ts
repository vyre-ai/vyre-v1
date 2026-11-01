// The Connector builder grant: an assistant gets Member permissions plus connectors.manage through one made-on-first-use role; granting twice changes nothing; a person who is not an agent is refused.
// @reads ../migrations/0001_access_core.sql
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { builderGrant, builderStatus, BUILDER_ROLE } from "../handlers/connector-builder.ts";
import { putPrincipal } from "../handlers/roles.ts";
import { dropStore, storeOf } from "../projections.ts";

const codeOf = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;

test("an assistant without the role is not allowed; the grant makes the role once and gives it; the second grant is the same", async () => {
  const h = harness();
  const store = storeOf(h.ctx);
  putPrincipal(store, { id: "agt_a", kind: "agent", name: "Assistant" });
  assert.equal((await builderStatus(h.ctx, { agentId: "agt_a" })).allowed, false);
  const first = await builderGrant(h.ctx, { agentId: "agt_a" });
  assert.equal(first.created, true);
  const role = store.roles.get(first.roleId)!;
  assert.deepEqual([role.name, role.builtIn, role.assignableToAgents], [BUILDER_ROLE, false, true]);
  assert.ok(role.permissions.includes("connectors.manage") && role.permissions.includes("records.edit"), "Member permissions plus connectors.manage");
  assert.ok(!role.permissions.includes("engineer.mcp") && !role.permissions.includes("access.manage"), "nothing more");
  assert.equal((await builderStatus(h.ctx, { agentId: "agt_a" })).allowed, true);
  const second = await builderGrant(h.ctx, { agentId: "agt_a" });
  assert.deepEqual([second.created, second.roleId], [false, first.roleId]);
  assert.equal([...store.roles.values()].filter((r) => r.name === BUILDER_ROLE).length, 1);
  assert.deepEqual(store.rolesOf("agt_a").filter((r) => r === first.roleId), [first.roleId], "held once");
  dropStore(h.db);
});

test("only an agent can be granted it", async () => {
  const h = harness();
  putPrincipal(storeOf(h.ctx), { id: "usr_p", kind: "person", name: "P" });
  await assert.rejects(builderGrant(h.ctx, { agentId: "usr_p" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(builderStatus(h.ctx, { agentId: "agt_none" }), (e) => codeOf(e) === "validation.not_found");
  dropStore(h.db);
});

// The registrar that makes an agent a principal when agents.create makes it: it appears once, in the seeded shape, and is never above its maker.
import test from "node:test";
import assert from "node:assert/strict";
import { createPrincipalRegistrar } from "./principals.ts";
import type { SpaceLevel } from "./principals.ts";

const created = (agentId: string, ownerId = "usr_a") => [{ type: "agent.created", payload: { agentId, name: "Helper", ownerId } }];
const reg = (level: SpaceLevel, known: string[] = []) => createPrincipalRegistrar({ exists: (id) => known.includes(id), levelOf: () => level });

test("an agent made by someone who may edit the Space is a Member with an edit grant, owned by its owner", () => {
  const out = reg("edit").register({ events: created("agt_1abc"), space: "spc_core", maker: "usr_a" });
  assert.deepEqual(out.map((e) => e.type), ["principal.created", "principal.role_set", "grant.created"]);
  assert.deepEqual(out[0]!.payload, { id: "agt_1abc", kind: "agent", owner: "usr_a", status: "active", name: "Helper" });
  assert.deepEqual(out[1]!.payload, { holder: "agt_1abc", role: "rol_member" });
  assert.equal(out[2]!.payload["level"], "edit");
  assert.equal(out[2]!.payload["by"], "usr_a");
});

test("an agent is never above its maker: a maker who may only view gets a Guest agent with a view grant, and a maker with no reach a Guest with no grant", () => {
  const view = reg("view").register({ events: created("agt_2abc"), space: "spc_core", maker: "usr_g" });
  assert.equal(view[1]!.payload["role"], "rol_guest");
  assert.equal(view[2]!.payload["level"], "view");
  const none = reg("none").register({ events: created("agt_3abc"), space: "spc_core", maker: "usr_g" });
  assert.deepEqual(none.map((e) => e.type), ["principal.created", "principal.role_set"]);
  assert.equal(none[1]!.payload["role"], "rol_guest");
});

test("an agent that is already a principal, a repeated event, and an event that is not agent.created add nothing", () => {
  assert.deepEqual(reg("edit", ["agt_1abc"]).register({ events: created("agt_1abc"), space: "s", maker: "usr_a" }), []);
  assert.equal(reg("edit").register({ events: [...created("agt_4abc"), ...created("agt_4abc")], space: "s", maker: "usr_a" }).filter((e) => e.type === "principal.created").length, 1);
  assert.deepEqual(reg("edit").register({ events: [{ type: "agent.updated", payload: { agentId: "agt_5abc" } }], space: "s", maker: "usr_a" }), []);
  assert.deepEqual(reg("edit").register({ events: created("not-an-agent-id"), space: "s", maker: "usr_a" }), []);
});

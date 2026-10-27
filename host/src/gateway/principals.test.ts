// The registrar that makes an agent a principal when agents.create makes it: it appears once, in the seeded shape, and is never above its maker.
import test from "node:test";
import assert from "node:assert/strict";
import { createPrincipalRegistrar } from "./principals.ts";
import type { SpaceLevel } from "./principals.ts";
import { applyEvent } from "../../../modules/access/consumers.ts";
import { AccessStore } from "../../../modules/access/projections.ts";

const created = (agentId: string, ownerId = "usr_a") => [{ type: "agent.created", payload: { agentId, name: "Helper", ownerId } }];
const createdWithFolder = (folderId: unknown) => [{ type: "agent.created", payload: { agentId: "agt_folder", name: "Helper", ownerId: "usr_a", folderId } }];
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

test("a well-formed home folder gets deterministic agent and owner grants, while malformed folders do not", () => {
  const out = reg("edit").register({ events: createdWithFolder("fld_home1"), space: "spc_core", maker: "usr_a" });
  assert.deepEqual(out.slice(-2).map((e) => [e.id, e.payload["subject_id"], e.payload["resource_id"], e.payload["level"]]), [
    ["gr_agt_folder_home", "agt_folder", "fld_home1", "edit"],
    ["gr_agt_folder_owner", "usr_a", "fld_home1", "manage"],
  ]);
  assert.equal(reg("edit").register({ events: createdWithFolder("folder_bad"), space: "spc_core", maker: "usr_a" }).length, 3);
  assert.equal(reg("edit").register({ events: [...createdWithFolder("fld_home1"), ...createdWithFolder("fld_home1")], space: "spc_core", maker: "usr_a" }).filter((e) => e.id === "gr_agt_folder_home").length, 1);
});

test("gateway actor-kind home grants fold onto the registered agent and person", () => {
  const store = new AccessStore();
  const events = [
    { type: "principal.created", payload: { id: "agt_home", kind: "agent", owner: "usr_a", status: "active" } },
    { type: "principal.created", payload: { id: "usr_a", kind: "person", status: "active" } },
    { type: "grant.created", payload: { id: "gr_home", subject_kind: "actor", subject_id: "agt_home", resource_type: "folder", resource_id: "fld_home", level: "edit" } },
    { type: "grant.created", payload: { id: "gr_owner", subject_kind: "actor", subject_id: "usr_a", resource_type: "folder", resource_id: "fld_home", level: "manage" } },
  ] as const;
  for (const event of events) applyEvent(store, event, 1);
  assert.equal(store.grants.get("gr_home")?.subject.kind, "agent");
  assert.equal(store.grants.get("gr_owner")?.subject.kind, "person");
});

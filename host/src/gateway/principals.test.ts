// The registrar that makes an agent a principal when agents.create makes it: it appears once, in the seeded shape, and is never above its maker.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../../kernel/src/authorize/index.ts";
import { foldEvent } from "../daemon/access.ts";
import { createPrincipalRegistrar, missingAgentPrincipalEvents } from "./principals.ts";
import type { SpaceLevel } from "./principals.ts";

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
  assert.match(out[2]!.id, /^gnt_[a-z0-9]+$/);
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
    ["gnt_folderhome", "agt_folder", "fld_home1", "edit"],
    ["gnt_folderowner", "usr_a", "fld_home1", "manage"],
  ]);
  assert.equal(reg("edit").register({ events: createdWithFolder("folder_bad"), space: "spc_core", maker: "usr_a" }).length, 3);
  assert.equal(reg("edit").register({ events: [...createdWithFolder("fld_home1"), ...createdWithFolder("fld_home1")], space: "spc_core", maker: "usr_a" }).filter((e) => e.id === "gnt_folderhome").length, 1);
});

test("legacy agent births reconcile the principal and bounded Space grant from their owner without using host authority", () => {
  const out = missingAgentPrincipalEvents({
    space: "spc_core",
    levelOf: (person) => person === "usr_owner" ? "edit" : "none",
    events: [{ type: "agent.created", payload: { agentId: "agt_legacy1", name: "Imported helper", ownerId: "usr_owner", folderId: "fld_home1" } }],
  });
  assert.deepEqual(out.map((e) => e.type), ["principal.created", "principal.role_set", "grant.created"]);
  assert.deepEqual(out[0]!.payload, { id: "agt_legacy1", kind: "agent", owner: "usr_owner", status: "active", name: "Imported helper" });
  assert.deepEqual(out[1]!.payload, { holder: "agt_legacy1", role: "rol_member" });
  assert.deepEqual(out.slice(2).map((e) => [e.id, e.payload["by"]]), [["gnt_legacy1space", "usr_owner"]]);
  const access = new AccessSnapshot();
  access.putResource({ id: "spc_core", type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 });
  access.putPrincipal({ id: "usr_owner", kind: "person", status: "active", name: "Owner" });
  access.putGrant({ id: "g_owner", subject_kind: "actor", subject_id: "usr_owner", resource_type: "space", resource_id: "spc_core", level: "manage", by: "usr_owner" });
  for (const event of out) foldEvent(access, event);
  assert.equal(authorize(access, { principal: "agt_legacy1", actingFor: "usr_owner", action: { perm: null, level: "edit" }, resource: { type: "space", id: "spc_core" } }).effect, "allow", "a seeded/imported agent is authorizable after reconciliation");
});

test("legacy birth folderId is untrusted and cannot create grants on a shared folder", () => {
  const out = missingAgentPrincipalEvents({
    space: "spc_core", levelOf: () => "edit",
    events: [{ type: "agent.created", payload: { agentId: "agt_legacy3", ownerId: "usr_owner", folderId: "fld_shared" } }],
  });
  assert.equal(out.filter((e) => e.type === "grant.created").length, 1);
  assert.equal(out.find((e) => e.type === "grant.created")!.payload["resource_type"], "space");
});

test("legacy semantic grants and their revocations prevent duplicate or resurrected Space grants", () => {
  const birth = { type: "agent.created", payload: { agentId: "agt_legacy4", ownerId: "usr_owner" } };
  const old = { type: "grant.created", payload: { id: "gr_legacy_space", subject_kind: "actor", subject_id: "agt_legacy4", resource_type: "space", resource_id: "spc_core", level: "edit" } };
  const existing = missingAgentPrincipalEvents({ space: "spc_core", levelOf: () => "edit", events: [birth, old] });
  assert.equal(existing.filter((e) => e.type === "grant.created").length, 0, "an old semantic grant has the intended reach");
  const revoked = missingAgentPrincipalEvents({
    space: "spc_core", levelOf: () => "edit",
    events: [birth, old, { type: "grant.revoked", payload: { grantId: "gr_legacy_space", subject: { kind: "agent", id: "agt_legacy4" }, resource: { type: "space", id: "spc_core" } } }],
  });
  assert.equal(revoked.filter((e) => e.type === "grant.created").length, 0, "a revoked semantic grant is not recreated under a new id");
});

test("a live lower-level legacy Space grant is preserved rather than widened by reconciliation", () => {
  const birth = { type: "agent.created", payload: { agentId: "agt_legacy5", ownerId: "usr_owner" } };
  const limited = { type: "grant.created", payload: { id: "gr_legacy_view", subject_kind: "actor", subject_id: "agt_legacy5", resource_type: "space", resource_id: "spc_core", level: "view" } };
  const out = missingAgentPrincipalEvents({ space: "spc_core", levelOf: () => "edit", events: [birth, limited] });
  assert.equal(out.filter((e) => e.type === "grant.created").length, 0, "boot preserves an intentional lower grant without an explicit level-change policy");
});

test("a replay of the same repaired agent access events appends nothing", () => {
  const birth = { type: "agent.created", payload: { agentId: "agt_replay1", ownerId: "usr_owner" } };
  const repaired = missingAgentPrincipalEvents({ space: "spc_core", levelOf: () => "edit", events: [birth] });
  assert.deepEqual(missingAgentPrincipalEvents({ space: "spc_core", levelOf: () => "edit", events: [birth, ...repaired] }), []);
});

test("legacy principal reconciliation fills only missing parts and waits until a deleted agent is restored", () => {
  const birth = { type: "agent.created", payload: { agentId: "agt_legacy2", ownerId: "usr_owner", folderId: "fld_home2" } };
  const principal = { type: "principal.created", payload: { id: "agt_legacy2", kind: "agent", owner: "usr_owner", status: "active", name: "agt_legacy2" } };
  const role = { type: "principal.role_set", payload: { holder: "agt_legacy2", role: "rol_member" } };
  const grants = [{ type: "grant.created", payload: { id: "gnt_legacy2space", subject_kind: "actor", subject_id: "agt_legacy2", resource_type: "space", resource_id: "spc_core", level: "edit" } }];
  assert.deepEqual(missingAgentPrincipalEvents({ space: "spc_core", levelOf: () => "edit", events: [birth, principal, role, ...grants] }), []);
  assert.deepEqual(missingAgentPrincipalEvents({ space: "spc_core", levelOf: () => "edit", events: [birth, { type: "agent.deleted", payload: { agentId: "agt_legacy2" } }] }), []);
  const restored = missingAgentPrincipalEvents({ space: "spc_core", levelOf: () => "edit", events: [birth, { type: "agent.deleted", payload: { agentId: "agt_legacy2" } }, { type: "agent.restored", payload: { agentId: "agt_legacy2" } }] });
  assert.equal(restored[0]!.type, "principal.created");
});

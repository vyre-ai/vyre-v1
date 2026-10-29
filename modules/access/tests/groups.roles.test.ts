import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { dropStore, storeOf } from "../projections.ts";
import { groupsAddMember, groupsCreate, groupsGet, groupsUpdate, groupsRemoveMember, principalsEffective, putPrincipal, rolesApply, rolesAssign, rolesCreate, rolesGet, rolesPreview, rolesUpdate } from "../handlers/roles.ts";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import { validateInput } from "../../../generated/validators.ts";
const code = (error: unknown): string | undefined => (error as { error?: { code?: string } }).error?.code;

function world() {
  const h = harness();
  const store = storeOf(h.ctx);
  putPrincipal(store, { id: "usr_person", kind: "person", name: "Person" });
  putPrincipal(store, { id: "agt_agent", kind: "agent", name: "Agent", owner: "usr_person" });
  return { ...h, store };
}

test("group role assignment is public-contract-valid and produces durable effective roles and grants", async () => {
  const h = world();
  const group = (await groupsCreate(h.ctx, { name: "Reviewers", members: [{ kind: "person", id: "usr_person" }], idempotencyKey: "group-reviewers" })).group;
  const role = (await rolesCreate(h.ctx, { name: "Review role", cloneFrom: "rol_guest", idempotencyKey: "role-review" })).role;
  const diff = await rolesPreview(h.ctx, { roleId: role.id, permissions: ["records.edit"] });
  await rolesApply(h.ctx, { roleId: role.id, permissions: ["records.edit"], previewHash: diff.previewHash });
  const input = { roleId: role.id, subject: { kind: "group" as const, id: group.id } };
  assert.deepEqual(validateInput("access.roles.assign", 1, input), []);
  await rolesAssign(h.ctx, input);
  h.store.resources.set("fld_shared", { id: "fld_shared", type: "folder", parentId: null, label: "public", ownerId: "usr_other", holds: 0 });
  h.store.grants.set("gnt_group", { id: "gnt_group", subject: { kind: "group", id: group.id }, resource: { type: "folder", id: "fld_shared" }, level: "view", conditions: {}, by: "usr_admin", createdAt: h.ctx.now() });
  h.store.bump();
  // Persist the new group grant and ensure restart reconstruction preserves the holder.
  h.store.persist(h.db);
  dropStore(h.db);
  const effective = await principalsEffective(h.ctx, { principal: { kind: "person", id: "usr_person" } });
  assert.ok(effective.permissions.includes("records.edit"));
  assert.ok(effective.roles.includes(role.id));
  assert.ok(effective.grants.some((grant) => grant.id === "gnt_group"));
  assert.ok((await groupsGet(h.ctx, { groupId: group.id })).roles.includes(role.id));
  const detail = await rolesGet(h.ctx, { roleId: role.id }) as unknown as { directHolders: { kind: string; id: string }[]; holders: { id: string }[] };
  assert.ok(detail.directHolders.some((holder) => holder.kind === "group" && holder.id === group.id));
  assert.ok(detail.holders.some((holder) => holder.id === "usr_person"));
  assert.equal(authorize(storeOf(h.ctx).snapshot(), { principal: "usr_person", action: { perm: "records.edit", level: "view" }, resource: { type: "folder", id: "fld_shared" }, now: h.ctx.now() }).effect, "allow");
});

test("agents cannot receive elevated or human-only roles through group assignment or later membership", async () => {
  const h = world();
  const agents = (await groupsCreate(h.ctx, { name: "Agents", members: [{ kind: "agent", id: "agt_agent" }], idempotencyKey: "group-agents" })).group;
  await assert.rejects(rolesAssign(h.ctx, { subject: { kind: "group", id: agents.id }, roleId: "rol_admin" }), (error) => code(error) === "validation.precondition_failed");
  const humans = (await groupsCreate(h.ctx, { name: "Human admins", members: [{ kind: "person", id: "usr_person" }], idempotencyKey: "group-humans" })).group;
  await rolesAssign(h.ctx, { subject: { kind: "group", id: humans.id }, roleId: "rol_admin" });
  await assert.rejects(groupsAddMember(h.ctx, { groupId: humans.id, member: { kind: "agent", id: "agt_agent" } }), (error) => code(error) === "validation.precondition_failed");
  assert.equal((await groupsGet(h.ctx, { groupId: humans.id })).group.members.length, 1);
  const role = (await rolesCreate(h.ctx, { name: "Human only", cloneFrom: "rol_member", assignableToAgents: false, idempotencyKey: "role-human" })).role;
  await assert.rejects(rolesAssign(h.ctx, { subject: { kind: "group", id: agents.id }, roleId: role.id }), (error) => code(error) === "validation.precondition_failed");
});

test("changing agent eligibility cannot silently retain agent holders, and legacy group rows fail closed", async () => {
  const h = world();
  const group = (await groupsCreate(h.ctx, { name: "Mixed", members: [{ kind: "agent", id: "agt_agent" }, { kind: "person", id: "usr_person" }], idempotencyKey: "group-mixed" })).group;
  const role = (await rolesCreate(h.ctx, { name: "Custom", cloneFrom: "rol_member", idempotencyKey: "role-custom" })).role;
  await rolesAssign(h.ctx, { subject: { kind: "group", id: group.id }, roleId: role.id });
  await assert.rejects(rolesUpdate(h.ctx, { roleId: role.id, assignableToAgents: false }), (error) => code(error) === "validation.precondition_failed");
  assert.equal(h.store.roles.get(role.id)!.assignableToAgents, true);
  await groupsRemoveMember(h.ctx, { groupId: group.id, member: { kind: "agent", id: "agt_agent" } });
  await rolesUpdate(h.ctx, { roleId: role.id, assignableToAgents: false });
  // A pre-fix/corrupt persisted group membership must not bypass the read-time guard.
  h.store.groups.get(group.id)!.members.push({ kind: "agent", id: "agt_agent" });
  h.store.setRoles(group.id, [role.id, "rol_admin"]); h.store.bump();
  const agent = await principalsEffective(h.ctx, { principal: { kind: "agent", id: "agt_agent" } });
  assert.ok(!agent.permissions.includes("records.edit"));
  assert.ok(!agent.permissions.includes("access.manage"));
  assert.ok(!agent.roles.includes("rol_admin") && !agent.roles.includes(role.id));
  const person = await principalsEffective(h.ctx, { principal: { kind: "person", id: "usr_person" } });
  assert.ok(person.permissions.includes("records.edit"));
});

 test("a rejected manager update cannot rename a group or assign an agent manager", async () => {
  const h = world();
  const group = (await groupsCreate(h.ctx, { name: "Original", idempotencyKey: "manager-atomic" })).group;
  await assert.rejects(groupsUpdate(h.ctx, { groupId: group.id, name: "Mutated", managers: [{kind: "agent", id: "agt_agent"}] }), (error) => code(error) === "validation.precondition_failed");
  assert.equal((await groupsGet(h.ctx, { groupId: group.id })).group.name, "Original");
  assert.deepEqual((await groupsGet(h.ctx, { groupId: group.id })).group.managers, []);
 });

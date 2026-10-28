import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent } from "../consumers.ts";
import { AccessStore } from "../projections.ts";

test("gateway actor-kind home grants fold onto the registered agent and person", () => {
  const store = new AccessStore();
  const events = [
    { type: "principal.created", payload: { id: "agt_home", kind: "agent", owner: "usr_a", status: "active" } },
    { type: "principal.created", payload: { id: "usr_a", kind: "person", status: "active" } },
    { type: "principal.created", payload: { id: "act_external", kind: "actor", status: "active" } },
    { type: "grant.created", payload: { id: "gr_home", subject_kind: "actor", subject_id: "agt_home", resource_type: "folder", resource_id: "fld_home", level: "edit" } },
    { type: "grant.created", payload: { id: "gr_owner", subject_kind: "actor", subject_id: "usr_a", resource_type: "folder", resource_id: "fld_home", level: "manage" } },
    { type: "grant.created", payload: { id: "gr_external", subject_kind: "actor", subject_id: "act_external", resource_type: "folder", resource_id: "fld_home", level: "view" } },
  ] as const;
  for (const event of events) applyEvent(store, event, 1);
  assert.equal(store.grants.get("gr_home")?.subject.kind, "agent");
  assert.equal(store.grants.get("gr_owner")?.subject.kind, "person");
  assert.equal(store.grants.get("gr_external")?.subject.kind, "actor");
  assert.deepEqual(store.snapshot().grantsOn("fld_home")?.map((g) => g.row.subject_kind), ["actor", "actor", "actor"]);
});

test("access.sync removes a replayed grant.revoked", () => {
  const store = new AccessStore();
  applyEvent(store, { type: "grant.created", payload: { id: "gr_old", subject_kind: "actor", subject_id: "agt_home", resource_type: "space", resource_id: "spc_core", level: "edit" } }, 1);
  assert.equal(store.grants.has("gr_old"), true);
  applyEvent(store, { type: "grant.revoked", payload: { grantId: "gr_old" } }, 2);
  assert.equal(store.grants.has("gr_old"), false);
});

test('ownership transfer folds resource and roles together and refuses a stale source',()=>{
 const store=new AccessStore();for(const id of ['usr_old','usr_new'])applyEvent(store,{type:'principal.created',payload:{id,kind:'person',status:'active'}},1);
 applyEvent(store,{type:'resource.created',payload:{id:'spc_fixture',type:'space',owner_id:'usr_old',label:0}},1);store.assignments.set('usr_old',['rol_owner','rol_member']);
 assert.equal(applyEvent(store,{type:'space.ownership_transferred',payload:{from:'usr_wrong',to:'usr_new'}},2),false);assert.equal(store.resources.get('spc_fixture')?.ownerId,'usr_old');
 assert.equal(applyEvent(store,{type:'space.ownership_transferred',payload:{from:'usr_old',to:'usr_new'}},3),true);assert.equal(store.resources.get('spc_fixture')?.ownerId,'usr_new');assert.ok(store.rolesOf('usr_new').includes('rol_owner'));assert.ok(!store.rolesOf('usr_old').includes('rol_owner'));assert.ok(store.rolesOf('usr_old').includes('rol_admin'));
});

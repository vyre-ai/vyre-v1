import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent } from "../consumers.ts";
import { AccessStore } from "../projections.ts";

test("gateway actor-kind home grants fold onto the registered agent and person", () => {
  const store = new AccessStore();
  const events = [
    {seq:1, type: "principal.created", payload: { id: "agt_home", kind: "agent", owner: "usr_a", status: "active" } },
    {seq:1, type: "principal.created", payload: { id: "usr_a", kind: "person", status: "active" } },
    {seq:1, type: "principal.created", payload: { id: "act_external", kind: "actor", status: "active" } },
    {seq:1, type: "grant.created", payload: { id: "gr_home", subject_kind: "actor", subject_id: "agt_home", resource_type: "folder", resource_id: "fld_home", level: "edit" } },
    {seq:1, type: "grant.created", payload: { id: "gr_owner", subject_kind: "actor", subject_id: "usr_a", resource_type: "folder", resource_id: "fld_home", level: "manage" } },
    {seq:1, type: "grant.created", payload: { id: "gr_external", subject_kind: "actor", subject_id: "act_external", resource_type: "folder", resource_id: "fld_home", level: "view" } },
  ] as const;
  for (const event of events) applyEvent(store, event, 1);
  assert.equal(store.grants.get("gr_home")?.subject.kind, "agent");
  assert.equal(store.grants.get("gr_owner")?.subject.kind, "person");
  assert.equal(store.grants.get("gr_external")?.subject.kind, "actor");
  assert.deepEqual(store.snapshot().grantsOn("fld_home")?.map((g) => g.row.subject_kind), ["actor", "actor", "actor"]);
});

test("access.sync removes a replayed grant.revoked", () => {
  const store = new AccessStore();
  applyEvent(store, {seq:1, type: "grant.created", payload: { id: "gr_old", subject_kind: "actor", subject_id: "agt_home", resource_type: "space", resource_id: "spc_core", level: "edit" } }, 1);
  assert.equal(store.grants.has("gr_old"), true);
  applyEvent(store, {seq:1, type: "grant.revoked", payload: { grantId: "gr_old" } }, 2);
  assert.equal(store.grants.has("gr_old"), false);
});

test('ownership transfer folds resource and roles together and refuses a stale source',()=>{
 const store=new AccessStore();for(const id of ['usr_old','usr_new'])applyEvent(store,{seq:1,type:'principal.created',payload:{id,kind:'person',status:'active'}},1);
 applyEvent(store,{seq:1,type:'resource.created',payload:{id:'spc_fixture',type:'space',owner_id:'usr_old',label:0}},1);store.assignments.set('usr_old',['rol_owner','rol_member']);
 assert.equal(applyEvent(store,{seq:1,type:'space.ownership_transferred',payload:{from:'usr_wrong',to:'usr_new'}},2),false);assert.equal(store.resources.get('spc_fixture')?.ownerId,'usr_old');
 assert.equal(applyEvent(store,{seq:1,type:'space.ownership_transferred',payload:{from:'usr_old',to:'usr_new'}},3),true);assert.equal(store.resources.get('spc_fixture')?.ownerId,'usr_new');assert.ok(store.rolesOf('usr_new').includes('rol_owner'));assert.ok(!store.rolesOf('usr_old').includes('rol_owner'));assert.ok(store.rolesOf('usr_old').includes('rol_admin'));
});

test("verified directory names fill account/bootstrap placeholders without overwriting existing named identity or authority",()=>{
 const store=new AccessStore();applyEvent(store,{seq:1,type:"principal.created",payload:{id:"usr_new",kind:"person",status:"active"}},1);store.setRoles("usr_new",["rol_member"]);
 assert.equal(applyEvent(store,{seq:1,type:"principal.created",payload:{principalId:"usr_new",kind:"person",name:"Maya Chen"}},2),true);assert.equal(store.principals.get("usr_new")?.name,"Maya Chen");assert.deepEqual(store.rolesOf("usr_new"),["rol_member"]);
 assert.equal(applyEvent(store,{seq:1,type:"principal.created",payload:{principalId:"usr_new",kind:"person",name:"Replacement",owner:"usr_other"}},3),false);assert.equal(store.principals.get("usr_new")?.name,"Maya Chen");assert.equal(store.principals.get("usr_new")?.owner,undefined);
 applyEvent(store,{seq:1,type:"principal.created",payload:{id:"usr_claim",kind:"person",status:"active",name:"Owner"}},1);store.resources.set("spc_names",{id:"spc_names",type:"space",parentId:null,label:"public",ownerId:"usr_claim",holds:0});store.setRoles("usr_claim",["rol_owner"]);
 assert.equal(applyEvent(store,{seq:1,type:"principal.created",payload:{principalId:"usr_claim",kind:"actor",name:"Wrong kind"}},2),false);
 assert.equal(applyEvent(store,{seq:1,type:"principal.created",payload:{principalId:"usr_claim",kind:"person",name:"Olivia Park"}},2),true);assert.equal(store.principals.get("usr_claim")?.name,"Olivia Park");assert.deepEqual(store.rolesOf("usr_claim"),["rol_owner"]);assert.equal(store.resources.get("spc_names")?.ownerId,"usr_claim");
});

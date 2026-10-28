// @reads ../migrations/0002_role_changes.sql
import test from "node:test";
import assert from "node:assert/strict";
import {harness} from "../fixtures/db.ts";
import {dropStore} from "../projections.ts";
import {groupsCreate,rolesAssign,rolesUnassign,rolesCreate,rolesList,rolesApply,rolesGet,rolesPreview,rolesDelete} from "../handlers/roles.ts";
const code=(error:unknown)=>(error as {error?:{code?:string}}).error?.code;
test("an empty group still holds its assigned role and blocks deletion",async()=>{
 const h=harness();const group=(await groupsCreate(h.ctx,{name:"Empty",idempotencyKey:"empty"})).group;const role=(await rolesCreate(h.ctx,{name:"Held",idempotencyKey:"held"})).role;
 await rolesAssign(h.ctx,{roleId:role.id,subject:{kind:"group",id:group.id}});
 await assert.rejects(rolesDelete(h.ctx,{roleId:role.id}),error=>code(error)==="validation.precondition_failed");
 await rolesUnassign(h.ctx,{roleId:role.id,subject:{kind:"group",id:group.id}});assert.deepEqual(await rolesDelete(h.ctx,{roleId:role.id}),{deleted:true});
});
test("last permission diff is durable, attributed and unchanged after a stale rejected Apply",async()=>{
 const h=harness();const role=(await rolesCreate(h.ctx,{name:"History",idempotencyKey:"history"})).role;const next=["records.edit"];
 const preview=await rolesPreview(h.ctx,{roleId:role.id,permissions:next});await rolesApply(h.ctx,{roleId:role.id,permissions:next,previewHash:preview.previewHash});
 dropStore(h.db);const detail=await rolesGet(h.ctx,{roleId:role.id}) as unknown as {lastChange:{before:string[];after:string[];by:{kind:string;id:string};at:number}};
 assert.deepEqual(detail.lastChange,{before:[],after:next,by:h.ctx.principal,at:h.ctx.now()});
 await assert.rejects(rolesApply(h.ctx,{roleId:role.id,permissions:[],previewHash:preview.previewHash}),error=>code(error)==="validation.precondition_failed");
 assert.deepEqual((await rolesGet(h.ctx,{roleId:role.id}) as unknown as typeof detail).lastChange,detail.lastChange);
});

test("role search runs before pagination so a later custom role can be found",async()=>{const h=harness();await rolesCreate(h.ctx,{name:"Zebra Review",idempotencyKey:"zebra"});const out=await rolesList(h.ctx,{q:"zebra",limit:1});assert.equal(out.roles.length,1);assert.equal(out.roles[0]!.name,"Zebra Review");assert.equal(out.next,undefined);});

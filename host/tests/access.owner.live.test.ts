import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {bootCore,CORE_SPACE} from "../../fixtures/seed/core/index.ts";
import {startDaemon} from "../src/daemon/daemon.ts";
import {loadConfig} from "../src/daemon/config.ts";
import {fakePlatform} from "../src/platform/index.ts";
test("HTTP Admin cannot assign or revoke Owner, groups cannot hold it, and only durable transfer changes the sole owner",async()=>{
 const core=bootCore();const dir=fs.mkdtempSync(path.join(os.tmpdir(),"vyre-owner-boundary-"));core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");fs.copyFileSync(core.file,path.join(dir,"events.db"));core.close();
 const options:Parameters<typeof startDaemon>[0]={config:loadConfig(["--data-dir",dir,"--port","0"],{},"1.0.0-test"),platform:fakePlatform({os:"linux",hostname:"owner-boundary",free:80e9,commands:{[`findmnt -n -o SOURCE --target ${dir}`]:{stdout:"/dev/mapper/vyre\n"},"lsblk -s -n -o TYPE /dev/mapper/vyre":{stdout:"crypt\ndisk\n"},"docker info --format {{.ServerVersion}}":{stdout:"27.1.1\n"}}}),fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'{"apps":{"http":{}}}'}),session:(headers)=>{const id=String(headers.authorization??"").replace(/^Bearer /,"");return ["usr_olivia","usr_adam","usr_sana"].includes(id)?{space:CORE_SPACE,principal:{kind:"person",id},device:"owner-boundary"}:null;},intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}};
 let daemon=await startDaemon(options);
 const call=async(cap:string,input:unknown,who="usr_adam")=>{const response=await fetch(`${daemon.url}/v1/${cap.replaceAll(".","/")}`,{method:"POST",headers:{authorization:`Bearer ${who}`,"content-type":"application/json"},body:JSON.stringify(input)});const body=await response.json() as any;return {status:response.status,...body};};
 const getSpace=async(who:string)=>await call("spaces.get",{},who) as {data:{space:{owner:string}}};
 const assertOwner=async()=>{
  assert.equal((await getSpace("usr_sana")).data.space.owner,"usr_sana");
  const listed=await call("access.principals.list",{kind:"person",limit:100},"usr_sana");assert.equal(listed.status,200);
  const owners=listed.data.principals.filter((person:{roles:string[]})=>person.roles.some((id)=>id==="owner"||id==="rol_owner"));assert.deepEqual(owners.map((person:{id:string})=>person.id),["usr_sana"]);
  const effective=await call("access.principals.effective",{principal:{kind:"person",id:"usr_sana"}},"usr_sana");assert.ok(effective.data.owns.some((row:{type:string;id:string})=>row.type==="space"&&row.id===CORE_SPACE));
 };
 try{
  for(const who of ["usr_adam","usr_olivia"]){assert.equal((await call("access.roles.assign",{roleId:"rol_owner",subject:{kind:"person",id:"usr_sana"}},who)).status,422);assert.equal((await call("access.roles.unassign",{roleId:"rol_owner",subject:{kind:"person",id:"usr_olivia"}},who)).status,422);}
  for(const members of [[],[{kind:"person",id:"usr_sana"}]]){const made=await call("access.groups.create",{name:members.length?"Human owner attempt":"Empty owner attempt",members,idempotencyKey:members.length?"owner-human":"owner-empty"});assert.equal(made.status,200);assert.equal((await call("access.roles.assign",{roleId:"rol_owner",subject:{kind:"group",id:made.data.group.id}})).status,422);}
  const actor=await call("access.actors.create",{name:"Owner boundary tool",provider:"codex",roleIds:["rol_member"],idempotencyKey:"owner-actor"});assert.equal(actor.status,200,"create an ordinary outside actor without logging its credential");
  assert.equal((await call("access.actors.update",{actorId:actor.data.actor.id,provider:"changed",roleIds:["rol_owner"]})).status,422);
  const actors=await call("access.actors.list",{});const unchanged=actors.data.actors.find((row:{id:string})=>row.id===actor.data.actor.id);assert.equal(unchanged.provider,"codex");assert.ok(!unchanged.roles.includes("rol_owner"));
  assert.equal((await call("spaces.transfer_ownership",{to:"usr_sana"})).status,403);
  assert.equal((await getSpace("usr_olivia")).data.space.owner,"usr_olivia");
  assert.equal((await call("spaces.transfer_ownership",{to:"usr_sana"},"usr_olivia")).status,200);await assertOwner();
  await daemon.stop();daemon=await startDaemon(options);await assertOwner();
 }finally{await daemon.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

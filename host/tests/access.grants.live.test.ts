import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {bootCore,CORE_SPACE} from "../../fixtures/seed/core/index.ts";
import {startDaemon} from "../src/daemon/daemon.ts";
import {loadConfig} from "../src/daemon/config.ts";
import {fakePlatform} from "../src/platform/index.ts";
test("HTTP grant updates cannot bootstrap authority or widen delegated bounds and invalid edits are atomic",async()=>{
 const core=bootCore();const dir=fs.mkdtempSync(path.join(os.tmpdir(),"vyre-grant-boundary-"));core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");fs.copyFileSync(core.file,path.join(dir,"events.db"));core.close();
 const options:Parameters<typeof startDaemon>[0]={config:loadConfig(["--data-dir",dir,"--port","0"],{},"1.0.0-test"),platform:fakePlatform({os:"linux",hostname:"owner-boundary",free:80e9,commands:{[`findmnt -n -o SOURCE --target ${dir}`]:{stdout:"/dev/mapper/vyre\n"},"lsblk -s -n -o TYPE /dev/mapper/vyre":{stdout:"crypt\ndisk\n"},"docker info --format {{.ServerVersion}}":{stdout:"27.1.1\n"}}}),fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'{"apps":{"http":{}}}'}),session:(headers)=>{const id=String(headers.authorization??"").replace(/^Bearer /,"");return ["usr_olivia","usr_adam","usr_sana","usr_noah"].includes(id)?{space:CORE_SPACE,principal:{kind:"person",id},device:"owner-boundary"}:null;},intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}};
 let daemon=await startDaemon(options);
 const call=async(cap:string,input:unknown,who="usr_adam")=>{const response=await fetch(`${daemon.url}/v1/${cap.replaceAll(".","/")}`,{method:"POST",headers:{authorization:`Bearer ${who}`,"content-type":"application/json"},body:JSON.stringify(input)});const body=await response.json() as any;return {status:response.status,...body};};

 try{
  const project=await call("projects.create",{type:"project",title:"Grant boundary",idempotencyKey:"grant-boundary"},"usr_olivia");assert.equal(project.status,200);const resource={type:"folder",id:project.data.folderId};
  const made=await call("access.share",{resource,subject:{kind:"person",id:"usr_sana"},level:"view",idempotencyKey:"member-view"},"usr_olivia");assert.equal(made.status,200);const grantId=made.data.grant.id;
  assert.equal((await call("access.grants.update",{grantId,level:"manage"},"usr_sana")).status,403,"a viewer cannot elevate its own grant");
  const get=async()=>{const listed=await call("access.grants.list",{resource},"usr_olivia");assert.equal(listed.status,200);return listed.data.grants.find((row:{id:string})=>row.id===grantId);};
  assert.equal((await get()).level,"view");
  const end=Date.now()+3600000;
  assert.equal((await call("access.share",{resource,subject:{kind:"person",id:"usr_noah"},level:"manage",conditions:{expiresAt:end,hiddenFields:["salary"]},idempotencyKey:"delegated-manage"},"usr_olivia")).status,200);
  assert.equal((await call("access.grants.update",{grantId,level:"manage",conditions:{expiresAt:end-10000,hiddenFields:["salary"]}},"usr_noah")).status,200,"a delegated manager can make a contained edit");
  for(const conditions of [{hiddenFields:["salary"]},{expiresAt:end+1000,hiddenFields:["salary"]},{expiresAt:end-10000,hiddenFields:[]}])assert.equal((await call("access.grants.update",{grantId,conditions},"usr_noah")).status,403,"a delegate cannot widen expiry or hidden fields");
  const ownerGrants=await call("access.grants.list",{resource},"usr_olivia");const parentGrant=ownerGrants.data.grants.find((row:{subject:{id:string}})=>row.subject.id==="usr_noah");
  const predicate={op:"eq",field:"label",value:0};const from=Date.now()-1000;
  const parentConditions={expiresAt:end,window:{from,to:end-1000},hiddenFields:["salary"],rowFilter:predicate,labelCeiling:"internal"};
  assert.equal((await call("access.grants.update",{grantId:parentGrant.id,conditions:parentConditions},"usr_olivia")).status,200);
  const narrow={expiresAt:end-10000,window:{from:from+500,to:end-2000},hiddenFields:["salary","private_note"],rowFilter:{op:"and",args:[predicate,{op:"eq",field:"owner_id",value:"usr_olivia"}]},labelCeiling:"public"};
  assert.equal((await call("access.grants.update",{grantId,conditions:narrow},"usr_noah")).status,200,"a provable narrower conjunction and time/field/label bounds remain legal");
  for(const conditions of [{...narrow,rowFilter:undefined},{...narrow,rowFilter:{op:"or",args:[predicate,{op:"eq",field:"label",value:1}]}},{...narrow,window:{from:from-1000,to:end-2000}},{...narrow,labelCeiling:"restricted"}])assert.equal((await call("access.grants.update",{grantId,conditions},"usr_noah")).status,403,"a delegate cannot widen a predicate, window or label ceiling");
  const granted=await get();assert.equal(granted.by,made.data.grant.by,"editing a delegated grant does not take over its issuer");assert.equal(granted.source,made.data.grant.source);
  const before=await get();
  assert.equal((await call("access.grants.update",{grantId,level:"edit",conditions:{rowFilter:{op:"eval",source:"bad"}}},"usr_olivia")).status,422);
  assert.deepEqual(await get(),before,"invalid conditions leave level and conditions untouched");
  const own=await call("access.grants.list",{resource},"usr_olivia");const manager=own.data.grants.find((row:{subject:{id:string}})=>row.subject.id==="usr_noah");
  assert.equal((await call("access.grants.update",{grantId:manager.id,conditions:{}},"usr_noah")).status,403,"a manager cannot use the edited grant to renew itself");
  assert.equal((await call("access.share",{resource,subject:{kind:"person",id:"usr_noah"},level:"manage",conditions:{},idempotencyKey:"self-upsert"},"usr_noah")).status,403,"upserting through share cannot bypass the same boundary");
  await daemon.stop();daemon=await startDaemon(options);assert.deepEqual(await get(),before,"rejected changes stay absent after restart");
 }finally{await daemon.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

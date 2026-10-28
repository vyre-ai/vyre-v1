// Production daemon proof for the closed shared-record preview boundary.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const COMPANY = {
  op: "type.create", type: "rt_company",
  def: { title: "Company", plural: "Companies", icon: "building", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] },
};

type Json = { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any

test("HTTP conditional record grants enforce hidden fields and row filters", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-preview-live-"));
  const boot = () => startDaemon({config:loadConfig(["--data-dir",dir,"--port","0","--space","spc_preview","--address","team.example.com"],{},"1.2.3"), platform:fakePlatform({os:"linux",hostname:"preview",free:80e9,commands:{[`findmnt -n -o SOURCE --target ${dir}`]:{stdout:"/dev/mapper/vyre\n"},"lsblk -s -n -o TYPE /dev/mapper/vyre":{stdout:"crypt\ndisk\n"},"docker info --format {{.ServerVersion}}":{stdout:"27.1.1\n"}}}),fetch:caddyFetch,intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
  let d = await boot();
  const device={deviceName:"Preview browser",deviceClass:"desktop"};
  const post=async(cap:string,input:unknown,token?:string)=>{const r=await fetch(`${d.url}/v1/${cap.replaceAll(".","/")}`,{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input)});return {status:r.status,body:await r.json() as Json};};
  try {
    const code=decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop()??"");
    assert.equal((await post("identity.claim_owner",{code,spaceId:"spc_preview",username:"previewowner",displayName:"Preview Owner",password:PASSWORD,...device,keys:KEYS})).status,200);
    const owner=(await post("identity.sign_in",{username:"previewowner",password:PASSWORD,...device})).body.data.session.token as string;
    const ownerId=(await post("identity.whoami",{},owner)).body.data.principal.id as string;
    const roles=(await post("access.roles.list",{},owner)).body.data.roles as {id:string;name:string}[];
    const invite=await post("members.invites.create",{role:roles.find(r=>r.name==="Guest")!.id,idempotencyKey:"preview-invite"},owner);
    const joined=await post("members.accept",{code:decodeURIComponent(new URL(invite.body.data.link).pathname.split("/").pop()??""),username:"previewmember",displayName:"Preview Member",password:PASSWORD,keys:KEYS,...device});
    assert.equal(joined.status,200,JSON.stringify(joined.body)); const member=joined.body.data.personId as string;
    
    assert.equal((await post("schema.apply",{idempotencyKey:"preview-type",ops:[{...COMPANY,def:{...COMPANY.def,fields:[...COMPANY.def.fields,{key:"secret",type:"text",title:"Secret"},{key:"classified",type:"text",title:"Classified",label:"restricted"}]}}]},owner)).status,200);
    const created=await post("records.create",{type:"rt_company",fields:{name:"Shared Company",secret:"private payroll",classified:"classified payroll"},idempotencyKey:"preview-record"},owner);
    assert.equal(created.status,200,JSON.stringify(created.body));
    const grant=await post("access.share",{resource:{type:"record_type",id:"rt_company"},subject:{kind:"person",id:member},level:"view",conditions:{hiddenFields:["secret"]},idempotencyKey:"hidden-record-fields"},owner);
    assert.equal(grant.status,200,JSON.stringify(grant.body));
    const read=await post("records.get",{type:"rt_company",recordId:created.body.data.record.id},joined.body.data.token as string);
    assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(read.body.data.record.fields.secret,undefined,"a hidden field must never leave the records API");assert.equal(read.body.data.record.fields.classified,undefined,"explicit schema sensitivity is authoritative even without an Access field-label projection");
    const preview=(await post("access.view_as",{person:member},owner)).body.data.previewToken as string;const previewRead=await post("records.get",{type:"rt_company",recordId:created.body.data.record.id},preview);assert.equal(previewRead.status,200,JSON.stringify(previewRead.body));assert.equal(previewRead.body.data.record.fields.classified,undefined,"View-as uses the same canonical schema classification");
    const query=await post("records.query",{type:"rt_company"},joined.body.data.token as string);assert.equal(query.status,200,JSON.stringify(query.body));assert.equal(query.body.data.rows[0]?.fields.secret,undefined);assert.equal(query.body.data.total,undefined);
    const search=await post("records.search",{type:"rt_company",q:"payroll"},joined.body.data.token as string);assert.equal(search.status,200,JSON.stringify(search.body));assert.deepEqual(search.body.data.rows,[],"search must not reveal matches on hidden text");
    const history=await post("records.history",{type:"rt_company",recordId:created.body.data.record.id},joined.body.data.token as string);assert.equal(history.status,200,JSON.stringify(history.body));assert.ok(history.body.data.entries.every((entry:{field:string})=>entry.field!=="secret"));
    assert.equal((await post("records.query",{type:"rt_company",sort:[{field:"secret",dir:"asc"}]},joined.body.data.token as string)).status,403,"hidden values never appear inside sort cursors");
    assert.equal((await post("records.query",{type:"rt_company",filter:{field:"secret",op:"eq",value:"private payroll"}},joined.body.data.token as string)).status,403,"hidden fields cannot become filter oracles");
    const extra=await post("records.create",{type:"rt_company",fields:{name:"Excluded Company",secret:"other private value"},idempotencyKey:"excluded-record"},owner);assert.equal(extra.status,200);
    const conditional=await post("access.grants.update",{grantId:grant.body.data.grant.id,conditions:{hiddenFields:["secret"],rowFilter:{op:"eq",field:"name",value:"Shared Company"},window:{from:Date.now()-1000,to:Date.now()+600000},labelCeiling:"public"}},owner);assert.equal(conditional.status,200,JSON.stringify(conditional.body));
    const filtered=await post("records.query",{type:"rt_company",limit:1},joined.body.data.token as string);assert.equal(filtered.status,200,JSON.stringify(filtered.body));assert.equal(filtered.body.data.rows.length,1);assert.equal(filtered.body.data.rows[0].fields.name,"Shared Company");assert.equal(filtered.body.data.rows[0].fields.secret,undefined);
    for(const input of [{filter:{field:"secret",op:"eq",value:"private payroll"}},{filter:{field:"secret",op:"eq",value:"no matching value"}},{sort:[{field:"secret",dir:"asc"}]},{group:"secret"},{sort:[{field:"classified",dir:"asc"}]}])assert.equal((await post("records.query",{type:"rt_company",...input},joined.body.data.token as string)).status,403,"conditional grant field eligibility is enforced even when parent authorization has no scope or no rows match");
    assert.equal((await post("records.get",{type:"rt_company",recordId:extra.body.data.record.id},joined.body.data.token as string)).status,403,"nonmatching point reads are denied");
    const count=await post("records.counts",{type:"rt_company"},joined.body.data.token as string);assert.equal(count.status,200,JSON.stringify(count.body));assert.equal(count.body.data.count,1,"counts include only currently authorized matching rows");
    const matched=await post("records.search",{type:"rt_company",q:"Shared"},joined.body.data.token as string);assert.equal(matched.status,200,JSON.stringify(matched.body));assert.equal(matched.body.data.rows.length,1);
    for(let index=0;index<2;index++)assert.equal((await post("records.create",{type:"rt_company",fields:{name:"Shared Company",secret:`another hidden value ${index}`},idempotencyKey:`matching-record-${index}`},owner)).status,200);
    const ids=new Set<string>();let cursor:string|undefined;
    do{const page=await post("records.query",{type:"rt_company",limit:1,...(cursor?{cursor}:{})},joined.body.data.token as string);assert.equal(page.status,200,JSON.stringify(page.body));assert.equal(page.body.data.rows.length,1,"pagination fills authorized pages rather than raw pages");assert.equal(page.body.data.rows[0].fields.secret,undefined);assert.ok(!ids.has(page.body.data.rows[0].id),"no duplicate rows across opaque pages");ids.add(page.body.data.rows[0].id);cursor=page.body.data.next as string|undefined;if(cursor){assert.match(cursor,/^[a-f0-9]{48}$/);assert.notEqual((await post("records.query",{type:"rt_company",limit:1,cursor},owner)).status,200,"cursor cannot cross principals");}}while(cursor);
    assert.equal(ids.size,3);
    const elevated=await post("access.roles.create",{name:"Scoped reviewer",clearance:"confidential",idempotencyKey:"scoped-reviewer-role"},owner);assert.equal(elevated.status,200,JSON.stringify(elevated.body));assert.equal((await post("access.roles.assign",{subject:{kind:"person",id:member},roleId:elevated.body.data.role.id},owner)).status,200);
    assert.equal((await post("access.labels.set",{resource:{type:"record",id:created.body.data.record.id},label:"internal"},owner)).status,200);
    assert.equal((await post("records.get",{type:"rt_company",recordId:created.body.data.record.id},joined.body.data.token as string)).status,403,"grant ceiling caps a recipient with higher role clearance");
    const ceilingQuery=await post("records.query",{type:"rt_company"},joined.body.data.token as string);assert.equal(ceilingQuery.status,200,JSON.stringify(ceilingQuery.body));assert.equal(ceilingQuery.body.data.rows.length,2);assert.ok(ceilingQuery.body.data.rows.every((row:{id:string})=>row.id!==created.body.data.record.id));
    assert.equal((await post("access.unshare",{grantId:grant.body.data.grant.id},owner)).status,200);
    const ancestor=await post("access.share",{resource:{type:"space",id:"spc_preview"},subject:{kind:"person",id:member},level:"view",conditions:{rowFilter:{op:"eq",field:"name",value:"Shared Company"},hiddenFields:["secret"],labelCeiling:"public"},idempotencyKey:"conditional-ancestor"},owner);assert.equal(ancestor.status,200,JSON.stringify(ancestor.body));
    const inherited=await post("records.query",{type:"rt_company"},joined.body.data.token as string);assert.equal(inherited.status,200,JSON.stringify(inherited.body));assert.equal(inherited.body.data.rows.length,2,"conditional grants on the Space ancestor reach actual matching descendant records");
    assert.equal((await post("records.query",{type:"rt_company",filter:{field:"secret",op:"eq",value:"no matching value"}},joined.body.data.token as string)).status,403);
  } finally {await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

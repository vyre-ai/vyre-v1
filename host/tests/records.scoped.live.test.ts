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
    
    assert.equal((await post("schema.apply",{idempotencyKey:"preview-type",ops:[{...COMPANY,def:{...COMPANY.def,fields:[...COMPANY.def.fields,{key:"secret",type:"text",title:"Secret"}]}}]},owner)).status,200);
    const created=await post("records.create",{type:"rt_company",fields:{name:"Shared Company",secret:"private payroll"},idempotencyKey:"preview-record"},owner);
    assert.equal(created.status,200,JSON.stringify(created.body));
    const grant=await post("access.share",{resource:{type:"record_type",id:"rt_company"},subject:{kind:"person",id:member},level:"view",conditions:{hiddenFields:["secret"]},idempotencyKey:"hidden-record-fields"},owner);
    assert.equal(grant.status,200,JSON.stringify(grant.body));
    const read=await post("records.get",{type:"rt_company",recordId:created.body.data.record.id},joined.body.data.token as string);
    assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(read.body.data.record.fields.secret,undefined,"a hidden field must never leave the records API");
    const query=await post("records.query",{type:"rt_company"},joined.body.data.token as string);assert.equal(query.status,200,JSON.stringify(query.body));assert.equal(query.body.data.rows[0]?.fields.secret,undefined);assert.equal(query.body.data.total,undefined);
    const search=await post("records.search",{type:"rt_company",q:"payroll"},joined.body.data.token as string);assert.equal(search.status,200,JSON.stringify(search.body));assert.deepEqual(search.body.data.rows,[],"search must not reveal matches on hidden text");
    const history=await post("records.history",{type:"rt_company",recordId:created.body.data.record.id},joined.body.data.token as string);assert.equal(history.status,200,JSON.stringify(history.body));assert.ok(history.body.data.entries.every((entry:{field:string})=>entry.field!=="secret"));
    assert.equal((await post("records.query",{type:"rt_company",sort:[{field:"secret",dir:"asc"}]},joined.body.data.token as string)).status,403,"hidden values never appear inside sort cursors");
    assert.equal((await post("records.query",{type:"rt_company",filter:{field:"secret",op:"eq",value:"private payroll"}},joined.body.data.token as string)).status,403,"hidden fields cannot become filter oracles");
  } finally {await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

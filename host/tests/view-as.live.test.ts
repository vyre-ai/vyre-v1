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

test("HTTP shared record preview is source-bound, read-only, audited and restart-invalid", async () => {
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
    const invite=await post("members.invites.create",{role:roles.find(r=>r.name==="Member")!.id,idempotencyKey:"preview-invite"},owner);
    const joined=await post("members.accept",{code:decodeURIComponent(new URL(invite.body.data.link).pathname.split("/").pop()??""),username:"previewmember",displayName:"Preview Member",password:PASSWORD,keys:KEYS,...device});
    assert.equal(joined.status,200,JSON.stringify(joined.body)); const member=joined.body.data.personId as string;
    assert.equal((await post("access.view_as",{person:ownerId},joined.body.data.token as string)).status,403,"ordinary Members cannot issue previews");
    assert.equal((await post("schema.apply",{idempotencyKey:"preview-type",ops:[COMPANY]},owner)).status,200);
    const created=await post("records.create",{type:"rt_company",fields:{name:"Shared Company"},idempotencyKey:"preview-record"},owner);
    assert.equal(created.status,200,JSON.stringify(created.body));
    const opened=await post("access.view_as",{person:member},owner);
    assert.equal(opened.status,200,JSON.stringify(opened.body));const token=opened.body.data.previewToken as string;
    assert.match(token,/^vas_[a-f0-9]{64}$/);
    const listed=await post("records.query",{type:"rt_company"},token);assert.equal(listed.status,200,JSON.stringify(listed.body));assert.equal(listed.body.data.rows[0]?.fields.name,"Shared Company");
    const otherOwner=(await post("identity.sign_in",{username:"previewowner",password:PASSWORD,...device,deviceName:"Other owner device"})).body.data.session.token as string;
    assert.equal((await post("identity.sign_out",{},otherOwner)).status,200);
    assert.equal((await post("records.query",{type:"rt_company"},token)).status,200,"ending another session does not revoke the source-bound preview");
    const got=await post("records.get",{type:"rt_company",recordId:created.body.data.record.id},token);assert.equal(got.status,200,JSON.stringify(got.body));
    for(const [cap,input] of [["records.create",{type:"rt_company",fields:{name:"No"},idempotencyKey:"preview-write"}],["identity.whoami",{}],["access.view_as",{person:ownerId}],["identity.sign_in",{username:"previewowner",password:PASSWORD,...device}],["audit.export",{}]] as const) assert.notEqual((await post(cap,input,token)).status,200,cap);
    for(const path of ["/healthz","/sync","/spaces/spc_preview/blobs/private","/local/credentials"]) assert.equal((await fetch(d.url+path,{headers:{authorization:`Bearer ${token}`}})).status,401,path);
    const audit=await post("audit.list",{action:"records.query",limit:20},owner);assert.equal(audit.status,200,JSON.stringify(audit.body));assert.ok(JSON.stringify(audit.body.data).includes(member),"preview audit attributes target");assert.ok(JSON.stringify(audit.body.data).includes(ownerId),"preview audit retains requester");assert.ok(!JSON.stringify(audit.body).includes(token),"no bearer in audit");
    assert.equal((await post("members.suspend",{personId:member},owner)).status,200);
    assert.equal((await post("records.query",{type:"rt_company"},token)).status,401,"target revocation takes effect immediately");
    assert.equal((await post("members.reactivate",{personId:member},owner)).status,200);
    const second=(await post("access.view_as",{person:member},owner)).body.data.previewToken as string;
    assert.equal((await post("identity.sign_out",{},owner)).status,200);
    assert.equal((await post("records.query",{type:"rt_company"},second)).status,401,"ending the precise source session revokes its previews");
    const newOwner=(await post("identity.sign_in",{username:"previewowner",password:PASSWORD,...device})).body.data.session.token as string;
    const third=(await post("access.view_as",{person:member},newOwner)).body.data.previewToken as string;
    assert.equal((await post("records.query",{type:"rt_company"},third)).status,200);
    await d.stop();d=await boot();assert.equal((await post("records.query",{type:"rt_company"},third)).status,401,"restart never revives a still-valid preview");
  } finally {await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

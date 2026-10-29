import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHmac} from "node:crypto";
// Independent RFC6238 client calculation; host tests do not import the module under test.
async function totpAt(secret:string,step:number):Promise<string>{
 let bits="";for(const char of secret.toUpperCase().replace(/=+$/,""))bits+="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5,"0");
 const bytes:number[]=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();const offset=digest[digest.length-1]!&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
import {fakePlatform} from "../src/platform/index.ts";
import {loadConfig} from "../src/daemon/config.ts";
import {startDaemon} from "../src/daemon/daemon.ts";
const PASSWORD="correct horse battery staple 9";
const KEYS={personKeyByPassword:"cGVyc29uLWJ5LXBhc3N3b3Jk",publicKey:"cHVibGljLWtleQ==",privateKeyWrapped:"cHJpdmF0ZS13cmFwcGVk",spaceKeys:[{epoch:1,wrapped:"c3BhY2Uta2V5LTE="}]};
const OFF={secondFactor:"off",requireSso:false,allowPassword:true,allowGithub:true};
test("HTTP policy rejects unsupported lockout changes and enforces current saved password/MFA rules before issuing sessions",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"vyre-signin-policy-"));
 const d=await startDaemon({config:loadConfig(["--data-dir",dir,"--port","0","--space","spc_policy","--address","policy.example.com"],{},"1.2.3"),platform:fakePlatform({os:"linux",hostname:"policy",free:80e9,commands:{[`findmnt -n -o SOURCE --target ${dir}`]:{stdout:"/dev/mapper/vyre\n"},"lsblk -s -n -o TYPE /dev/mapper/vyre":{stdout:"crypt\ndisk\n"},"docker info --format {{.ServerVersion}}":{stdout:"27.1.1\n"}}}),fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'{"apps":{"http":{}}}'}),intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
 const post=async(cap:string,input:unknown,token?:string)=>{const r=await fetch(`${d.url}/v1/${cap.replaceAll(".","/")}`,{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input)});return {status:r.status,body:await r.json() as {data?:any;error?:{code:string}}};};
 const device={deviceName:"Policy test",deviceClass:"desktop"};
 const signIn=()=>post("identity.sign_in",{username:"olivia",password:PASSWORD,...device});
 try{
  const code=decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop()??"");
  assert.equal((await post("identity.claim_owner",{code,spaceId:"spc_policy",username:"olivia",displayName:"Olivia",password:PASSWORD,...device,keys:KEYS})).status,200);
  const first=await signIn();assert.equal(first.status,200);const token=first.body.data.session.token as string;
  const current=await post("members.sign_in_policy.get",{},token);assert.equal(current.status,200);assert.equal(current.body.data.capabilities.github,false);assert.deepEqual(current.body.data.capabilities.sso,[]);assert.equal(current.body.data.capabilities.newMemberMfaEnrollment,false);
  for(const policy of [{...OFF,allowPassword:false},{...OFF,requireSso:true},{...OFF,secondFactor:"required"}])assert.equal((await post("members.sign_in_policy.set",{policy},token)).status,422);
  assert.deepEqual((await post("members.sign_in_policy.get",{},token)).body.data.policy,OFF);
  const count=()=>d.db!.all("SELECT id FROM identity_sessions").length;
  const before=count();
  // A legacy persisted setting must be enforced even when today's editor refuses to create it.
  const store=(policy:unknown)=>d.db!.run("INSERT OR REPLACE INTO members_policy (key,value,updated_at,updated_by) VALUES (?,?,?,?)","sign_in",JSON.stringify(policy),Date.now(),"policy-fixture");
  store({...OFF,allowPassword:false});
  assert.equal((await post("identity.sign_in_options",{})).body.data.password,false);
  assert.equal((await signIn()).status,401);assert.equal(count(),before);
  store({...OFF,secondFactor:"required"});
  assert.equal((await post("identity.sign_in_options",{})).body.data.secondFactorRequired,true);
  const blocked=await signIn();assert.equal(blocked.status,422);assert.equal(blocked.body.error?.code,"validation.precondition_failed");assert.equal(count(),before);
  store(OFF);assert.equal((await signIn()).status,200);assert.equal(count(),before+1);
  assert.equal((await post("identity.whoami",{},token)).status,200,"existing authenticated session remains usable to repair policy");
  const setup=await post("identity.totp_begin",{},token);assert.equal(setup.status,200);
  const secret=new URL(setup.body.data.setupUri as string).searchParams.get("secret")!;
  const confirmation=await post("identity.totp_confirm",{enrolmentId:setup.body.data.enrolmentId,code:await totpAt(secret,Math.floor(Date.now()/30000))},token);assert.equal(confirmation.status,200);
  const enrolled=await post("members.sign_in_policy.get",{},token);assert.equal(enrolled.body.data.capabilities.ownerHasSecondFactor,true);
  const floor=await post("members.sign_in_policy.set",{policy:{...OFF,secondFactor:"required"}},token);assert.equal(floor.status,422);assert.equal(floor.body.error?.code,"validation.precondition_failed");
  assert.equal((await post("members.sign_in_policy.get",{},token)).body.data.policy.secondFactor,"off","enrolled Owner cannot enable a floor that locks new members out");
  assert.equal((await post("members.sign_in_policy.set",{policy:{...OFF,allowGithub:false}},token)).status,200);
  const audit=await post("audit.list",{target:{kind:"policy",id:"sign_in"},limit:50},token);assert.equal(audit.status,200);assert.ok(audit.body.data.rows.some((row:{action:string})=>row.action==="members.sign_in_policy.set"));assert.ok(!JSON.stringify(audit.body.data).includes(PASSWORD),"policy audit never contains credentials");


 }finally{await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

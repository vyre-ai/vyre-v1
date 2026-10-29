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
import {makeBundle,openWithRecovery,rewrap} from "../../client/src/crypto/keys.ts";
import type {KeyBundle as CryptoBundle} from "../../client/src/crypto/keys.ts";
import {openSeal,x25519Pair} from "../../kernel/src/seal/box.ts";
import {sha256b64} from "../../kernel/src/seal/wire.ts";
const OLD="original recovery password 123",NEW="new recovered password 456",CODE="a saved high entropy recovery code only on the device";
const device={deviceName:"Recovery browser",deviceClass:"desktop"};
type Json={data?:any;error?:{code:string}};
async function world(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"vyre-recovery-http-"));let now=Date.now();
 const d=await startDaemon({config:loadConfig(["--data-dir",dir,"--port","0","--space","spc_recovery","--address","recovery.example.com"],{},"1.2.3"),now:()=>now,platform:fakePlatform({os:"linux",hostname:"recovery",free:80e9,commands:{[`findmnt -n -o SOURCE --target ${dir}`]:{stdout:"/dev/mapper/vyre\n"},"lsblk -s -n -o TYPE /dev/mapper/vyre":{stdout:"crypt\ndisk\n"},"docker info --format {{.ServerVersion}}":{stdout:"27.1.1\n"}}}),fetch:caddyFetch,intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
 const post=async(cap:string,input:unknown,token?:string)=>{const response=await fetch(`${d.url}/v1/${cap.replaceAll(".","/")}`,{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input)});return{status:response.status,body:await response.json() as Json};};
 const made=await makeBundle(OLD,CODE,{spaceId:"spc_recovery"});const keys={personKeyByPassword:made.personKeyByPassword,personKeyByRecovery:made.personKeyByRecovery,publicKey:made.publicKey,privateKeyWrapped:made.privateKeyWrapped,spaceKeys:made.spaceKeys??[]};made.personKey.fill(0);
 const code=decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop()??"");const claimed=await post("identity.claim_owner",{code,spaceId:"spc_recovery",username:"recoveryowner",displayName:"Recovery Owner",password:OLD,keys,...device});assert.equal(claimed.status,200,JSON.stringify(claimed.body));
 const signed=await post("identity.sign_in",{username:"recoveryowner",password:OLD,...device});assert.equal(signed.status,200,JSON.stringify(signed.body));
 return{d,post,keys,token:signed.body.data.session.token as string,advance:(ms:number)=>{now+=ms;},close:async()=>{await d.stop();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function fetchProof(h:Awaited<ReturnType<typeof world>>){const result=await h.post("identity.recovery_fetch",{username:"recoveryowner"});assert.equal(result.status,200,JSON.stringify(result.body));const fetched=result.body.data as {keys:Omit<CryptoBundle,"personKeyByPassword">&{spaceKeys:{epoch:number;wrapped:string}[]};challenge:{eph:string;iv:string;ct:string;tag:string};context:string;expiresAt:number};const opened=await openWithRecovery(CODE,{...fetched.keys,personKeyByPassword:""});const nonce=openSeal(Buffer.from(opened.privateKey).subarray(-32).toString("base64url"),fetched.challenge,fetched.context).toString("base64url");opened.personKey.fill(0);opened.privateKey.fill(0);return{fetched,nonce};}

test("actual encrypted recovery: no password wrap, wrong code/hash denied, same keys/new password, one-use proof and old sessions revoked",async()=>{const h=await world();try{
 const{fetched,nonce}=await fetchProof(h),second=await fetchProof(h);assert.equal((fetched.keys as Record<string,unknown>)["personKeyByPassword"],undefined);await assert.rejects(openWithRecovery("wrong saved code",{...fetched.keys,personKeyByPassword:""}));
 const next=await rewrap(OLD,NEW,h.keys);const keys={...next,spaceKeys:h.keys.spaceKeys};const input={username:"recoveryowner",recoveryProof:nonce,newPassword:NEW,keys,...device};
 assert.equal((await h.post("identity.recovery_restore",{...input,recoveryProof:sha256b64(h.keys.personKeyByRecovery)})).status,401);
 const wrongIdentity=await h.post("identity.recovery_restore",{...input,keys:{...keys,publicKey:Buffer.from(x25519Pair().pub,"base64url").toString("base64")}});assert.equal(wrongIdentity.status,422,JSON.stringify(wrongIdentity.body));
 const recovered=await h.post("identity.recovery_restore",input);assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.deepEqual(recovered.body.data.keys,keys);
 assert.equal((await h.post("identity.whoami",{},h.token)).status,401);assert.equal((await h.post("identity.whoami",{},recovered.body.data.session.token)).status,200);
 assert.equal((await h.post("identity.sign_in",{username:"recoveryowner",password:OLD,...device})).status,401);assert.equal((await h.post("identity.sign_in",{username:"recoveryowner",password:NEW,...device})).status,200);
 assert.equal((await h.post("identity.recovery_restore",input)).status,401);assert.equal((await h.post("identity.recovery_restore",{...input,recoveryProof:second.nonce})).status,401,"another challenge bound to the old full bundle cannot replay after replacement");
 assert.ok(!JSON.stringify(h.d.db!.all("SELECT * FROM identity_codes")).includes(nonce));
 }finally{await h.close();}});

test("HTTP expired nonce and deterministic password race leave identity and nonce unspent",async()=>{const h=await world();try{
 const first=await fetchProof(h);h.advance(300001);const input={username:"recoveryowner",recoveryProof:first.nonce,newPassword:NEW,keys:h.keys,...device};assert.equal((await h.post("identity.recovery_restore",input)).status,401);
 const next=await fetchProof(h),db=h.d.db!,all=db.all.bind(db);let changed=false;
 db.all=(sql,...args)=>{const rows=all(sql,...args);if(!changed&&sql.includes("FROM identity_accounts WHERE username")){changed=true;queueMicrotask(()=>db.run("UPDATE identity_accounts SET verifier = ? WHERE username = ?","changed-during-password-hash","recoveryowner"));}return rows;};
 try{assert.equal((await h.post("identity.recovery_restore",{...input,recoveryProof:next.nonce})).status,401);}finally{db.all=all;}
 assert.equal(changed,true);assert.equal((all("SELECT used_at FROM identity_codes WHERE code_hash = ?",sha256b64(`recovery:${next.nonce}`))[0] as {used_at:number|null}).used_at,null);assert.equal((all("SELECT keys_json FROM identity_accounts WHERE username = ?","recoveryowner")[0] as {keys_json:string}).keys_json,JSON.stringify(h.keys));
 }finally{await h.close();}});

// Recovery proves possession of the existing X25519 private key. Neither a
// ciphertext hash nor a supplied replacement public key is an authenticator.
import {canonical} from "../../../lib/canonical.ts";
import {hkdf32,sealTo,x25519Public} from "../../../kernel/src/seal/box.ts";
import {sameMac} from "../../../kernel/src/seal/wire.ts";
import {assertSignInPolicy} from "../policy.ts";
import {accountByName,bundleOf,finishRecoverySessions,issueSession,makeVerifier,MIN_SECRET,randomBytes,raise,sha,validBundle} from "../projections.ts";
import type {Account,Device,IdentityCtx,KeyBundle,SignInOut} from "../projections.ts";

const TTL=5*60_000;
export type RecoveryKeys=Required<Pick<KeyBundle,"personKeyByRecovery"|"publicKey"|"privateKeyWrapped"|"spaceKeys">>;
export function recoveryContext(space:string,username:string,keys:KeyBundle):string{return`vyre/recovery-challenge/v1|${space}|${username}|${sha(canonical(keys))}`;}
function recoveryOnly(keys:KeyBundle):RecoveryKeys{return{personKeyByRecovery:keys.personKeyByRecovery!,publicKey:keys.publicKey,privateKeyWrapped:keys.privateKeyWrapped,spaceKeys:keys.spaceKeys.map(key=>({...key}))};}
function membership(ctx:IdentityCtx,person:string):void{
 const state=ctx.membership?.check(person);
 if(state==="unavailable")raise(ctx.trace.traceId,"internal.unavailable","Space access is being checked. Try again.");
 if(state==="refused")raise(ctx.trace.traceId,"auth.invalid_code");
}
function noiseSeed(ctx:IdentityCtx):Buffer{
 let row=ctx.db.all("SELECT seed FROM identity_recovery_noise WHERE space = ?",ctx.space)[0] as {seed:string}|undefined;
 if(!row){const seed=randomBytes(32).toString("hex");try{ctx.db.run("INSERT INTO identity_recovery_noise (space, seed) VALUES (?, ?)",ctx.space,seed);}catch{/* Another request may have inserted this Space's private seed. */}row=ctx.db.all("SELECT seed FROM identity_recovery_noise WHERE space = ?",ctx.space)[0] as {seed:string}|undefined;}
 if(!row||!/^[a-f0-9]{64}$/.test(row.seed))raise(ctx.trace.traceId,"internal.unavailable","Account recovery is temporarily unavailable.");
 return Buffer.from(row.seed,"hex");
}
function fakeBundle(ctx:IdentityCtx,username:string):KeyBundle{
 const seed=noiseSeed(ctx);
 const bytes=(purpose:string,length:number):Buffer=>{const blocks:Buffer[]=[];for(let block=0;block<Math.ceil(length/32);block++)blocks.push(hkdf32(seed,ctx.space,`vyre/recovery-noise/v1|${username}|${purpose}|${block}`));return Buffer.concat(blocks).subarray(0,length);};
 const wrap=(purpose:string,length:number)=>{const value=bytes(purpose,length);value[0]=1;return value.toString("base64");};
 return{personKeyByPassword:wrap("password",77),personKeyByRecovery:wrap("recovery",77),publicKey:Buffer.from(x25519Public(bytes("private",32).toString("base64url")),"base64url").toString("base64"),privateKeyWrapped:wrap("wrapped-private",93),spaceKeys:[{epoch:0,wrapped:wrap("space",109)}]};
}
function quota(ctx:IdentityCtx,person:string):void{
 ctx.db.run("DELETE FROM identity_codes WHERE kind = ? AND used_at IS NOT NULL","recovery");
 ctx.db.run("DELETE FROM identity_codes WHERE kind = ? AND expires_at <= ?","recovery",ctx.now());
 const count=(sql:string,...args:unknown[])=>Number((ctx.db.all(sql,...args)[0] as {n:number}|undefined)?.n??0);
 if(count("SELECT COUNT(*) AS n FROM identity_codes WHERE kind = ? AND person_id = ?","recovery",person)>=5||count("SELECT COUNT(*) AS n FROM identity_codes WHERE kind = ?","recovery")>=2000)raise(ctx.trace.traceId,"rate_limit.exceeded","Too many recovery attempts. Wait a few minutes before requesting another challenge.");
}
export async function recoveryFetch(ctx:IdentityCtx,input:{username:string}){
 const username=input.username.trim().toLowerCase(),account=accountByName(ctx,username),stored=account?bundleOf(account):undefined;
 let keys=stored,person=account?.person_id;const state=person?ctx.membership?.check(person):undefined;
 if(!keys?.personKeyByRecovery||!person||state!==undefined&&state!=="ok"||Buffer.from(keys.publicKey,"base64").length!==32){keys=fakeBundle(ctx,username);person=`unknown:${sha(`${ctx.space}|${username}`)}`;}
 const nonce=randomBytes(32),context=recoveryContext(ctx.space,username,keys),expiresAt=ctx.now()+TTL;
 try{
  let challenge:ReturnType<typeof sealTo>;
  try{challenge=sealTo(Buffer.from(keys.publicKey,"base64").toString("base64url"),nonce,context);}catch{keys=fakeBundle(ctx,username);person=`unknown:${sha(`${ctx.space}|${username}`)}`;return await recoveryFetchFake(ctx,username,keys,person);}
  quota(ctx,person);
  ctx.db.run("INSERT INTO identity_codes (code_hash, kind, person_id, purpose, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)",sha(`recovery:${nonce.toString("base64url")}`),"recovery",person,context,expiresAt,null);
  return{keys:recoveryOnly(keys),challenge,context,expiresAt};
 }finally{nonce.fill(0);}
}
function recoveryFetchFake(ctx:IdentityCtx,username:string,keys:KeyBundle,person:string){
 const nonce=randomBytes(32),context=recoveryContext(ctx.space,username,keys),expiresAt=ctx.now()+TTL;
 try{const challenge=sealTo(Buffer.from(keys.publicKey,"base64").toString("base64url"),nonce,context);quota(ctx,person);ctx.db.run("INSERT INTO identity_codes (code_hash, kind, person_id, purpose, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)",sha(`recovery:${nonce.toString("base64url")}`),"recovery",person,context,expiresAt,null);return{keys:recoveryOnly(keys),challenge,context,expiresAt};}finally{nonce.fill(0);}
}
function invalid(ctx:IdentityCtx,username:string):never{ctx.emit("signin.failed",username,{username,reason:"bad_code"},{afterFailure:true});return raise(ctx.trace.traceId,"auth.invalid_code");}
function challenge(ctx:IdentityCtx,account:Account,keys:KeyBundle,proof:string):{hash:string;purpose:string}{
 const hash=sha(`recovery:${proof}`),purpose=recoveryContext(ctx.space,account.username,keys);
 const row=ctx.db.all("SELECT person_id, purpose, expires_at, used_at FROM identity_codes WHERE code_hash = ? AND kind = ?",hash,"recovery")[0] as {person_id:string;purpose:string|null;expires_at:number;used_at:number|null}|undefined;
 if(!row||row.used_at!==null||row.expires_at<=ctx.now()||row.person_id!==account.person_id||!row.purpose||!sameMac(row.purpose,purpose))invalid(ctx,account.username);
 return{hash,purpose};
}
function sameIdentity(old:KeyBundle,next:KeyBundle):boolean{
 const identity=(keys:KeyBundle)=>({publicKey:keys.publicKey,privateKeyWrapped:keys.privateKeyWrapped,personKeyByRecovery:keys.personKeyByRecovery,spaceKeys:keys.spaceKeys});
 return sameMac(sha(canonical(identity(old))),sha(canonical(identity(next))));
}
export async function recoveryRestore(ctx:IdentityCtx,input:Device&{username:string;recoveryProof:string;newPassword:string;keys:KeyBundle}):Promise<SignInOut>{
 const username=input.username.trim().toLowerCase(),account=accountByName(ctx,username),keys=account?bundleOf(account):undefined;
 if(!account||!keys?.personKeyByRecovery||!account.keys_json||!/^[A-Za-z0-9_-]{43}$/.test(input.recoveryProof))invalid(ctx,username);
 const proven=challenge(ctx,account,keys,input.recoveryProof);
 if(typeof input.newPassword!=="string"||input.newPassword.length<MIN_SECRET||!validBundle(input.keys))raise(ctx.trace.traceId,"validation.bad_input","Choose a valid new password and wrapped key bundle.");
 if(!sameIdentity(keys,input.keys))raise(ctx.trace.traceId,"validation.precondition_failed","Recovery must preserve this account’s existing identity, recovery wrap and Space keys.");
 const passwordWrap=input.keys.personKeyByPassword,proof=input.recoveryProof,device={deviceName:input.deviceName,deviceClass:input.deviceClass};
 membership(ctx,account.person_id);assertSignInPolicy(ctx,account,"recovery");
 if(!ctx.recoveryCommit)raise(ctx.trace.traceId,"internal.unavailable","This host cannot complete account recovery.");
 const verifier=await makeVerifier(input.newPassword),current=accountByName(ctx,username),currentKeys=current?bundleOf(current):undefined;
 if(!current||!currentKeys||current.person_id!==account.person_id||current.keys_json!==account.keys_json||!sameMac(current.verifier,account.verifier)||current.epoch!==account.epoch||current.totp_secret!==account.totp_secret)raise(ctx.trace.traceId,"auth.invalid_code");
 challenge(ctx,current,currentKeys,proof);membership(ctx,current.person_id);assertSignInPolicy(ctx,current,"recovery");
 const next={...currentKeys,personKeyByPassword:passwordWrap};
 const committed=ctx.recoveryCommit({personId:current.person_id,username:current.username,oldVerifier:current.verifier,oldKeysJson:current.keys_json!,oldEpoch:current.epoch,oldTotpSecret:current.totp_secret,nonceHash:proven.hash,purpose:proven.purpose,verifier,keysJson:JSON.stringify(next),epoch:current.epoch});
 if(!committed)raise(ctx.trace.traceId,"auth.invalid_code");
 finishRecoverySessions(ctx,current.person_id,committed.sessions);
 ctx.emit("keys.stored",current.person_id,{personId:current.person_id,reason:"recovery"});ctx.emit("password.reset",current.person_id,{personId:current.person_id,by:current.person_id,recovered:true});
 return await issueSession(ctx,{...current,verifier,keys_json:JSON.stringify(next),recovery_hash:null,fails:0,locked_until:0},device,"recovery");
}

import test from "node:test";
import assert from "node:assert/strict";
import {handlers} from "../impl.ts";
import {provisionAccount} from "../projections.ts";
import {SEED_PERSON} from "../fixtures/seed.ts";
import {harness,DEVICE,KEYS,codeOf} from "./wire.ts";
const policy={allowPassword:true,allowGithub:true,requireSso:false,secondFactor:"off" as "off"|"required"};
test("current host policy disables password sessions and reports only implemented sign-in methods",async()=>{const h=harness();await provisionAccount(h.anon,SEED_PERSON);const ctx={...h.anon,signInPolicy:{methods:{github:false,sso:[],newMemberMfaEnrollment:false},current:()=>({...policy,allowPassword:false})}};await assert.rejects(handlers["identity.sign_in"](ctx,{username:SEED_PERSON.username,password:SEED_PERSON.secret,...DEVICE}),error=>codeOf(error)==="auth.bad_credentials");const options=await handlers["identity.sign_in_options"](ctx,{});assert.equal(options.password,false);assert.equal(options.github,false);assert.deepEqual(options.sso,[]);assert.equal(h.registered.length,0);});
test("a current required MFA policy cannot issue a session to an account without a factor",async()=>{const h=harness();await provisionAccount(h.anon,SEED_PERSON);const ctx={...h.anon,signInPolicy:{methods:{github:false,sso:[],newMemberMfaEnrollment:false},current:()=>({...policy,secondFactor:"required" as const})}};await assert.rejects(handlers["identity.sign_in"](ctx,{username:SEED_PERSON.username,password:SEED_PERSON.secret,...DEVICE}),error=>codeOf(error)==="validation.precondition_failed");assert.equal(h.registered.length,0);});

test("policy rejection does not consume an invite or create a stranded account",async()=>{for(const next of [{...policy,allowPassword:false},{...policy,secondFactor:"required" as const}]){const h=harness();let accepted=0;const ctx={...h.anon,invites:{peek:async()=>({inviteId:"inv_policy",role:"rol_member",groups:[],invitedBy:"usr_owner"}),accept:async()=>{accepted++;}},signInPolicy:{methods:{github:false,sso:[],newMemberMfaEnrollment:false},current:()=>next}};await assert.rejects(handlers["invites.accept_create_account"](ctx,{code:"join-code",username:"newperson",password:"correct horse battery staple",keys:KEYS,...DEVICE}),error=>codeOf(error)==="validation.precondition_failed");assert.equal(accepted,0);assert.equal(h.db.all("SELECT person_id FROM identity_accounts").length,0);assert.equal(h.registered.length,0);}});

test("under required single sign-on, recovery is the owner's break-glass and nobody else's",async()=>{
 const{assertSignInPolicy}=await import("../policy.ts");
 const policy={secondFactor:"off" as const,requireSso:true,allowPassword:false,allowGithub:false};
 const ctx=(owner:string)=>({signInPolicy:{current:()=>policy,methods:{github:false,sso:["google"],newMemberMfaEnrollment:false}},spaceOwner:()=>owner,sso:{providers:()=>[],resolve:()=>null},trace:{traceId:"0".repeat(32)}}) as never;
 const account={person_id:"usr_owner",totp_secret:null} as never;
 assert.doesNotThrow(()=>assertSignInPolicy(ctx("usr_owner"),account,"recovery"));
 assert.throws(()=>assertSignInPolicy(ctx("usr_someone_else"),account,"recovery"),(e:unknown)=>(e as {error?:{code?:string}}).error?.code==="auth.bad_credentials");
 assert.throws(()=>assertSignInPolicy(ctx("usr_owner"),account,"password"),(e:unknown)=>(e as {error?:{code?:string}}).error?.code==="auth.bad_credentials");
});

test("joining when everyone must use single sign-on takes a sign-in with the invitation's own address",async()=>{
 const h=harness();
 const required={...policy,allowPassword:false,requireSso:true};
 const invite={inviteId:"inv_1",role:"rol_member",groups:[],invitedBy:"usr_owner",email:"new@firm.test"};
 const held=new Map<string,{email:string;bind(p:string):void}>();const bound:string[]=[];
 const ctx={...h.anon,invites:{peek:()=>invite,accept:()=>undefined},signInPolicy:{current:()=>required,methods:{github:false,sso:["google"],newMemberMfaEnrollment:false}},
  sso:{providers:()=>[{key:"google",title:"Google"}],resolve:()=>null,offer:(k:string)=>k,prove:(_k:string,id:string)=>held.get(id)??null}} as never;
 const input={code:"CODE-1",username:"newbie",password:"a long enough password",keys:KEYS,...DEVICE};
 await assert.rejects(handlers["invites.accept_create_account"](ctx,input),(e:unknown)=>codeOf(e)==="validation.precondition_failed","no sign-in, no account");
 await assert.rejects(handlers["invites.accept_create_account"](ctx,{...input,ssoProvider:"google"}),(e:unknown)=>codeOf(e)==="auth.bad_credentials","a sign-in nobody finished");
 const{start}=await handlers["identity.sso_join_start"](ctx,{code:"CODE-1",provider:"google"}) as {start:string};
 const offer=decodeURIComponent(start.split("link=")[1]!);
 assert.ok(!offer.includes("CODE-1"),"the code is not what it is held under");
 held.set(offer,{email:"someone.else@firm.test",bind:()=>undefined});
 await assert.rejects(handlers["invites.accept_create_account"](ctx,{...input,ssoProvider:"google"}),(e:unknown)=>codeOf(e)==="auth.bad_credentials","another address does not take this invitation");
 held.set(offer,{email:"NEW@firm.test",bind:(p:string)=>{bound.push(p);}});
 await handlers["invites.accept_create_account"](ctx,{...input,ssoProvider:"google"}).catch(()=>undefined);
 assert.equal(bound.length,1,"the proved identity is bound to the new person");
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { claimAppLink, consumeBrowserInvite, desktopEntryRefusal, forgetAddressChecks, inviteAppLink, entryTarget, isPhoneAddress, isRelayAddress, lockedIdentity, PHONE_ADDRESS_IN_BROWSER, underRelayShell } from './entry.ts';
import { probeDirectSpace } from '../../../../../client/src/gateway/space-probe.ts';

test('Space entry accepts canonical invite and claim links without treating them as plain sign-in addresses',()=>{
 assert.deepEqual(entryTarget('https://team.example/join/ABCD-EFGH#fp=ab12cd34'),{kind:'join',address:'https://team.example',code:'ABCD-EFGH',fingerprint:'ab12cd34'});
 assert.deepEqual(entryTarget('team.example'),{kind:'signin',address:'https://team.example'});
 assert.equal(entryTarget('https://team.example/claim/abcdefghijklmnopqrstuvwxyz#s=spc_fixture')?.kind,'claim');
 for(const input of ['https://user:password@team.example','javascript:alert(1)','javascript:/join/ABCD-EFGH#fp=ab12cd34','file:///join/ABCD-EFGH#fp=ab12cd34','https://team.example/join/ABCD-EFGH','https://team.example/unknown','https://team.example/join/ABCD-EFGH#fp=%00'])assert.equal(entryTarget(input),null,input);
});
test('Lock marker carries display identity only and cannot retain a bearer or password',()=>{
 const marker=lockedIdentity({baseUrl:'https://team.example',personId:'usr_owner',token:'private',password:'never',name:'Owner'});
 assert.deepEqual(marker,{address:'https://team.example',personId:'usr_owner',name:'Owner'});
 assert.ok(!JSON.stringify(marker).includes('private'));assert.ok(!JSON.stringify(marker).includes('never'));
});

test('Spent browser invites leave history before the shell remounts; ordinary app links remain',()=>{const replaced:string[]=[];const history={replaceState(_data:unknown,_unused:string,url:string){replaced.push(url);}};consumeBrowserInvite({location:{pathname:'/join/ABCD-EFGH'},history});consumeBrowserInvite({location:{pathname:'/tasks'},history});assert.deepEqual(replaced,['/chat']);});

test('Desktop invite handoff encodes only the existing HTTPS join protocol and keeps local web invites in the browser',()=>{const route={kind:'join' as const,address:'https://space.example',code:'ABCD-EFGH',fingerprint:'ab12cd34'};const link=new URL(inviteAppLink(route)!);assert.equal(link.protocol,'vyre:');assert.equal(link.hostname,'join');assert.deepEqual(Object.fromEntries(link.searchParams),{address:route.address,code:route.code,fp:route.fingerprint});assert.equal(inviteAppLink({...route,address:'http://127.0.0.1:8421'}),null);});

test('A phone address invite keeps its code in the fragment and opens the same join; the desktop app is never offered for a phone address',()=>{
 const key='k'.repeat(43);
 assert.deepEqual(entryTarget(`https://acme.vyre.run/join#c=ABCD-EFGH&k=${key}&fp=ab12cd34`),{kind:'join',address:'https://acme.vyre.run',code:'ABCD-EFGH',fingerprint:'ab12cd34'});
 for(const bad of ['https://acme.vyre.run/join#c=ABCD-EFGH','https://acme.vyre.run/join#fp=ab12cd34','https://acme.vyre.run/join?x=1#c=ABCD-EFGH&fp=ab12cd34','https://acme.vyre.run/join#c=abc&fp=ab12cd34'])assert.equal(entryTarget(bad),null,bad);
 assert.equal(isPhoneAddress('https://acme.vyre.run'),true);
 assert.equal(isPhoneAddress('https://vyre.run'),false);
 assert.equal(isPhoneAddress('https://space.mylegalacademy.com'),false);
 assert.equal(inviteAppLink({kind:'join',address:'https://acme.vyre.run',code:'ABCD-EFGH',fingerprint:'ab12cd34'}),null);
 const replaced:string[]=[];consumeBrowserInvite({location:{pathname:'/join'},history:{replaceState(_d:unknown,_u:string,url:string){replaced.push(url);}}});assert.deepEqual(replaced,['/chat']);
});

// rc.14: mla.vyre.run is a Space server with its own DNS record and TLS, and the desktop app refused it as a relay phone address. The address is asked now, not guessed from its name.
const MLA='https://mla.vyre.run';
const joinAt=(address:string)=>({kind:'join' as const,address,code:'ABCD-EFGH',fingerprint:'ab12cd34'});
test('A direct Space on a vyre.run name (mla-style) joins and signs in from the desktop app, and its browser pages offer the app',async()=>{
 forgetAddressChecks();let asked=0;const probe=async(origin:string)=>{asked++;assert.equal(origin,MLA);return true;};
 assert.equal(await isRelayAddress(MLA,{probe,page:null as never}),false);
 assert.equal(await desktopEntryRefusal(joinAt(MLA),{probe}),null,'join');
 assert.equal(await desktopEntryRefusal({kind:'signin',address:MLA},{probe}),null,'sign in');
 assert.equal(asked,1,'a direct answer is kept for the session');
 const link=new URL(inviteAppLink(joinAt(MLA),false)!);assert.equal(link.protocol,'vyre:');assert.equal(link.searchParams.get('address'),MLA);
 assert.match(claimAppLink(MLA,'clm_abcdefgh','#fp=9f3c1a2b&s=spc_mla',false)!,/^vyre:\/\/claim\?/);
 // a real probe against an mla-style /healthz
 forgetAddressChecks();
 const healthz:typeof fetch=(async(input:RequestInfo|URL)=>String(input)===`${MLA}/healthz`?new Response(JSON.stringify({ok:true,roles:['space'],space:'spc_01JMLA'}),{status:200,headers:{'content-type':'application/json'}}):new Response(null,{status:404})) as typeof fetch;
 assert.equal(await isRelayAddress(MLA,{probe:(o)=>probeDirectSpace(o,{fetch:healthz,timeoutMs:500}),page:null as never}),false);
});
test('A relay phone address still gets the browser message, and its pages never offer the app',async()=>{
 forgetAddressChecks();let asked=0;const probe=async()=>{asked++;return false;};
 assert.equal(await desktopEntryRefusal(joinAt('https://irfad.vyre.run'),{probe}),PHONE_ADDRESS_IN_BROWSER);
 assert.equal(await desktopEntryRefusal({kind:'signin',address:'https://irfad.vyre.run'},{probe}),PHONE_ADDRESS_IN_BROWSER);
 assert.equal(asked,2,'a relay answer is not kept: the next try asks again');
 assert.equal(inviteAppLink(joinAt('https://irfad.vyre.run'),true),null);
 assert.equal(claimAppLink('https://irfad.vyre.run','clm_abcdefgh','#s=spc_mla',true),null);
 // the relay's real answers: the shell page for /healthz and 405 for the sign-in options
 const relay:typeof fetch=(async(_i:RequestInfo|URL,init?:RequestInit)=>init?.method==='POST'?new Response(null,{status:405}):new Response('<!doctype html>',{status:200,headers:{'content-type':'text/html'}})) as typeof fetch;
 assert.equal(await isRelayAddress('https://irfad.vyre.run',{probe:(o)=>probeDirectSpace(o,{fetch:relay,timeoutMs:500,routes:async()=>[{method:'POST',path:'/v1/identity/sign_in_options',cap:'identity.sign_in_options',v:1}]}),page:null as never}),true);
 // a page on the relay name runs under the phone shell's worker, which carries /healthz to the box: that page is a relay address without asking
 let probed=false;
 assert.equal(await isRelayAddress('https://irfad.vyre.run',{page:{origin:'https://irfad.vyre.run'},relayShell:()=>true,probe:async()=>{probed=true;return true;}}),true);
 assert.equal(probed,false);
 assert.equal(underRelayShell({serviceWorker:{controller:{scriptURL:'https://irfad.vyre.run/__vyre/sw.js'}}}),true);
 assert.equal(underRelayShell({serviceWorker:{controller:{scriptURL:'https://mla.vyre.run/sw.js'}}}),false);
 assert.equal(underRelayShell({serviceWorker:{controller:null}}),false);
 assert.equal(underRelayShell(undefined),false);
});
test('A probe that times out or fails falls back to the name rule, safely',async()=>{
 forgetAddressChecks();
 const hang:typeof fetch=((_i:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')));})) as typeof fetch;
 const t0=Date.now();
 assert.equal(await desktopEntryRefusal(joinAt('https://slow.vyre.run'),{probe:(o)=>probeDirectSpace(o,{fetch:hang,timeoutMs:50,routes:async()=>[{method:'POST',path:'/v1/identity/sign_in_options',cap:'identity.sign_in_options',v:1}]})}),PHONE_ADDRESS_IN_BROWSER);
 assert.ok(Date.now()-t0<2000);
 assert.equal(await isRelayAddress('https://broken.vyre.run',{probe:async()=>{throw new Error('boom');},page:null as never}),true);
});
test('An own domain is unchanged and never probed, including vyre.example.com',async()=>{
 forgetAddressChecks();const probe=async()=>{throw new Error('an own domain is not asked');};
 for(const address of ['https://vyre.example.com','https://space.mylegalacademy.com','https://vyre.run','https://a.b.vyre.run']){
  assert.equal(await isRelayAddress(address,{probe}),false,address);
  assert.equal(await desktopEntryRefusal(joinAt(address),{probe}),null,address);
  assert.ok(inviteAppLink(joinAt(address)),address);
 }
 assert.equal(await desktopEntryRefusal({kind:'claim',address:'https://irfad.vyre.run',url:'https://irfad.vyre.run/claim/x'},{probe}),null,'a claim is the app\'s own flow');
});

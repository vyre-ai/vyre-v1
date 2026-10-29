import test from 'node:test';import assert from 'node:assert/strict';import {completeRecovery,RecoveryAppliedError,recoveryFailureLine} from './recover.ts';
import {CapError} from '../shell/session/caps.ts';
const input={username:' Owner ',code:' saved-code ',password:'new-password-long',deviceClass:'web' as const};
function setup(){const calls:{cap:string;input:any}[]=[];const key=new Uint8Array([7,8,9]);const stored={baseUrl:'https://space.example',token:'fixture-new-session',personId:'usr_fixture',marker:'fixture-marker',def:{spaceId:'spc_fixture',name:'Fixture'}} as never;const deps={call:async(cap:string,input:unknown)=>{calls.push({cap,input});return cap==='identity.recovery_fetch'?{keys:{publicKey:'wrapped-public'}}:{session:{token:'fixture-new-session'}};},recover:async(code:string,password:string)=>{assert.equal(code,'saved-code');assert.equal(password,input.password);return{keys:{publicKey:'same-public',privateKeyWrapped:'same-private',spaceKeys:[{epoch:1,wrapped:'same-space'}],personKeyByPassword:'new-wrap'},recoveryProof:'one-use-fixture-proof',personKey:key};},verify:async()=>stored,holdKey:async()=>true,wipe:(key:Uint8Array)=>key.fill(0)};return{calls,key,stored,deps};}
test('saved-code recovery sends only a one-use proof and encrypted replacement, verifies before unlock and wipes opened key',async()=>{const h=setup();assert.equal(await completeRecovery(h.deps,input),h.stored);assert.deepEqual(h.calls.map(c=>c.cap),['identity.recovery_fetch','identity.recovery_restore']);assert.equal(h.calls[0]!.input.username,'owner');assert.equal(h.calls[1]!.input.recoveryProof,'one-use-fixture-proof');assert.equal(JSON.stringify(h.calls).includes('saved-code'),false);assert.equal(JSON.stringify(h.calls).includes('personKey"'),false);assert.deepEqual([...h.key],[0,0,0]);});
test('a successful recovery whose session cannot be verified tells the user to sign in and still wipes the key',async()=>{const h=setup();h.deps.verify=async()=>{throw new Error('offline');};let unlocked=false;h.deps.holdKey=async()=>{unlocked=true;return true;};await assert.rejects(()=>completeRecovery(h.deps,input),RecoveryAppliedError);assert.equal(unlocked,false);assert.deepEqual([...h.key],[0,0,0]);});

test('recovery failures are told apart: rate limit, outage, unreachable and a wrong code never read the same',()=>{
 const cap=(status:number,code:string)=>new CapError({code,message:'server words',traceId:'',status});
 const keyError=(code:string)=>Object.assign(new Error('x'),{name:'KeyError',code});
 const lines=[recoveryFailureLine(cap(429,'rate_limit.exceeded')),recoveryFailureLine(cap(500,'internal.unexpected')),recoveryFailureLine(new TypeError('Failed to fetch')),recoveryFailureLine(cap(401,'auth.invalid_code')),recoveryFailureLine(keyError('bad_blob')),recoveryFailureLine(cap(404,'validation.unknown_capability'))];
 assert.equal(new Set(lines).size,lines.length);
 assert.match(lines[0]!,/Too many/);assert.match(lines[1]!,/problem on its side/);assert.match(lines[2]!,/reach the Space/);
 assert.equal(recoveryFailureLine(keyError('bad_secret')),recoveryFailureLine(cap(401,'auth.invalid_code')),'a wrong code and a refused account read the same');
 assert.match(recoveryFailureLine(cap(401,'auth.invalid_code')),/username and saved code/);
 for(const line of [...lines,recoveryFailureLine(new Error('x'))])assert.ok(line.length<=110,'bounded line');
});

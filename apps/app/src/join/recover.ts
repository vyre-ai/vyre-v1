import type {RecoveryDownload} from '../../../../client/src/crypto/recovery.ts';
import type {StoredSession} from '../shell/session/stored.ts';
import {CapError} from '../shell/session/caps.ts';
import type {CapCall} from '../shell/session/caps.ts';
export class RecoveryAppliedError extends Error{constructor(){super('Your password was updated. Sign in with your new password to continue.');this.name='RecoveryAppliedError';}}
interface Deps{call:CapCall;recover(code:string,password:string,download:RecoveryDownload):Promise<{keys:unknown;recoveryProof:string;personKey:Uint8Array}>;verify(token:string):Promise<StoredSession>;holdKey(token:string,key:Uint8Array):Promise<boolean>;wipe(key:Uint8Array):void}
export async function completeRecovery(deps:Deps,input:{username:string;code:string;password:string;deviceClass:'web'|'desktop'}):Promise<StoredSession>{
 const username=input.username.trim().toLowerCase();
 const download=await deps.call('identity.recovery_fetch',{username}) as RecoveryDownload;
 const recovered=await deps.recover(input.code.trim(),input.password,download);
 try{const answer=await deps.call('identity.recovery_restore',{username,recoveryProof:recovered.recoveryProof,newPassword:input.password,keys:recovered.keys,deviceName:input.deviceClass==='desktop'?'Vyre desktop':'Web browser',deviceClass:input.deviceClass}) as {session?:{token?:string}};const token=answer.session?.token;if(!token)throw new RecoveryAppliedError();
 let stored:StoredSession;try{stored=await deps.verify(token);}catch{throw new RecoveryAppliedError();}
 await deps.holdKey(token,recovered.personKey).catch(()=>false);return stored;
 }finally{deps.wipe(recovered.personKey);}
}

/** What a failed recovery means to the person. A wrong username or code share one line so the form never says which account exists; rate limits, outages and a dead connection each get their own. */
export function recoveryFailureLine(error:unknown):string{
 if(error instanceof CapError){
  if(error.status===429||error.code.startsWith('rate_limit.'))return 'Too many recovery attempts. Wait a minute, then try again.';
  if(error.status>=500)return 'The Space had a problem on its side. Nothing was changed. Try again in a moment.';
  if(error.status===404||error.code==='validation.unknown_capability')return 'This Space does not support recovery with a saved code. Ask an administrator for a reset code.';
  return 'Couldn’t recover this account. Check the username and saved code, then try again.';
 }
 if(error instanceof Error&&error.name==='KeyError'){
  const code=(error as Error&{code?:string}).code;
  if(code==='bad_blob')return 'This recovery request expired. Nothing was changed. Try again.';
  return 'Couldn’t recover this account. Check the username and saved code, then try again.';
 }
 if(error instanceof TypeError||error instanceof DOMException)return 'Couldn’t reach the Space. Check the connection and try again. Nothing was changed.';
 return 'Couldn’t finish recovery. Nothing was changed. Try again.';
}

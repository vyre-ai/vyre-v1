import type {RecoveryDownload} from '../../../../client/src/crypto/recovery.ts';
import type {StoredSession} from '../shell/session/stored.ts';
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

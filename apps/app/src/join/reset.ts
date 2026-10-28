import type{MadeBundle}from'../../../../client/src/crypto/keys.ts';import type{StoredSession}from'../shell/session/stored.ts';import type{CapCall}from'../shell/session/caps.ts';
export class ResetAppliedError extends Error{constructor(){super('Your password was updated. Sign in with the new password to continue.');this.name='ResetAppliedError';}}
interface ResetDeps{call:CapCall;makeBundle(password:string,recoveryCode:string):Promise<MadeBundle>;verify(token:string):Promise<StoredSession>;holdKey(token:string,key:Uint8Array):Promise<boolean>;wipe(key:Uint8Array):void}
export async function completeReset(deps:ResetDeps,input:{code:string;password:string;recoveryCode:string;deviceClass:'web'|'desktop'}):Promise<StoredSession>{
 const bundle=await deps.makeBundle(input.password,input.recoveryCode);
 try{const keys={personKeyByPassword:bundle.personKeyByPassword,personKeyByRecovery:bundle.personKeyByRecovery,publicKey:bundle.publicKey,privateKeyWrapped:bundle.privateKeyWrapped,spaceKeys:[]};
 const answer=await deps.call('identity.reset_complete',{resetCode:input.code.trim(),newPassword:input.password,keys,deviceName:input.deviceClass==='desktop'?'Vyre desktop':'Web browser',deviceClass:input.deviceClass}) as{session?:{token?:string}};
 const token=answer.session?.token;if(!token)throw new ResetAppliedError();
 let stored:StoredSession;try{stored=await deps.verify(token);}catch{throw new ResetAppliedError();}
 await deps.holdKey(token,bundle.personKey).catch(()=>false);return stored;
 }finally{deps.wipe(bundle.personKey);}
}

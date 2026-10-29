// Browser half of the existing kernel sealTo wire format. The account's private key proves that the saved code opened its recovery wrap.
import {loadCryptoKeys} from './load.ts';
import type {Options} from './keys.ts';
export interface RecoveryCipherKeys{personKeyByRecovery:string;publicKey:string;privateKeyWrapped:string;spaceKeys:{epoch:number;wrapped:string}[]}
export interface RecoveryDownload{keys:RecoveryCipherKeys;challenge:{eph:string;iv:string;ct:string;tag:string};context:string}
export async function recoverAccountKeys(code:string,password:string,download:RecoveryDownload,options:Options={}){
 const k=await loadCryptoKeys(),subtle=crypto.subtle;
 const invalid=()=>new k.KeyError('bad_blob','This recovery request is invalid or has expired.');
 if(!download.context.startsWith('vyre/recovery-challenge/v1|')||download.context.length>1024)throw invalid();
 const decode=(value:string,length:number)=>{if(typeof value!=='string'||value.length>256||!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();const bytes=k.fromBase64(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'='));if(bytes.length!==length)throw invalid();return bytes;};
 const eph=decode(download.challenge.eph,32),iv=decode(download.challenge.iv,12),ct=decode(download.challenge.ct,32),tag=decode(download.challenge.tag,16);
 const bundle={...download.keys,personKeyByPassword:''};
 const opened=await k.openWithRecovery(code,bundle,options);let shared:Uint8Array|undefined,plain:Uint8Array|undefined;let done=false;
 try{
  const mine=await subtle.importKey('pkcs8',opened.privateKey as BufferSource,{name:'X25519'},false,['deriveBits']);
  const theirs=await subtle.importKey('raw',eph as BufferSource,{name:'X25519'},false,[]);
  shared=new Uint8Array(await subtle.deriveBits({name:'X25519',public:theirs},mine,256));
  const material=await subtle.importKey('raw',shared as BufferSource,'HKDF',false,['deriveKey']);
  const aes=await subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode(download.challenge.eph),info:new TextEncoder().encode('vyre:seal:to:v1')},material,{name:'AES-GCM',length:256},false,['decrypt']);
  const cipher=new Uint8Array(ct.length+tag.length);cipher.set(ct);cipher.set(tag,ct.length);
  plain=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:iv as BufferSource,additionalData:new TextEncoder().encode(download.context)},aes,cipher));if(plain.length!==32)throw invalid();
  const recoveryProof=k.toBase64(plain).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const keys=await k.wrapPersonKeyWithPassword(opened.personKey,password,bundle,options);done=true;return{keys,recoveryProof,personKey:opened.personKey};
 }catch(error){if(error instanceof k.KeyError)throw error;throw new k.KeyError('bad_secret','The saved code could not open this recovery request. Check it and try again.');}
 finally{k.wipe(opened.privateKey);if(shared)k.wipe(shared);if(plain)k.wipe(plain);if(!done)k.wipe(opened.personKey);}
}

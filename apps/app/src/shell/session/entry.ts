import { normalizeSpaceAddress } from '../../join/logic.ts';
import type { DesktopRoute } from './desktop.ts';
export type EntryTarget = Extract<DesktopRoute,{kind:'signin'|'join'}> | {kind:'claim';address:string;url:string};
export interface LockedIdentity {address:string;personId:string;name:string}
const control=/[\u0000-\u001f\u007f-\u009f]/u;
/** Canonical invitation/owner links remain distinct from a Space sign-in address. */
export function entryTarget(raw:string):EntryTarget|null{
 const value=raw.trim();if(!value||value.length>4096||control.test(value))return null;
 let url:URL;try{url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(value)?value:`https://${value}`);}catch{return null;}
 if(url.protocol!=='https:'&&url.protocol!=='http:')return null;const address=normalizeSpaceAddress(url.origin);if(!address||url.username||url.password)return null;
 if(url.pathname==='/'&&!url.search&&!url.hash)return{kind:'signin',address};
 const invite=/^\/join\/([A-Z0-9]{4}-[A-Z0-9]{4})\/?$/.exec(url.pathname);
 if(invite){const fingerprint=new URLSearchParams(url.hash.slice(1)).get('fp');return fingerprint&&/^[a-f0-9]{8,128}$/i.test(fingerprint)&&!url.search?{kind:'join',address,code:invite[1]!,fingerprint}:null;}
 if(/^\/claim\/[A-Za-z0-9_-]{16,256}$/.test(url.pathname)&&new URLSearchParams(url.hash.slice(1)).has('s'))return{kind:'claim',address,url:url.href};
 return null;
}
export function lockedIdentity(input:{baseUrl:string;personId:string;name?:string;[key:string]:unknown}):LockedIdentity{return{address:input.baseUrl,personId:input.personId,name:input.name||'Your account'};}
const LOCK_KEY='vyre.locked.v1';
const storage=()=>{try{return(globalThis as {sessionStorage?:Storage}).sessionStorage;}catch{return undefined;}};
export function readLock(address?:string):LockedIdentity|null{try{const item=JSON.parse(storage()?.getItem(LOCK_KEY)??'null') as LockedIdentity|null;return item&&(!address||item.address===address)&&typeof item.personId==='string'&&typeof item.name==='string'?lockedIdentity({...item,baseUrl:item.address}):null;}catch{return null;}}
export function storeLock(identity:LockedIdentity):void{try{storage()?.setItem(LOCK_KEY,JSON.stringify(identity));}catch{/* the current window still locks when storage is unavailable */}}
export function clearLock():void{try{storage()?.removeItem(LOCK_KEY);}catch{/* blocked storage */}}

/** Remove a spent or dismissed browser invite before shell navigation can remount the gate. */
export function consumeBrowserInvite(browser: {location?:{pathname:string};history?:{replaceState(data:unknown,unused:string,url:string):void}}=globalThis as never):void{if(browser.location?.pathname.startsWith('/join/'))browser.history?.replaceState(null,'','/home');}

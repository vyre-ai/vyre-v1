import { normalizeSpaceAddress } from '../../join/logic.ts';
import type { DesktopRoute } from './desktop.ts';
import { probeDirectSpace } from './caps.ts';
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
 // a phone address's invite keeps its code in the fragment (/join#c=<code>&k=<the invite's key>&fp=), which never reaches the relay
 if(/^\/join\/?$/.test(url.pathname)&&!url.search){const h=new URLSearchParams(url.hash.slice(1));const code=h.get('c'),fingerprint=h.get('fp');return code&&/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)&&fingerprint&&/^[a-f0-9]{8,128}$/i.test(fingerprint)?{kind:'join',address,code,fingerprint}:null;}
 if(/^\/claim\/[A-Za-z0-9_-]{16,256}$/.test(url.pathname)&&new URLSearchParams(url.hash.slice(1)).has('s'))return{kind:'claim',address,url:url.href};
 return null;
}
/** The desktop shell on a Mac, the one place "Run this Mac as the Space server" is offered (a phone browser also says Mac in its user agent, so iPhone and iPad are left out). */
export function isMacShell(nav:{platform?:string;userAgent?:string}|undefined=(globalThis as {navigator?:{platform?:string;userAgent?:string}}).navigator):boolean{
 const text=`${nav?.platform??''} ${nav?.userAgent??''}`;
 return /Mac/.test(text)&&!/iPhone|iPad|iPod/.test(text);
}
export function lockedIdentity(input:{baseUrl:string;personId:string;name?:string;[key:string]:unknown}):LockedIdentity{return{address:input.baseUrl,personId:input.personId,name:input.name||'Your account'};}
const LOCK_KEY='vyre.locked.v1';
const storage=()=>{try{return(globalThis as {sessionStorage?:Storage}).sessionStorage;}catch{return undefined;}};
export function readLock(address?:string):LockedIdentity|null{try{const item=JSON.parse(storage()?.getItem(LOCK_KEY)??'null') as LockedIdentity|null;return item&&(!address||item.address===address)&&typeof item.personId==='string'&&typeof item.name==='string'?lockedIdentity({...item,baseUrl:item.address}):null;}catch{return null;}}
export function storeLock(identity:LockedIdentity):void{try{storage()?.setItem(LOCK_KEY,JSON.stringify(identity));}catch{/* the current window still locks when storage is unavailable */}}
export function clearLock():void{try{storage()?.removeItem(LOCK_KEY);}catch{/* blocked storage */}}

/** Remove a spent or dismissed browser invite before shell navigation can remount the gate. */
export function consumeBrowserInvite(browser: {location?:{pathname:string};history?:{replaceState(data:unknown,unused:string,url:string):void}}=globalThis as never):void{const p=browser.location?.pathname??'';if(p==='/join'||p.startsWith('/join/'))browser.history?.replaceState(null,'','/chat');}

/** The name rule alone: <name>.vyre.run, the shape of a relay phone address. Not an answer by itself: a Space server can hold a vyre.run name with its own DNS record and TLS (mla.vyre.run).
 * Use isRelayAddress, which asks the address; this is its fallback when the address does not answer as a Space. */
export function isPhoneAddress(address:string):boolean{try{const host=new URL(address).hostname.toLowerCase();return host.endsWith('.vyre.run')&&host.split('.').length===3;}catch{return false;}}
/** What the desktop app says for a phone address, in place of a sign-in or join that cannot reach it. */
export const PHONE_ADDRESS_IN_BROWSER='This Space is reached through Vyre’s relay. Open the link in your browser.';
/** A page on a relay name runs under the phone shell's service worker (/__vyre/sw.js), which carries every request to the box: its /healthz is the box's, so the page's own probe proves nothing there. */
export function underRelayShell(nav:{serviceWorker?:{controller?:{scriptURL?:string}|null}}|undefined=(globalThis as {navigator?:{serviceWorker?:{controller?:{scriptURL?:string}|null}}}).navigator):boolean{try{const s=nav?.serviceWorker?.controller?.scriptURL;return!!s&&new URL(s).pathname==='/__vyre/sw.js';}catch{return false;}}
export interface AddressCheck{probe?:(origin:string)=>Promise<boolean>;page?:{origin?:string}|undefined;relayShell?:()=>boolean}
const direct=new Map<string,Promise<boolean>>();
/** Forget what addresses answered (tests). */
export function forgetAddressChecks():void{direct.clear();}
/**
 * Is this a relay phone address? Decided by what it answers, not by its name. An address that is not a vyre.run name is never one and is not asked. A vyre.run name is direct when it answers
 * as a Space server (client/src/gateway/space-probe.ts: /healthz naming a Space, or the sign-in options), which the relay cannot do; otherwise, and on a timeout, the name rule stands.
 * A direct answer is kept for the session; a relay answer is not, so a slow network asks again next time.
 */
export async function isRelayAddress(address:string,o:AddressCheck={}):Promise<boolean>{
 if(!isPhoneAddress(address))return false;
 const origin=new URL(address).origin;
 const page=o.page!==undefined?o.page:(globalThis as {location?:{origin?:string}}).location;
 if(page?.origin===origin&&(o.relayShell??underRelayShell)())return true;
 let asked=direct.get(origin);
 if(!asked){asked=(o.probe??probeDirectSpace)(origin).catch(()=>false);direct.set(origin,asked);}
 const yes=await asked;
 if(!yes&&direct.get(origin)===asked)direct.delete(origin);
 return!yes;
}
/** Why the desktop app cannot open this sign-in or join, or null when it can. A claim link is the app's own flow. */
export async function desktopEntryRefusal(target:EntryTarget,o?:AddressCheck):Promise<string|null>{if(target.kind==='claim')return null;return await isRelayAddress(target.address,o)?PHONE_ADDRESS_IN_BROWSER:null;}
/** The existing desktop join protocol accepts HTTPS Space addresses only, and not a relay phone address, which the desktop app cannot reach. `relay` is isRelayAddress's answer; the name rule until it arrives. */
export function inviteAppLink(route:Extract<DesktopRoute,{kind:'join'}>,relay:boolean=isPhoneAddress(route.address)):string|null{if(!route.address.startsWith('https://')||relay)return null;return`vyre://join?${new URLSearchParams({address:route.address,code:route.code,fp:route.fingerprint})}`;}
/** The owner claim handed to the desktop app (rc.14): the same link, as vyre://claim, so the app can use the account it already has. HTTPS Spaces only, not a relay phone address (`relay` as for inviteAppLink). */
export function claimAppLink(address:string,token:string,fragment:string,relay:boolean=isPhoneAddress(address)):string|null{if(!address.startsWith('https://')||relay||!/^[A-Za-z0-9_-]{8,200}$/.test(token))return null;const h=new URLSearchParams(fragment.replace(/^#/,''));const s=h.get('s');if(!s)return null;const q=new URLSearchParams({address,token,s});for(const k of['fp','n']){const v=h.get(k);if(v)q.set(k,v);}return`vyre://claim?${q}`;}
export const VYRE_DOWNLOADS='https://github.com/vyre-ai/vyre-v1/releases';

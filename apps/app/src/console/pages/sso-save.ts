// The logic behind the Google and Microsoft sign-in forms, with no screen in it so a host test can run the same code: what a form may save, the redirect address, and the save itself (the secret
// into the Vault in a Restricted folder, only its handle into members.sso.set). SsoSections.tsx draws it.
import type {MembersSsoListOut} from "../../../../../generated/types.ts";

export type SsoKey="google"|"microsoft";
export type SsoProvider=MembersSsoListOut["providers"][number];
type Call=(cap:string,input:unknown)=>Promise<unknown>;

export const SSO_TITLE:Record<SsoKey,string>={google:"Google",microsoft:"Microsoft"};
export const GOOGLE_ISSUER="https://accounts.google.com";
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN=/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
export const TENANT_LABEL="Tenant ID (a GUID from Azure, Overview)";
export const TENANT_HINT="In the Azure portal open Microsoft Entra ID, then Overview, and copy the Tenant ID. Names like common or organizations and domain names are not accepted.";

/** The address to register at the provider: the server's own callback address for this provider (read from the GitHub app's address, which the server builds from its public origin). */
export function redirectUrl(githubCallback:string,key:SsoKey):string{
 const base=githubCallback.replace(/\/auth\/github\/callback\/?$/,"");
 return `${base||""}/auth/sso/${key}/callback`;
}
/** The tenant a saved Microsoft provider is for, read back from its pinned issuer. */
export function tenantOf(issuer:string|undefined):string{
 return /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0$/i.exec(issuer??"")?.[1]??"";
}

export interface SsoInput{key:SsoKey;clientId:string;secret:string;domain:string;tenant:string;enabled:boolean}

/** Why a form cannot be saved yet, in words for a person, or null. `hasSecret` is true when a secret is already kept in the Vault. */
export function ssoProblem(i:SsoInput,hasSecret:boolean):string|null{
 if(!i.clientId.trim())return "Paste the app's Client ID.";
 if(!i.secret.trim()&&!hasSecret)return "Paste the Client secret too; it is kept in the Vault and not shown again.";
 if(!DOMAIN.test(i.domain.trim()))return "Name the firm's domain, for example firm.com. Without it nobody can sign in.";
 if(i.key==="microsoft"&&!GUID.test(i.tenant.trim()))return `Microsoft sign-in needs the Tenant ID, a GUID. ${TENANT_HINT}`;
 return null;
}

const rid=():string=>`sso-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const itemName=(key:SsoKey):string=>`Sso_${SSO_TITLE[key]}_Secret`;

/** The Vault copy of a sign-in secret is for people cleared at the top label only (Owner and Admin): labelled Restricted, a Member, a Developer, a Guest and every agent are above their clearance and cannot list, read, use or change it. */
const restrict=(call:Call,type:"vault_item"|"vault_folder",id:string):Promise<unknown>=>call("access.labels.set",{resource:{type,id},label:"restricted"});

/** Puts the secret in the Vault as a Space-only item in a Restricted folder (a new item, or the saved one updated) and returns its handle. The secret goes nowhere else. */
export async function keepSecret(call:Call,key:SsoKey,secret:string):Promise<string>{
 const name=itemName(key);
 const found=(await call("vault.items.list",{q:name}) as {items:{id:string;name:string;handle:string;folderId?:string}[]}).items.find(x=>x.name===name);
 if(found){
  await restrict(call,"vault_item",found.id);if(found.folderId)await restrict(call,"vault_folder",found.folderId);
  await call("vault.item.update",{itemId:found.id,fieldsSet:[{key:"client_secret",value:secret,secret:true}],spaceOnly:true,idempotencyKey:rid()});return found.handle;
 }
 const folders=(await call("vault.folders.list",{scope:"shared"}) as {folders:{id?:string;folderId?:string;name:string}[]}).folders;
 const have=folders.find(f=>f.name==="Sign-in");
 let folderId=have?(have.folderId??have.id):undefined;
 if(!folderId){const made=await call("vault.folders.create",{name:"Sign-in",scope:"shared",idempotencyKey:rid()}) as {folder:{id?:string;folderId?:string}};folderId=made.folder.folderId??made.folder.id;}
 await restrict(call,"vault_folder",folderId!);
 const put=await call("vault.item.put",{folderId,name,kind:"other",fields:[{key:"client_secret",value:secret,secret:true}],spaceOnly:true,idempotencyKey:rid()}) as {item:{id:string;handle:string}};
 await restrict(call,"vault_item",put.item.id);
 return put.item.handle;
}

/** Saves one provider: validates, keeps a typed secret in the Vault, then members.sso.set with the handle (never the secret). Resolves with words for a person. */
export async function saveSso(call:Call,i:SsoInput,saved:SsoProvider|undefined):Promise<{ok:true;message:string}|{ok:false;message:string}>{
 const problem=ssoProblem(i,!!saved?.clientSecretHandle);
 if(problem)return {ok:false,message:problem};
 try{
  const handle=i.secret.trim()?await keepSecret(call,i.key,i.secret.trim()):saved!.clientSecretHandle;
  const issuer=i.key==="google"?GOOGLE_ISSUER:`https://login.microsoftonline.com/${i.tenant.trim().toLowerCase()}/v2.0`;
  await call("members.sso.set",{provider:{key:i.key,title:SSO_TITLE[i.key],issuer,clientId:i.clientId.trim(),clientSecretHandle:handle,enabled:i.enabled,domainHint:i.domain.trim().toLowerCase()}});
  return {ok:true,message:`${SSO_TITLE[i.key]} sign-in saved`};
 }catch(e){const x=e as {message?:string;code?:string};return {ok:false,message:`${x.message??"Couldn't save this"}${x.code?` (${x.code})`:""}.`};}
}


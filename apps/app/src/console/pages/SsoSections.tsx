// "Sign in with Google" and "Sign in with Microsoft" on the Console sign-in policy page: the firm's own OIDC app. An admin pastes the app's Client ID and Client secret and names the firm's domain
// (Microsoft also takes the Tenant ID, a GUID). The secret never goes into members.sso.set: it is put in the Vault as a Space-only item and only its handle is saved, and no page, reply or note
// shows it again (the page learns only "set"). The page shows the redirect address to register at the provider with a Copy button, an On/Off switch, Save, and "Test it" (members.sso.test).
import {useState} from "react";
import type {ReactElement} from "react";
import type {MembersSsoListOut} from "../../../../../generated/types.ts";
import {ObjectSection} from "../../../../../ui/src/ObjectPage/index.tsx";
import {Row} from "../../../../../ui/src/Row/index.tsx";
import {useConsoleData} from "../shell/data.tsx";
import {Group} from "../shell/ui.tsx";
import {Actions,Button,Field,Note,ReadState,Select,useAction,useRead} from "./shared.tsx";

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

/** Puts the secret in the Vault as a Space-only item (a new one, or the saved one updated) and returns its handle. The secret goes nowhere else. */
export async function keepSecret(call:Call,key:SsoKey,secret:string):Promise<string>{
 const name=itemName(key);
 const found=(await call("vault.items.list",{q:name}) as {items:{id:string;name:string;handle:string}[]}).items.find(x=>x.name===name);
 if(found){await call("vault.item.update",{itemId:found.id,fieldsSet:[{key:"client_secret",value:secret,secret:true}],spaceOnly:true,idempotencyKey:rid()});return found.handle;}
 const folders=(await call("vault.folders.list",{scope:"shared"}) as {folders:{id?:string;folderId?:string;name:string}[]}).folders;
 const have=folders.find(f=>f.name==="Sign-in");
 let folderId=have?(have.folderId??have.id):undefined;
 if(!folderId){const made=await call("vault.folders.create",{name:"Sign-in",scope:"shared",idempotencyKey:rid()}) as {folder:{id?:string;folderId?:string}};folderId=made.folder.folderId??made.folder.id;}
 const put=await call("vault.item.put",{folderId,name,kind:"other",fields:[{key:"client_secret",value:secret,secret:true}],spaceOnly:true,idempotencyKey:rid()}) as {item:{handle:string}};
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

export interface SsoViewProps{
 kind:SsoKey;provider?:SsoProvider|undefined;redirect:string;editing?:boolean;busy?:boolean;note?:string;tested?:string;
 onSave?:(input:SsoInput)=>void;onTest?:()=>void;onEdit?:()=>void;onCancel?:()=>void;onRemove?:()=>void;
}

export function SsoProviderView({kind,provider,redirect,editing=false,busy=false,note="",tested="",onSave,onTest,onEdit,onCancel,onRemove}:SsoViewProps):ReactElement{
 const title=SSO_TITLE[kind];
 const[clientId,setClientId]=useState(provider?.clientId??"");const[secret,setSecret]=useState("");const[domain,setDomain]=useState(provider?.domainHint??"");
 const[tenant,setTenant]=useState(kind==="microsoft"?tenantOf(provider?.issuer):"");const[enabled,setEnabled]=useState(provider?.enabled??true);const[copied,setCopied]=useState(false);
 const copy=()=>{void (globalThis as {navigator?:{clipboard?:{writeText(text:string):Promise<void>}}}).navigator?.clipboard?.writeText(redirect).then(()=>setCopied(true),()=>setCopied(false));};
 const input:SsoInput={key:kind,clientId,secret,domain,tenant,enabled};
 const problem=ssoProblem(input,!!provider?.clientSecretHandle);
 return <ObjectSection title={`Sign in with ${title}`}>
  <Group>
   <Row title="Status" note={!provider?"Not set up":provider.enabled?`On for ${provider.domainHint??"no domain yet"}`:"Set up, turned off"}/>
   {provider?<Row title="Client ID" note={provider.clientId}/>:null}
   {provider?<Row title="Client secret" note="Set, kept in the Vault"/>:null}
   {kind==="microsoft"&&provider?<Row title="Tenant ID" note={tenantOf(provider.issuer)||"Not set"}/>:null}
   <Row title="Redirect URL to register" note={redirect}/>
  </Group>
  <Actions><Button label={copied?"Copied":"Copy redirect URL"} testID={`sso-${kind}-copy`} onPress={copy}/>{provider?<Button label="Test it" testID={`sso-${kind}-test`} onPress={()=>onTest?.()}/>:null}{!editing?<Button label={provider?"Change":"Set up"} testID={`sso-${kind}-edit`} onPress={()=>onEdit?.()}/>:null}</Actions>
  {tested?<Note>{tested}</Note>:null}
  <Note>{`Register this redirect URL in your ${title} app, then paste the app's Client ID and a Client secret below. Only existing members and people with an accepted invite can sign in.`}</Note>
  {editing?<>
   <Field label={`${title} Client ID`} value={clientId} onChange={setClientId} testID={`sso-${kind}-client-id`}/>
   <Field label={provider?.clientSecretHandle?"New Client secret (leave empty to keep the saved one)":"Client secret"} value={secret} onChange={setSecret} secure testID={`sso-${kind}-client-secret`}/>
   <Field label="Firm domain (for example firm.com)" value={domain} onChange={setDomain} testID={`sso-${kind}-domain`}/>
   {kind==="microsoft"?<><Field label={TENANT_LABEL} value={tenant} onChange={setTenant} testID="sso-microsoft-tenant"/><Note>{TENANT_HINT}</Note></>:null}
   <Select label="Sign in with this provider" value={String(enabled)} options={[{key:"true",title:"On"},{key:"false",title:"Off"}]} onChange={v=>setEnabled(v==="true")}/>
   {problem&&(clientId||domain||secret)?<Note>{problem}</Note>:null}
   <Actions><Button label={`Save ${title} sign-in`} testID={`sso-${kind}-save`} disabled={busy||!!problem} onPress={()=>{onSave?.(input);setSecret("");}}/><Button label="Cancel" testID={`sso-${kind}-cancel`} onPress={()=>onCancel?.()}/>{provider?<Button label={`Remove ${title} sign-in`} testID={`sso-${kind}-remove`} danger disabled={busy} onPress={()=>onRemove?.()}/>:null}</Actions>
  </>:null}
  {note?<Note>{note}</Note>:null}
 </ObjectSection>;
}

function SsoSection({kind,providers,callback,refresh}:{kind:SsoKey;providers:readonly SsoProvider[];callback:string;refresh:()=>void}):ReactElement{
 const data=useConsoleData();const[editing,setEditing]=useState(false);const[tested,setTested]=useState("");const[note,setNote]=useState("");const action=useAction(refresh);
 const provider=providers.find(p=>p.key===kind);
 const save=(input:SsoInput)=>{setNote("");void saveSso(data.call,input,provider).then(r=>{setNote(r.message);if(r.ok){setEditing(false);refresh();}});};
 const test=()=>{setTested("Testing...");void (data.call("members.sso.test",{key:kind}) as Promise<{ok:boolean;detail?:string}>).then(r=>setTested(r.ok?`The test passed. ${r.detail??""}`.trim():(r.detail??"The test did not pass.")),()=>setTested("Could not run the test."));};
 return <SsoProviderView kind={kind} provider={provider} redirect={redirectUrl(callback,kind)} editing={editing} busy={action.busy} note={note||action.note} tested={tested} onSave={save} onTest={test} onEdit={()=>setEditing(true)} onCancel={()=>{setEditing(false);setNote("");}} onRemove={()=>void action.run("members.sso.remove",{key:kind},`${SSO_TITLE[kind]} sign-in removed`).then(()=>setEditing(false))}/>;
}

/** Both sections for the sign-in policy page. */
export function SsoSections():ReactElement|null{
 const list=useRead<MembersSsoListOut>("members.sso.list",{});
 const gh=useRead<{github:{callbackUrl:string}}>("members.sign_in_github.get",{});
 if(!list.data)return list.error?<ReadState error={list.error} retry={list.refresh}/>:null;
 const callback=gh.data?.github.callbackUrl??`${(globalThis as {location?:{origin?:string}}).location?.origin??""}/auth/github/callback`;
 return <>{(["google","microsoft"] as const).map(k=><SsoSection key={k} kind={k} providers={list.data!.providers} callback={callback} refresh={list.refresh}/>)}</>;
}

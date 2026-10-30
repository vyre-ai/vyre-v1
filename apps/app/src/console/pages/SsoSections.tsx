// "Sign in with Google" and "Sign in with Microsoft" on the Console sign-in policy page: the firm's own OIDC app. An admin pastes the app's Client ID and Client secret and names the firm's domain
// (Microsoft also takes the Tenant ID, a GUID). The secret never goes into members.sso.set: it is put in the Vault as a Space-only item and only its handle is saved, and no page, reply or note
// shows it again (the page learns only "set"). The page shows the redirect address to register at the provider with a Copy button, an On/Off switch, Save, and "Test it" (members.sso.test).
import {useState} from "react";
import type {ReactElement} from "react";
import type {MembersSsoListOut} from "../../../../../generated/types.ts";
import {SSO_TITLE,TENANT_HINT,TENANT_LABEL,redirectUrl,saveSso,ssoProblem,tenantOf} from "./sso-save.ts";
import type {SsoInput,SsoKey,SsoProvider} from "./sso-save.ts";
import {ObjectSection} from "../../../../../ui/src/ObjectPage/index.tsx";
import {Row} from "../../../../../ui/src/Row/index.tsx";
import {useConsoleData} from "../shell/data.tsx";
import {Group} from "../shell/ui.tsx";
import {Actions,Button,Field,Note,ReadState,Select,useAction,useRead} from "./shared.tsx";

export {GOOGLE_ISSUER,SSO_TITLE,TENANT_HINT,TENANT_LABEL,keepSecret,redirectUrl,saveSso,ssoProblem,tenantOf} from "./sso-save.ts";
export type {SsoInput,SsoKey,SsoProvider} from "./sso-save.ts";
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

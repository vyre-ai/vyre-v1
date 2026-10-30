// Console > Policies > Sign-in: the Google and Microsoft forms. Save puts the secret in the Vault and only its handle in members.sso.set; no page shows a secret back; Microsoft refuses common and any
// name that is not a tenant GUID; the redirect address to register is the server's own, with a Copy button; the onboarding card opens this page.
import test from "node:test";
import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {SsoProviderView,redirectUrl,saveSso,ssoProblem,tenantOf,TENANT_HINT,TENANT_LABEL} from "../pages/SsoSections.tsx";
import type {SsoInput,SsoProvider} from "../pages/SsoSections.tsx";
import {SSO_SETUP_HASH,SignInDomainCard} from "../../onboarding/SuiteCards.tsx";

const TENANT="0f6c0b1e-3c1a-4a52-9a57-6a1f2f2f0a11";
const input=(o:Partial<SsoInput>={}):SsoInput=>({key:"google",clientId:"1234-abc.apps.googleusercontent.com",secret:"GOCSPX-supersecretvalue0001",domain:"firm.com",tenant:"",enabled:true,...o});
function fakeCall(over:Record<string,(i:never)=>unknown>={}){
 const calls:{cap:string;input:unknown}[]=[];
 const call=async(cap:string,i:unknown):Promise<unknown>=>{
  calls.push({cap,input:i});
  const f=over[cap];if(f)return f(i as never);
  if(cap==="vault.items.list")return {items:[]};
  if(cap==="vault.folders.list")return {folders:[]};
  if(cap==="vault.folders.create")return {folder:{id:"vfd_1"}};
  if(cap==="vault.item.put")return {item:{id:"vit_1",handle:"#Sso_Google_Secret"}};
  return {ok:true};
 };
 return {call,calls};
}
const saved:SsoProvider={key:"google",title:"Google",issuer:"https://accounts.google.com",clientId:"1234-abc.apps.googleusercontent.com",clientSecretHandle:"#Sso_Google_Secret",enabled:true,domainHint:"firm.com"};

test("saving Google keeps the secret in the Vault and sends members.sso.set only the handle",async()=>{
 const {call,calls}=fakeCall();
 const r=await saveSso(call,input(),undefined);
 assert.equal(r.ok,true);
 const put=calls.find(c=>c.cap==="vault.item.put")!.input as {spaceOnly:boolean;fields:{key:string;value:string;secret:boolean}[]};
 assert.equal(put.spaceOnly,true);assert.deepEqual(put.fields,[{key:"client_secret",value:"GOCSPX-supersecretvalue0001",secret:true}]);
 const set=calls.find(c=>c.cap==="members.sso.set")!;
 assert.deepEqual(set.input,{provider:{key:"google",title:"Google",issuer:"https://accounts.google.com",clientId:"1234-abc.apps.googleusercontent.com",clientSecretHandle:"#Sso_Google_Secret",enabled:true,domainHint:"firm.com"}});
 assert.ok(!JSON.stringify(set.input).includes("supersecret"),"the secret is not in the sso call");
 assert.deepEqual(calls.map(c=>c.cap),["vault.items.list","vault.folders.list","vault.folders.create","access.labels.set","vault.item.put","access.labels.set","members.sso.set"]);
 const labels=calls.filter(c=>c.cap==="access.labels.set").map(c=>c.input);
 assert.deepEqual(labels,[{resource:{type:"vault_folder",id:"vfd_1"},label:"restricted"},{resource:{type:"vault_item",id:"vit_1"},label:"restricted"}],"the folder is restricted before the item goes in, and the item too");
});

test("changing a provider without a new secret keeps the saved handle and never touches the Vault; a new secret updates the same item",async()=>{
 const a=fakeCall();
 assert.equal((await saveSso(a.call,input({secret:"",domain:"Firm.com",enabled:false}),saved)).ok,true);
 assert.deepEqual(a.calls.map(c=>c.cap),["members.sso.set"]);
 assert.deepEqual((a.calls[0]!.input as {provider:{clientSecretHandle:string;domainHint:string;enabled:boolean}}).provider.clientSecretHandle,"#Sso_Google_Secret");
 assert.equal((a.calls[0]!.input as {provider:{domainHint:string}}).provider.domainHint,"firm.com");
 const b=fakeCall({"vault.items.list":()=>({items:[{id:"vit_1",name:"Sso_Google_Secret",handle:"#Sso_Google_Secret",folderId:"vfd_1"}]})});
 assert.equal((await saveSso(b.call,input({secret:"GOCSPX-rotatedvalue0002"}),saved)).ok,true);
 assert.deepEqual(b.calls.map(c=>c.cap),["vault.items.list","access.labels.set","access.labels.set","vault.item.update","members.sso.set"]);
});

test("Microsoft refuses common, organizations and a domain name for the tenant, and saves a GUID as the pinned issuer",async()=>{
 for(const bad of ["common","organizations","consumers","firm.onmicrosoft.com",""]){
  const {call,calls}=fakeCall();
  const r=await saveSso(call,input({key:"microsoft",tenant:bad}),undefined);
  assert.equal(r.ok,false,bad);assert.ok(r.message.includes("Tenant ID"),r.message);assert.equal(calls.length,0,"nothing is sent");
 }
 const {call,calls}=fakeCall({"vault.item.put":()=>({item:{handle:"#Sso_Microsoft_Secret"}})});
 assert.equal((await saveSso(call,input({key:"microsoft",tenant:TENANT.toUpperCase()}),undefined)).ok,true);
 const p=(calls.find(c=>c.cap==="members.sso.set")!.input as {provider:{issuer:string;title:string}}).provider;
 assert.equal(p.issuer,`https://login.microsoftonline.com/${TENANT}/v2.0`);assert.equal(p.title,"Microsoft");
 assert.equal(tenantOf(p.issuer),TENANT);
});

test("the form needs the client id, a secret (or a kept one) and the firm domain",()=>{
 assert.equal(ssoProblem(input(),false),null);
 assert.match(ssoProblem(input({clientId:" "}),false)!,/Client ID/);
 assert.match(ssoProblem(input({secret:""}),false)!,/Client secret/);
 assert.equal(ssoProblem(input({secret:""}),true),null);
 assert.match(ssoProblem(input({domain:"firm"}),false)!,/domain/);
});

test("the redirect address is the server's, per provider",()=>{
 assert.equal(redirectUrl("https://space.example/auth/github/callback","google"),"https://space.example/auth/sso/google/callback");
 assert.equal(redirectUrl("https://space.example/auth/github/callback","microsoft"),"https://space.example/auth/sso/microsoft/callback");
});

test("the Google section shows the redirect URL with Copy, the fields, On/Off, Save and Test it, and never a secret value",()=>{
 const url="https://space.example/auth/sso/google/callback";
 const set=renderToStaticMarkup(<SsoProviderView kind="google" redirect={url} editing/>);
 assert.ok(set.includes("Sign in with Google")&&set.includes(url));
 for(const id of ["sso-google-copy","sso-google-client-id","sso-google-client-secret","sso-google-domain","sso-google-save"])assert.ok(set.includes(`data-testid="${id}"`),id);
 assert.ok(set.includes("Not set up")&&set.includes("On")&&!set.includes('data-testid="sso-google-test"'));
 const done=renderToStaticMarkup(<SsoProviderView kind="google" provider={saved} redirect={url} editing/>);
 assert.ok(done.includes("Set, kept in the Vault")&&done.includes("New Client secret (leave empty to keep the saved one)")&&done.includes('data-testid="sso-google-test"')&&done.includes("On for firm.com"));
 assert.doesNotMatch(done,/supersecret|GOCSPX|value="[^"]*secret/i);
 const quiet=renderToStaticMarkup(<SsoProviderView kind="google" provider={saved} redirect={url}/>);
 assert.ok(!quiet.includes('data-testid="sso-google-client-secret"')&&quiet.includes('data-testid="sso-google-edit"')&&quiet.includes("Change"));
});

test("the Microsoft section adds the Tenant ID field with its label and the Azure hint",()=>{
 const url="https://space.example/auth/sso/microsoft/callback";
 const html=renderToStaticMarkup(<SsoProviderView kind="microsoft" redirect={url} editing/>);
 assert.ok(html.includes(TENANT_LABEL)&&html.includes(TENANT_HINT)&&html.includes('data-testid="sso-microsoft-tenant"'));
 assert.ok(TENANT_LABEL==="Tenant ID (a GUID from Azure, Overview)");
 const filled=renderToStaticMarkup(<SsoProviderView kind="microsoft" provider={{...saved,key:"microsoft",title:"Microsoft",issuer:`https://login.microsoftonline.com/${TENANT}/v2.0`}} redirect={url}/>);
 assert.ok(filled.includes(TENANT));
});

test("the onboarding card has a Set up button that opens the sign-in policy page in the Console",()=>{
 const html=renderToStaticMarkup(<SignInDomainCard call={async()=>({providers:[]})} onOpenConsole={()=>undefined} onSetUp={()=>undefined} onDone={()=>undefined}/>);
 assert.ok(html.includes('data-testid="signin-setup"')&&html.includes("Set up"));
 assert.equal(SSO_SETUP_HASH,"screen=access.policies&policyId=sign_in");
});

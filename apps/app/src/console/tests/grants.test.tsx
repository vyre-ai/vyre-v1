import test from "node:test";
import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {Grants,expiryConditions} from "../pages/Grants.tsx";
import {Checker} from "../pages/Checker.tsx";
import {resourceNameRequest} from "../objects/names.ts";
import {ConsoleDataProvider} from "../shell/data.tsx";
import {createSampleConsole} from "../shell/sample.ts";
const NOW=1790000000000;
function draw(child:React.ReactNode):string{const base=createSampleConsole().data;const rows:Record<string,unknown>={"access.grants.list":{grants:[]},"files.folder.search":{folders:[]}};return renderToStaticMarkup(<ConsoleDataProvider value={{...base,screens:{...base.screens,capQuery:(cap:string)=>{const state={status:"ready",data:rows[cap]};return{subscribe:()=>()=>undefined,getSnapshot:()=>state};}} as never}}>{child}</ConsoleDataProvider>);}
test("expiry edits preserve row, field, label and window bounds and reject invalid/past dates",()=>{const previous={rowFilter:{op:"owner_me"},hiddenFields:["salary"],labelCeiling:"internal" as const,window:{from:NOW-1000,to:NOW+100000},expiresAt:NOW+1000};const next=expiryConditions(previous,"week","",NOW);assert.deepEqual({...next,expiresAt:previous.expiresAt},previous);assert.equal(next.expiresAt,NOW+7*86400000);assert.equal(expiryConditions(previous,"never","",NOW).expiresAt,undefined);assert.equal(previous.expiresAt,NOW+1000);assert.throws(()=>expiryConditions(previous,"custom","bad",NOW));assert.throws(()=>expiryConditions(previous,"custom","2020-01-01 00:00",NOW));});
test("Grants offers real create, resource filter and searchable shared list without raw identifier inputs",()=>{const html=draw(<Grants/>);for(const text of ["Give access","Filter by resource","grants-list","Search"])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/Resource id|Subject id|operations JSON/);});
test("Checker selects named principals/resources, levels and generated permissions and does not expose fake View-as token",()=>{const html=draw(<Checker/>);for(const text of ["Check access","Resource kind","Action level","Capability permission"])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/Principal id|Resource id|previewToken|vas_/);});
test("resource names resolve only through typed authorized resource capabilities",()=>{assert.deepEqual(resourceNameRequest({type:"folder",id:"fld_test"}),{cap:"files.folder.get",input:{folderId:"fld_test"},field:"folder",label:"name"});assert.equal(resourceNameRequest({type:"untrusted",id:"secret"}),null);});

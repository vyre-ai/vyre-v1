import test from "node:test";
import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {ResourcePicker,SubjectPicker} from "../objects/pickers.tsx";
import {ConsoleDataProvider} from "../shell/data.tsx";
import {createSampleConsole} from "../shell/sample.ts";
function draw(child:React.ReactNode):string{const base=createSampleConsole().data;const rows:Record<string,unknown>={"files.folder.search":{folders:[{folderId:"fld_sensitive",name:"Customer agreements",path:"Shared / Legal"}]},"access.principals.list":{principals:[{id:"usr_ada",name:"Ada Lovelace",status:"active"}],next:"next-page"}};return renderToStaticMarkup(<ConsoleDataProvider value={{...base,screens:{...base.screens,capQuery:(cap:string)=>{const state={status:"ready",data:rows[cap]??{}};return{subscribe:()=>()=>undefined,getSnapshot:()=>state};}} as never}}>{child}</ConsoleDataProvider>);}
test("resource selection uses authorized named folders, typed kinds and a name search instead of ID entry",()=>{const html=draw(<ResourcePicker onChange={()=>undefined}/>);for(const text of ["Customer agreements","Shared / Legal","Resource kind","Find folders"])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/Resource id|fld_sensitive<\//);});
test("subject selection has named people, typed kinds, search and server pagination",()=>{const html=draw(<SubjectPicker onChange={()=>undefined}/>);for(const text of ["Ada Lovelace","Subject kind","Find person","Load more subjects"])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/Subject id|usr_ada<\//);});

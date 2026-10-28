import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { FormWorkspace } from "../src/places/apps/shell/FormWorkspace.tsx";
import { formPreviewHtml } from "../src/places/apps/shell/form-preview.ts";
test("form preview escapes untrusted labels and blocks scripts, resources and submission", () => {
 const html = formPreviewHtml('<script>alert(1)</script>', [{key:'name',title:'<img src=x>',type:'text'},{key:'secret',title:'Hidden',type:'text'}], [{field:'name',mode:'ask'}], 'Consent <here>', '</style><script>alert(2)</script>');
 assert.ok(html.includes('default-src \'none\'')); assert.ok(html.includes('form-action \'none\'')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;img src=x&gt;')); assert.ok(!html.includes('Hidden')); assert.ok(html.includes('data-field="name"'));
});
test("desktop form workspace keeps Build Code Preview, compact rail and sandboxed canvas", () => {
 Dimensions.set({window:{width:1280,height:900,scale:1,fontScale:1},screen:{width:1280,height:900,scale:1,fontScale:1}});
 const html=renderToStaticMarkup(<FormWorkspace title="Client intake" back={()=>undefined} fields={[]} modes={[]} consent="" css="" onCss={()=>undefined} rail={<span>Fields of Clients</span>}><span>Save</span></FormWorkspace>);
 assert.ok(html.includes('Fields of Clients')); assert.ok(html.includes('>Build<')); assert.ok(html.includes('>Code<')); assert.ok(html.includes('>Preview<')); assert.ok(html.includes('sandbox=""')); assert.ok(html.includes('referrerPolicy="no-referrer"'));
});
test("typed preview uses options, relation labels, readonly Show, step grouping and theme without executable CSS", () => {
 const html=formPreviewHtml('Typed preview',[
  {key:'stage',title:'Stage',type:'status',options:{stages:[{key:'new',title:'New lead'},{key:'done',title:'Done'}]}},
  {key:'client',title:'Client',type:'relation'}, {key:'active',title:'Active',type:'boolean'}, {key:'when',title:'Date',type:'date'}, {key:'later',title:'Later',type:'text'}
 ],[{field:'stage',mode:'ask',step:0},{field:'client',mode:'ask',step:0},{field:'active',mode:'ask',step:0},{field:'when',mode:'show',step:0},{field:'later',mode:'ask',step:1}], '', '', {step:0,theme:{accent:'#123456',font:'url(https://evil.test)',background:'#eeeeee',radius:'16px'},relations:{client:[{key:'r1',title:'Acme <Ltd>'}]},answers:{stage:'new',client:'r1',active:true,when:'2026-10-28'}});
 assert.ok(html.includes('New lead')); assert.ok(html.includes('Acme &lt;Ltd&gt;'));assert.ok(html.includes(' checked'));assert.ok(html.includes('2026-10-28'));assert.ok(!html.includes('>Later<'));assert.ok(html.includes('--fa:#123456'));assert.ok(!html.includes('url(https://evil.test)'));
});
test("logic preview follows documented public submission rules and preserves combined rule data", async () => {
 const {previewLogic,updateRules}=await import('../src/places/apps/shell/form-design.ts');
 const logic={version:1,rules:[{when:{field:'choice',op:'eq',value:'yes'},show:['details'],require:['details']},{when:{all:[{field:'count',op:'gte',value:3},{not:{field:'choice',op:'empty'}}]},hide:['other']}]};
 for(const [answers,hidden,required] of [[{},['details'],[]],[{choice:'yes'},[],['details']],[{choice:'no',count:4},['details','other'],[]],[{choice:'yes',count:4,details:'ok'},['other'],['details']]] as const){
  const state=previewLogic(logic,answers);assert.deepEqual([...state.hidden].sort(),[...hidden].sort());assert.deepEqual([...state.required].sort(),[...required].sort());
 }
 assert.deepEqual(updateRules(logic,logic.rules),logic);
 const html=formPreviewHtml('Conditional',[{key:'choice',title:'Choice',type:'text'},{key:'details',title:'Details',type:'text'}],[{field:'choice',mode:'ask'},{field:'details',mode:'ask'}],'','',{logic,answers:{choice:'no'}});
 assert.ok(!html.includes('>Details<'));
});
test("preview orders questions by form layout and preserves individual pages", () => {
 const fields=[{key:'first',title:'First question',type:'text'},{key:'last',title:'Last question',type:'text'}],modes=[{field:'last',mode:'ask',step:1},{field:'first',mode:'ask',step:0}];
 const html=formPreviewHtml('Order',fields,modes,'',''); assert.ok(html.indexOf('>Last question<')<html.indexOf('>First question<'));
 const page=formPreviewHtml('Order',fields,modes,'','',{step:1});assert.ok(page.includes('>Last question<'));assert.ok(!page.includes('>First question<'));
});

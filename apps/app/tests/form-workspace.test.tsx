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

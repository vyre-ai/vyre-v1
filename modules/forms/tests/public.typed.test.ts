import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../fixtures/world.ts';
import { run } from '../fixtures/seed.ts';
import { configureForms, mustForm } from '../projections.ts';
import { publicFormViewTyped, typedAnswers } from '../handlers/submit.ts';
const schema=[{key:'email',title:'Email',type:'email'},{key:'count',title:'Head count',type:'number'},{key:'active',title:'Active',type:'checkbox'},{key:'stage',title:'Stage',type:'choice',options:{choices:[{key:'new',title:'New lead'}]}},{key:'day',title:'Date',type:'date'},{key:'company',title:'Company',type:'relation'},{key:'attachment',title:'Attachment',type:'files'}];
test('public typed metadata contains selected schema fields and choices without relation records',async()=>{
 const h=harness();configureForms({schemaFields:async()=>schema});
 const made=await run(h.ctx,'forms.create',{name:'Typed',recordType:'contact',kind:'public'});await run(h.ctx,'forms.fields_set',{formId:made.form.formId,fields:[{field:'stage',mode:'ask'},{field:'company',mode:'ask'}]});await run(h.ctx,'forms.publish',{formId:made.form.formId});
 const view=await publicFormViewTyped(h.ctx,made.form.slug,'form');
 assert.deepEqual(view.fields[0]!.choices,[{key:'new',title:'New lead'}]);assert.equal(view.fields[1]!.type,'relation');assert.equal(view.fields[1]!.choices,undefined);assert.ok(!JSON.stringify(view).includes('Head count'));
});
test('typed answers coerce only valid numbers and booleans, validate choices/dates and reject arbitrary relation IDs',async()=>{
 const h=harness();configureForms({schemaFields:async()=>schema});const made=await run(h.ctx,'forms.create',{name:'Typed submit',recordType:'contact',kind:'public'});const formId=made.form.formId;await run(h.ctx,'forms.fields_set',{formId,fields:schema.map((field)=>({field:field.key,mode:'ask'}))});const form=mustForm(h.ctx,formId);
 assert.deepEqual(await typedAnswers(h.ctx,form,{count:'2.5',active:'false',stage:'new',day:'2026-10-28'}),{count:2.5,active:false,stage:'new',day:'2026-10-28'});
 for(const answers of [{count:'NaN'},{active:'perhaps'},{stage:'private'},{day:'2026-02-30'},{company:'rec_private'},{attachment:['fil_private']}])await assert.rejects(typedAnswers(h.ctx,form,answers),{name:'VyreErr'});
});
test('publishing refuses a required unserviceable relation with a field-specific explanation',async()=>{
 const h=harness();configureForms({schemaFields:async()=>[{key:'company',title:'Company',type:'relation',required:true}]});
 const made=await run(h.ctx,'forms.create',{name:'Required company',recordType:'contact',kind:'public'});await run(h.ctx,'forms.fields_set',{formId:made.form.formId,fields:[{field:'company',mode:'ask'}]});
 await assert.rejects(run(h.ctx,'forms.publish',{formId:made.form.formId}),(e:unknown)=>{assert.match(String(e),/Company.*publisher-approved/);return true;});
});
test('upload policy requires publisher folder write access and revocation blocks new uploads and lease use',async()=>{
 const h=harness();const made=await run(h.ctx,'forms.create',{name:'Folder guarded',recordType:'contact',kind:'public'});const formId=made.form.formId;
 h.ctx.authorize=()=>({effect:'deny',reason:'denied',decisionId:'denied'});
 await assert.rejects(run(h.ctx,'forms.update',{formId,uploadPolicy:{folderId:'fld_private',fields:['attachment']}}));
 h.ctx.authorize=()=>({effect:'allow',reason:'granted',decisionId:'allowed'});
 await run(h.ctx,'forms.fields_set',{formId,fields:[{field:'attachment',mode:'ask'}]});await run(h.ctx,'forms.update',{formId,uploadPolicy:{folderId:'fld_allowed',fields:['attachment']}});await run(h.ctx,'forms.publish',{formId});
 const {reserveUpload,recordUpload,checkUploads}=await import('../handlers/submit.ts');
 let allowed=true;configureForms({canUpload:()=>allowed});assert.equal(reserveUpload(h.ctx,made.form.slug).folderId,'fld_allowed');
 const id=await recordUpload(h.ctx,{slug:made.form.slug,fileId:'fil_fixture',name:'fixture.txt',mime:'text/plain',size:3});allowed=false;
 assert.throws(()=>reserveUpload(h.ctx,made.form.slug));assert.throws(()=>checkUploads(h.ctx,mustForm(h.ctx,formId),{attachment:{fileId:id}},null,h.ctx.principal.id));
});

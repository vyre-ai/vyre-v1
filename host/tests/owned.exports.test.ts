import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {openDb} from '../src/daemon/sqlite.ts';import {createBlobStore} from '../src/ctx/blobs.ts';
import {createOwnedExports,EXPORT_TTL_MS,scrubExport} from '../src/daemon/owned-exports.ts';
import type {Ctx} from '../../packages/contracts/src/ctx.ts';
test('owned export ports are source-specific, scrubbed, preserve effective requester and expire encrypted copies',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owned-export-unit-')),db=openDb(path.join(dir,'exports.db'));db.run('CREATE TABLE logs_export (id TEXT)');db.run('CREATE TABLE health_bundle (file_id TEXT)');let now=1000;
 const blobs=createBlobStore({dir:path.join(dir,'blobs'),key:'fixture-owned-export-key-not-a-secret',now:()=>now});const resources:{id:string;ownerId:string}[]=[];
 const exports=createOwnedExports({db,blobs,space:'spc_fixture',now:()=>now,register:async(row)=>{resources.push(row);}});
 const execution={space:'spc_fixture',principal:{kind:'agent' as const,id:'agt_fixture'},actingFor:'usr_requester',trace:{traceId:'1'.repeat(32),spanId:'2'.repeat(16)},authorize:()=>({effect:'allow' as const,reason:'fixture',decisionId:'fixture'})};
 try{
  assert.equal(exports.forExecution('files.create',execution),undefined);assert.equal(exports.forExecution('constructor',execution),undefined);
  const port=exports.forExecution('logs.export',execution) as {logs(rows:unknown):Promise<string>};assert.equal('save' in port,false);await assert.rejects(port.logs('unfiltered bytes'));await assert.rejects(port.logs([{at:1,level:'info',msg:'test',path:'/tmp/target'}]));
  // secret-scan: fake (synthetic provider-shaped token verifies export redaction)
  const token='sk-proj-abcdefghijklmnopqrstuvwxyz123456';const id=await port.logs([{at:now,level:'info',msg:'export.fixture',attrs:{api_key:token,note:`Bearer ${token}`,body:'private message body'}}]);
  const row=db.all('SELECT * FROM host_owned_export WHERE id = ?',id)[0] as Record<string,unknown>;assert.equal(row.owner_kind,'person');assert.equal(row.owner_id,'usr_requester');assert.equal(row.actor_kind,'agent');assert.equal(row.actor_id,'agt_fixture');assert.deepEqual(resources,[{id,ownerId:'usr_requester'}]);
  const {actingFor:_actingFor,...withoutBehalf}=execution;const owner={...withoutBehalf,principal:{kind:'person' as const,id:'usr_requester'}};const content=await exports.read('files.read',owner,{fileId:id,as:'text'}) as {text:string};assert.ok(!content.text.includes(token));assert.ok(!content.text.includes('private message body'));
  await assert.rejects(exports.read('files.read',{...owner,principal:{kind:'service',id:'usr_requester'}},{fileId:id}));
  db.run('INSERT INTO logs_export(id) VALUES (?)',id);now+=EXPORT_TTL_MS+1;await exports.cleanup();assert.equal(exports.has(id),false);assert.equal(db.all('SELECT * FROM logs_export').length,0);assert.equal(blobs.ownerOf(String(row.blob_id)),null);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
 assert.deepEqual(scrubExport({password:'fixture',text:'api_key=fixture-secret'}),{text:'api_key=[REDACTED]'});
});

test('permission revocation during blocked retrieval never returns administrative bytes',async()=>{
 for(const source of ['logs.export','audit.export'] as const){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owned-export-race-')),db=openDb(path.join(dir,'db'));db.run('CREATE TABLE logs_export (id TEXT)');db.run('CREATE TABLE health_bundle (file_id TEXT)');
  let allowed=true,blocked=false;let enter:()=>void=()=>undefined,release:()=>void=()=>undefined;
  const entered=new Promise<void>(resolve=>{enter=resolve;});const resume=new Promise<void>(resolve=>{release=resolve;});
  const real=createBlobStore({dir:path.join(dir,'blobs'),key:'fixture-export-race-key',now:()=>1000});
  const blobs={...real,forModule:(id:string,trace?:string)=>{const port=real.forModule(id,trace);return {...port,get:async(blobId:string)=>{const out=await port.get(blobId);if(blocked){enter();await resume;}return out;}};}};
  const execution={space:'spc_fixture',principal:{kind:'person' as const,id:'usr_owner'},trace:{traceId:'1'.repeat(32),spanId:'2'.repeat(16)},authorize:()=>({effect:allowed?'allow' as const:'deny' as const,reason:'fixture',decisionId:'fixture'})};
  const exports=createOwnedExports({db,blobs,space:'spc_fixture',now:()=>1000,register:async()=>undefined});
  try{const port=exports.forExecution(source,execution) as {logs(rows:unknown[]):Promise<string>;save(name:string,csv:string):Promise<string>};const id=source==='logs.export'?await port.logs([{at:1000,level:'info',msg:'private.fixture'}]):await port.save('audit.csv','at,actor,on_behalf_of,action,resource,class,trace_id,seq\nprivate.fixture');blocked=true;const read=exports.read('files.read',execution,{fileId:id,as:'text'});await entered;allowed=false;release();await assert.rejects(read);}finally{release();db.close();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('revoked or failed export saves remove the newly written blob and metadata',async()=>{
 for(const boundary of ['cleanup','put','register','register-revoked','storage'] as const){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owned-export-save-race-')),raw=openDb(path.join(dir,'db'));raw.run('CREATE TABLE logs_export (id TEXT)');raw.run('CREATE TABLE health_bundle (file_id TEXT)');let allowed=true,failStorage=false,armed=false,now=1000;
  const real=createBlobStore({dir:path.join(dir,'blobs'),key:'fixture-export-save-key',now:()=>now});
  const blobs={...real,forModule:(id:string,trace?:string)=>{const port=real.forModule(id,trace);return {...port,delete:async(id:string)=>{const deleted=await port.delete(id);if(armed&&boundary==='cleanup')allowed=false;return deleted;},put:async(...args:Parameters<typeof port.put>)=>{const out=await port.put(...args);if(armed&&boundary==='put')allowed=false;return out;}};}};
  const db={all:(sql:string,...args:unknown[])=>raw.all(sql,...args),run:(sql:string,...args:unknown[])=>{if(failStorage&&sql.startsWith('INSERT INTO host_owned_export'))throw new Error('fixture storage failure');return raw.run(sql,...args);}};
  const execution={space:'spc_fixture',principal:{kind:'person' as const,id:'usr_owner'},trace:{traceId:'1'.repeat(32),spanId:'2'.repeat(16)},authorize:()=>({effect:allowed?'allow' as const:'deny' as const,reason:'fixture',decisionId:'fixture'})};
  const exports=createOwnedExports({db,blobs,space:'spc_fixture',now:()=>now,register:async()=>{if(armed&&boundary==='register')throw new Error('fixture registration failure');if(armed&&boundary==='register-revoked')allowed=false;}});
  try{const port=exports.forExecution('logs.export',execution) as {logs(rows:unknown[]):Promise<string>};if(boundary==='cleanup'){await port.logs([{at:1000,level:'info',msg:'expired.fixture'}]);now+=EXPORT_TTL_MS+1;}armed=true;failStorage=boundary==='storage';await assert.rejects(port.logs([{at:1000,level:'info',msg:'fixture'}]));assert.equal(real.usage('owned_exports'),0,boundary);assert.equal(raw.all('SELECT * FROM host_owned_export').length,0,boundary);}finally{raw.close();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

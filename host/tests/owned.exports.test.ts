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
  const token='sk-proj-abcdefghijklmnopqrstuvwxyz123456';const id=await port.logs([{at:now,level:'info',msg:'export.fixture',attrs:{api_key:token,note:`Bearer ${token}`,body:'private message body'}}]);
  const row=db.all('SELECT * FROM host_owned_export WHERE id = ?',id)[0] as Record<string,unknown>;assert.equal(row.owner_kind,'person');assert.equal(row.owner_id,'usr_requester');assert.equal(row.actor_kind,'agent');assert.equal(row.actor_id,'agt_fixture');assert.deepEqual(resources,[{id,ownerId:'usr_requester'}]);
  const owner={...execution,principal:{kind:'person' as const,id:'usr_requester'},actingFor:undefined};const content=await exports.read('files.read',owner,{fileId:id,as:'text'}) as {text:string};assert.ok(!content.text.includes(token));assert.ok(!content.text.includes('private message body'));
  await assert.rejects(exports.read('files.read',{...owner,principal:{kind:'service',id:'usr_requester'}},{fileId:id}));
  db.run('INSERT INTO logs_export(id) VALUES (?)',id);now+=EXPORT_TTL_MS+1;await exports.cleanup();assert.equal(exports.has(id),false);assert.equal(db.all('SELECT * FROM logs_export').length,0);assert.equal(blobs.ownerOf(String(row.blob_id)),null);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
 assert.deepEqual(scrubExport({password:'fixture',text:'api_key=fixture-secret'}),{text:'api_key=[REDACTED]'});
});

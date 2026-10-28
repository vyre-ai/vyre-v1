import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {openDb} from '../src/daemon/sqlite.ts';import {createBlobStore} from '../src/ctx/blobs.ts';import {createOwnerArchives} from '../src/daemon/owner-archives.ts';
test('full archives are separate, typed, current-owner-only, bounded and expire with cached pointers',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-archive-')),db=openDb(path.join(dir,'test.db'));db.run('CREATE TABLE backup_export (file_id TEXT)');let now=1000,owner='usr_owner',allow=true;
 const blobs=createBlobStore({dir:path.join(dir,'blobs'),key:'fixture-archive-key-not-secret',now:()=>now});const archive=createOwnerArchives({db,blobs,space:'spc_fixture',owner:()=>owner,now:()=>now,register:async()=>undefined});
 const ctx={space:'spc_fixture',principal:{kind:'person' as const,id:owner},trace:{traceId:'1'.repeat(32),spanId:'2'.repeat(16)},authorize:()=>({effect:allow?'allow' as const:'deny' as const,reason:'fixture',decisionId:'fixture'})};
 try{
  assert.equal(archive.forExecution('logs.export',ctx),undefined);const port=archive.forExecution('backup.export_start',ctx) as {saveZip(run:string,name:string,bytes:Uint8Array):Promise<{fileId:string}>};assert.equal('save' in port,false);
  await assert.rejects(port.saveZip('run_fixture','/tmp/arbitrary.zip',new Uint8Array([80,75,3,4])));await assert.rejects(port.saveZip('run_fixture','vyre-export-2026-10-29.zip',new Uint8Array([1,2,3,4])));
  const saved=await port.saveZip('run_fixture','vyre-export-2026-10-29.zip',new Uint8Array([80,75,3,4,1,2]));const status=archive.forExecution('backup.export_status',ctx) as {status(id:string):Promise<any>};assert.equal((await status.status('run_fixture')).fileId,saved.fileId);
  await assert.rejects(archive.read('files.read',{...ctx,space:'spc_other'},{fileId:saved.fileId}));allow=false;await assert.rejects(archive.read('files.read',ctx,{fileId:saved.fileId}));allow=true;owner='usr_next';await assert.rejects(archive.read('files.read',ctx,{fileId:saved.fileId}));await assert.rejects(archive.read('files.read',{...ctx,principal:{kind:'person',id:owner}},{fileId:saved.fileId}));
  const row=db.all('SELECT blob_id FROM host_owner_archive')[0] as {blob_id:string};db.run('INSERT INTO backup_export VALUES (?)',saved.fileId);now+=24*60*60*1000+1;await archive.cleanup();assert.equal(archive.has(saved.fileId),false);assert.equal(blobs.ownerOf(row.blob_id),null);assert.equal(db.all('SELECT * FROM backup_export').length,0);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('paused archive reads and status recheck owner, permissions and expiry after blob retrieval',async()=>{
 for(const kind of ['read','status'] as const)for(const change of ['owner','permission','expiry'] as const){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-archive-race-')),db=openDb(path.join(dir,'test.db'));db.run('CREATE TABLE backup_export (file_id TEXT)');let now=1000,owner='usr_owner',allow=true,pause=false;let resume=()=>{},entered=()=>{};const waiting=new Promise<void>(resolve=>{entered=resolve;});
  const source=createBlobStore({dir:path.join(dir,'blobs'),key:'fixture-archive-race-key',now:()=>now});const wrapped={...source,forModule(module:string){const port=source.forModule(module);return{...port,get:async(id:string)=>{const blob=await port.get(id);if(pause){entered();await new Promise<void>(resolve=>{resume=resolve;});}return blob;}};}};
  const archive=createOwnerArchives({db,blobs:wrapped,space:'spc_fixture',owner:()=>owner,now:()=>now,register:async()=>undefined}),ctx={space:'spc_fixture',principal:{kind:'person' as const,id:'usr_owner'},trace:{traceId:'1'.repeat(32),spanId:'2'.repeat(16)},authorize:()=>({effect:allow?'allow' as const:'deny' as const,reason:'fixture',decisionId:'fixture'})};
  try{const save=archive.forExecution('backup.export_start',ctx) as {saveZip(run:string,name:string,bytes:Uint8Array):Promise<{fileId:string}>};const saved=await save.saveZip('run_race','vyre-export-2026-10-29.zip',new Uint8Array([80,75,3,4]));const status=archive.forExecution('backup.export_status',ctx) as {status(run:string):Promise<unknown>};pause=true;const pending=kind==='read'?archive.read('files.read',ctx,{fileId:saved.fileId}):status.status('run_race');await waiting;if(change==='owner')owner='usr_next';if(change==='permission')allow=false;if(change==='expiry')now+=86400001;resume();await assert.rejects(pending,undefined,`${kind} must refuse ${change} during blob retrieval`);}
  finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('archive verification and registration failures remove encrypted bytes and metadata',async()=>{
 for(const failure of ['verification','registration'] as const){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-archive-failure-')),db=openDb(path.join(dir,'test.db'));db.run('CREATE TABLE backup_export (file_id TEXT)');const source=createBlobStore({dir:path.join(dir,'blobs'),key:'fixture-archive-failure-key',now:()=>1000});let blobId='';
  const wrapped={...source,forModule(module:string){const port=source.forModule(module);return{...port,put:async(...args:Parameters<typeof port.put>)=>{const out=await port.put(...args);blobId=out.id;return out;},get:async(id:string)=>{const blob=await port.get(id);return failure==='verification'&&blob?{...blob,bytes:new Uint8Array([80,75,3,5])}:blob;}};}};
  const archive=createOwnerArchives({db,blobs:wrapped,space:'spc_fixture',owner:()=> 'usr_owner',now:()=>1000,register:async()=>{if(failure==='registration')throw new Error('Fixture registration failed');}}),ctx={space:'spc_fixture',principal:{kind:'person' as const,id:'usr_owner'},trace:{traceId:'1'.repeat(32),spanId:'2'.repeat(16)},authorize:()=>({effect:'allow' as const,reason:'fixture',decisionId:'fixture'})};
  try{const save=archive.forExecution('backup.export_start',ctx) as {saveZip(run:string,name:string,bytes:Uint8Array):Promise<{fileId:string}>};await assert.rejects(save.saveZip('run_failure','vyre-export-2026-10-29.zip',new Uint8Array([80,75,3,4])));assert.ok(blobId);assert.equal(source.ownerOf(blobId),null);assert.equal(db.all('SELECT * FROM host_owner_archive').length,0);}
  finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

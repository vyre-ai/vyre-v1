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

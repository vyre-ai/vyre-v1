import test from 'node:test';import assert from 'node:assert/strict';
import {writeConnectorFolder} from '../handlers/files.ts';import type {ConnectorsCtx} from '../projections.ts';
test('connector source writer accepts human test names and rejects traversal before any Files operation',async()=>{
 const calls:{cap:string;input:any}[]=[];const ctx={trace:{traceId:'1'.repeat(32)},call:async(cap:string,input:unknown)=>{calls.push({cap,input});if(cap==='files.tree')return{roots:[{key:'personal',folderId:'fld_personal'}]};if(cap==='files.folder.create')return{folder:{folderId:`fld_${calls.length}`}};return{file:{fileId:'fil_fixture'}};}} as unknown as ConnectorsCtx;
 const id=await writeConnectorFolder(ctx,'fixture',[{path:'tests/ping answers ok.json',content:'{}'}]);assert.match(id,/^fld_/);assert.ok(calls.some(row=>row.cap==='files.create'&&row.input.name==='ping answers ok.json'));
 calls.length=0;for(const path of ['../private','actions/../../private','tests/a/b.json','tests/..'])await assert.rejects(writeConnectorFolder(ctx,'fixture',[{path,content:'{}'}]));assert.equal(calls.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bootCore,CORE_SPACE} from '../../fixtures/seed/core/index.ts';
import type {NewEvent} from '../../kernel/src/log/types.ts';
import type {CapabilityDef} from '../../packages/contracts/src/types.ts';
import {startDaemon} from '../src/daemon/daemon.ts';
import {loadConfig} from '../src/daemon/config.ts';
import {fakePlatform} from '../src/platform/index.ts';
const probe={name:'example.export_probe',v:1,permission:'server.logs',level:'view',resource:{type:'space'},idempotency:'natural',effects:'read',risk:'low',emits:[],examples:[],surfaces:{},input:{},output:{},errors:[],summary:'Test context'} as unknown as CapabilityDef;
function directory():string{
 const core=bootCore();const events:NewEvent[]=[
  {id:'evt_owned_role',type:'role.defined',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'rol_exporter',clearance:3,perms:['server.logs'],name:'Log reader'}},
  {id:'evt_owned_person',type:'principal.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'usr_exporter',kind:'person',status:'active',name:'Export reader'}},
  {id:'evt_owned_holder',type:'principal.role_set',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{holder:'usr_exporter',role:'rol_exporter'}},
  {id:'evt_owned_grant',type:'grant.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'gr_owned',subject_kind:'actor',subject_id:'usr_exporter',resource_type:'space',resource_id:CORE_SPACE,level:'view'}},
 ];assert.ok(core.store.appendBatch(events).every((out)=>out.ok));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyre-owned-export-'));core.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE');fs.copyFileSync(core.file,path.join(dir,'events.db'));core.close();return dir;
}
test('server.logs-only requester gets a readable private export; another person, missing permission and unrelated handler are denied',async()=>{
 const dir=directory();const d=await startDaemon({config:loadConfig(['--data-dir',dir,'--port','0'],{},'1.2.3'),platform:fakePlatform({os:'linux',hostname:'exports',free:80e9,commands:{[`findmnt -n -o SOURCE --target ${dir}`]:{stdout:'/dev/mapper/vyre\n'},'lsblk -s -n -o TYPE /dev/mapper/vyre':{stdout:'crypt\ndisk\n'},'docker info --format {{.ServerVersion}}':{stdout:'27.1.1\n'}}}),fetch:()=>Promise.resolve({ok:true,status:200,headers:{get:()=>null},text:()=>Promise.resolve('{"apps":{"http":{}}}')}),session:(headers)=>{const token=String(headers.authorization??'').replace(/^Bearer /,'');return ['usr_exporter','usr_olivia','usr_tess'].includes(token)?{space:CORE_SPACE,principal:{kind:'person',id:token},device:'owned-exports'}:null;},extra:{caps:[probe],routes:[{method:'POST',path:'/v1/example/export_probe',cap:'example.export_probe',v:1,effects:'read'}],handlers:{'example.export_probe':(ctx)=>({hasPort:'exports' in ctx})}},intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
 const call=async(cap:string,input:unknown,person='usr_exporter')=>{const response=await fetch(`${d.url}/v1/${cap.replaceAll('.','/')}`,{method:'POST',headers:{authorization:`Bearer ${person}`,'content-type':'application/json'},body:JSON.stringify(input)});return{status:response.status,...await response.json() as {data?:any;error?:unknown}};};
 try{
  assert.deepEqual((await call('example.export_probe',{})).data,{hasPort:false});
  const rowsBefore=d.db!.all('SELECT id FROM host_owned_export').length;
  assert.equal((await call('logs.export',{},'usr_tess')).status,403);assert.equal(d.db!.all('SELECT id FROM host_owned_export').length,rowsBefore);
  const exported=await call('logs.export',{});assert.equal(exported.status,200,JSON.stringify(exported));const id=exported.data.fileId;
  const metadata=await call('files.get',{fileId:id});assert.equal(metadata.status,200,JSON.stringify(metadata));assert.equal(metadata.data.file.ownerId,'usr_exporter');
  const content=await call('files.read',{fileId:id,as:'base64'});assert.equal(content.status,200,JSON.stringify(content));assert.equal(content.data.truncated,false);assert.equal(typeof Buffer.from(content.data.base64,'base64').toString(),'string');
  const inline=await call('files.read',{fileId:id,as:'url'});assert.equal(inline.status,200);assert.match(inline.data.url,/^data:application\/x-ndjson;base64,/);
  for(const person of ['usr_olivia','usr_tess'])assert.equal((await call('files.read',{fileId:id,as:'text'},person)).status,403);
  const bundle=await call('health.support_bundle',{idempotencyKey:'owned-bundle'});assert.equal(bundle.status,200,JSON.stringify(bundle));assert.equal((await call('files.read',{fileId:bundle.data.fileId,as:'text'})).status,200);
  const audit=await call('audit.export',{},'usr_olivia');assert.equal(audit.status,200,JSON.stringify(audit));assert.equal((await call('files.read',{fileId:audit.data.fileId,as:'text'},'usr_olivia')).status,200);assert.equal((await call('files.read',{fileId:audit.data.fileId,as:'text'})).status,403);
  assert.equal((await call('files.create',{folderId:'fld_root',name:'no-authority.txt',content:{text:'x'},idempotencyKey:'owned-no-write'})).status,403,'export does not add Files write authority');
 }finally{await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

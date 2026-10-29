// Real HTTP regression; only identities/roles and disposable metadata are fixture seeded.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {bootCore,CORE_SPACE} from '../../fixtures/seed/core/index.ts';import {startDaemon} from '../src/daemon/daemon.ts';import {loadConfig} from '../src/daemon/config.ts';import {fakePlatform} from '../src/platform/index.ts';
test('connector Files outputs are real and private, and missing Files authority leaves no connector draft',async()=>{
 const core=bootCore(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyre-connectors-files-'));
 const events=core.store.appendBatch([
  {id:'evt_fixture_conperson',type:'principal.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'usr_cononly',kind:'person',status:'active',name:'Connector-only fixture'}},
  {id:'evt_fixture_conrole',type:'role.defined',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'rol_cononly',name:'Connector-only fixture',clearance:3,perms:['connectors.manage']}},
  {id:'evt_fixture_conholder',type:'principal.role_set',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{holder:'usr_cononly',role:'rol_cononly'}},
  {id:'evt_fixture_congrant',type:'grant.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'gr_cononly',subject_kind:'actor',subject_id:'usr_cononly',resource_type:'space',resource_id:CORE_SPACE,level:'edit'}},
 ]);assert.ok(events.every(event=>event.ok));core.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');fs.copyFileSync(core.file,path.join(dir,'events.db'));core.close();
 const d=await startDaemon({config:loadConfig(['--data-dir',dir,'--port','0'],{},'1.2.3'),platform:fakePlatform(),session:headers=>({space:CORE_SPACE,principal:{kind:'person',id:headers.authorization==='Bearer owner'?'usr_olivia':headers.authorization==='Bearer limited'?'usr_cononly':'usr_noah'},device:'fixture'}),intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
 const call=async(token:string,cap:string,input:object)=>{const response=await fetch(`${d.url}/v1/${cap.replaceAll('.','/')}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)});return{status:response.status,body:await response.json() as {data?:any;error?:unknown}};};
 try{
 const denied=await call('limited','connectors.init',{key:'fixture_denied',title:'Denied Files',mode:'webhook_only',idempotencyKey:'connector-denied'});assert.equal(denied.status,403,JSON.stringify(denied.body));assert.equal((await call('owner','connectors.get',{key:'fixture_denied'})).status,404);
 const store=new DatabaseSync(path.join(dir,'space.db'),{readOnly:true});try{assert.equal(store.prepare('SELECT COUNT(*) AS n FROM cn_drafts WHERE key = ?').get('fixture_denied')?.n,0);}finally{store.close();}
 const made=await call('owner','connectors.init',{key:'fixture_created',title:'Fixture created',mode:'webhook_only',idempotencyKey:'connector-created'});assert.equal(made.status,200,JSON.stringify(made.body));const initial=made.body.data.folderId;assert.equal((await call('owner','files.folder.get',{folderId:initial})).status,200);
 const exported=await call('owner','connectors.export',{key:'fixture_created'});assert.equal(exported.status,200,JSON.stringify(exported.body));const folderId=exported.body.data.folderId;
 const listed=await call('owner','files.list',{folder:folderId});assert.equal(listed.status,200);const files=listed.body.data.files as {name:string;fileId:string}[];assert.deepEqual(files.map(file=>file.name).sort(),['README.md','connector.toml']);const fileId=files.find(file=>file.name==='connector.toml')!.fileId;
 const read=await call('owner','files.read',{fileId});assert.equal(read.status,200);assert.match(JSON.stringify(read.body),/fixture_created/);assert.equal((await call('member','files.folder.get',{folderId})).status,403);assert.equal((await call('member','files.read',{fileId})).status,403);
 }finally{await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

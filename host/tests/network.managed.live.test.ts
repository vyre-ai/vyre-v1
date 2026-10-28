import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootCore } from '../../fixtures/seed/core/index.ts';
import { loadConfig } from '../src/daemon/config.ts';
import { startDaemon } from '../src/daemon/daemon.ts';
import { managedNetworkPort } from '../src/daemon/network-driver.ts';
import { FakeCaddy } from '../src/caddy/fake.ts';
import { fakePlatform } from '../src/platform/index.ts';
test('HTTP domain change waits for managed Caddy apply; failed apply and disconnect remain visible without erasing prior state',async()=>{
 const core=bootCore(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyre-network-managed-'));
 core.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE');fs.copyFileSync(core.file,path.join(dir,'events.db'));core.close();
 const caddy=new FakeCaddy(),network=managedNetworkPort({adminUrl:'http://127.0.0.1:2019',space:'spc_core',upstream:()=> '127.0.0.1:8420',ingressHost:()=> 'fixture.example.com',relayReady:()=>false,fetch:caddy.fetch,resolver:{cname:async()=>[],address:async()=>['203.0.113.17']}});
 const boot=()=>startDaemon({config:loadConfig(['--data-dir',dir,'--port','0'],{},'1.2.3'),network,platform:fakePlatform({os:'linux',free:80e9}),session:(headers)=>headers['authorization']==='Bearer fixture-owner'?{space:'spc_core',principal:{kind:'person',id:'usr_olivia'},device:'fixture'}:headers['authorization']==='Bearer fixture-member'?{space:'spc_core',principal:{kind:'person',id:'usr_noah'},device:'fixture'}:null,intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
 let daemon=await boot();
 let attempt=0;
 const call=async(cap:string,input:object={},owner=true)=>{const response=await fetch(`${daemon.url}/v1/${cap.replace('.','/')}`,{method:'POST',headers:{'content-type':'application/json',authorization:owner?'Bearer fixture-owner':'Bearer fixture-member'},body:JSON.stringify({idempotencyKey:`fixture-network-${++attempt}`,...input})});return{status:response.status,body:await response.json() as {data?:any;error?:unknown}};};
 try{
  const original=(await call('network.status')).body.data;
  assert.notEqual((await call('network.domain_set',{domain:'fixture.example.com'},false)).status,200);
  assert.equal((await call('network.domain_set',{domain:'fixture.example.com'})).status,200);
  assert.equal((await call('network.status')).body.data.address,original.address,'queued request is not observed completion');
  await daemon.pollCommands();let status=(await call('network.status')).body.data;assert.equal(status.address,'fixture.example.com');assert.equal(status.commands[0].state,'applied');assert.ok(caddy.calls.some(item=>JSON.stringify(item.body??null).includes('fixture.example.com')));
  const changes=await daemon.log!.read({type:'network.domain_changed'});assert.equal(changes.filter(event=>(JSON.parse(new TextDecoder().decode(event.payload)) as {address?:string}).address==='fixture.example.com').length,1);
  caddy.down=true;await call('network.domain_set',{domain:'failed.example.com'});await daemon.pollCommands();status=(await call('network.status')).body.data;assert.equal(status.address,'fixture.example.com');assert.equal(status.commands[0].state,'failed');assert.doesNotMatch(JSON.stringify(status.commands),/ECONNREFUSED/);
  await call('network.server_reconnect',{serverId:'srv_local'});await daemon.pollCommands();status=(await call('network.status')).body.data;assert.equal(status.commands[0].state,'failed');
  await daemon.stop();daemon=await boot();status=(await call('network.status')).body.data;assert.equal(status.address,'fixture.example.com');assert.ok(status.commands.some((row:{state:string})=>row.state==='failed'),'observed failure survives restart');
 } finally {await daemon.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NewEvent } from '../../kernel/src/log/types.ts';
import { bootCore, CORE_SPACE } from '../../fixtures/seed/core/index.ts';
import { startDaemon } from '../src/daemon/daemon.ts';
import { loadConfig } from '../src/daemon/config.ts';
import { fakePlatform } from '../src/platform/index.ts';
test('HTTP spend reads enforce effective-person privacy and delegated manage intersection',async()=>{
 const core=bootCore(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyre-spend-privacy-'));
 const events:NewEvent[]=[];for(const [suffix,perms] of [['manager',['ai.spend']],['basic',[]]] as const){events.push(
  {id:`evt_spend_role_${suffix}`,type:'role.defined',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:`rol_spend${suffix}`,name:`Fixture ${suffix}`,clearance:3,perms,assignableToAgents:true}},
  {id:`evt_spend_agent_${suffix}`,type:'principal.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:`agt_spend${suffix}`,kind:'agent',status:'active',name:`Fixture ${suffix}`}},
  {id:`evt_spend_holder_${suffix}`,type:'principal.role_set',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{holder:`agt_spend${suffix}`,role:`rol_spend${suffix}`}},
  {id:`evt_spend_grant_${suffix}`,type:'grant.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:`gr_spend${suffix}`,subject_kind:'actor',subject_id:`agt_spend${suffix}`,resource_type:'space',resource_id:CORE_SPACE,level:'manage'}},
 );}
 events.push(
  {id:'evt_spend_manager_person',type:'principal.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'usr_budgetmanager',kind:'person',status:'active',name:'Fixture agent manager'}},
  {id:'evt_spend_manager_role',type:'principal.role_set',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{holder:'usr_budgetmanager',role:'rol_spendmanager'}},
  {id:'evt_spend_manager_view',type:'grant.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'gr_budgetview',subject_kind:'actor',subject_id:'usr_budgetmanager',resource_type:'space',resource_id:CORE_SPACE,level:'view'}},
  {id:'evt_spend_agent_resource',type:'resource.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'agt_spendmanager',type:'agent',parent_id:CORE_SPACE,label:0,owner_id:'usr_olivia',holds:0}},
  {id:'evt_spend_agent_manager_grant',type:'grant.created',sv:1,trace_id:'1'.repeat(32),actor:'usr_olivia',vis:'space',payload:{id:'gr_budgetagent',subject_kind:'actor',subject_id:'usr_budgetmanager',resource_type:'agent',resource_id:'agt_spendmanager',level:'manage'}},
 );assert.ok(core.store.appendBatch(events).every(row=>row.ok));core.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE');fs.copyFileSync(core.file,path.join(dir,'events.db'));core.close();
 const d=await startDaemon({config:loadConfig(['--data-dir',dir,'--port','0'],{},'1.2.3'),platform:fakePlatform({os:'linux',hostname:'spend-privacy',free:80e9}),session:headers=>{const token=String(headers.authorization??'').replace(/^Bearer /,'');const agent=token==='agent-member'||token==='agent-owner'||token==='basic-owner';if(!['owner','member','agent-member','agent-owner','basic-owner','agent-manager-person'].includes(token))return null;return{space:CORE_SPACE,principal:agent?{kind:'agent',id:token==='basic-owner'?'agt_spendbasic':'agt_spendmanager'}:{kind:'person',id:token==='owner'?'usr_olivia':token==='agent-manager-person'?'usr_budgetmanager':'usr_noah'},...(agent?{actingFor:token==='agent-member'?'usr_noah':'usr_olivia'}:{}),device:'fixture'};},intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
 const call=async(token:string,input:object)=>{const response=await fetch(`${d.url}/v1/engine/spend/get`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)});return{status:response.status,body:await response.json() as {data?:{monthMicros:number};error?:unknown}};};
 try{
  assert.equal((await call('owner',{scope:'space'})).status,200);
  // Disposable operational fixtures only. Reads still use the actual authenticated pipeline.
  for(const [turn,person,cost] of [['trn_spendowner','usr_olivia',7310000],['trn_spendmember','usr_noah',200000]] as const)d.db!.run('INSERT INTO engine_usage (turn_id,thread_id,agent_id,person_id,model,at,tokens_in,tokens_out,cost_micros) VALUES (?,?,?,?,?,?,?,?,?)',turn,'thr_fixture','agt_spendmanager',person,'fixture-model',Date.now(),10,5,cost);
  assert.equal((await call('member',{scope:'person'})).body.data?.monthMicros,200000);
  for(const input of [{scope:'person',scopeId:'usr_olivia'},{scope:'space'},{scope:'agent',scopeId:'agt_spendmanager'}])assert.equal((await call('member',input)).status,403,JSON.stringify(input));
  assert.equal((await call('owner',{scope:'person',scopeId:'usr_noah'})).body.data?.monthMicros,200000);assert.equal((await call('owner',{scope:'space'})).body.data?.monthMicros,7510000);
  assert.equal((await call('agent-manager-person',{scope:'agent',scopeId:'agt_spendmanager'})).body.data?.monthMicros,7510000,'a scoped agent manager retains authorized reads');assert.equal((await call('agent-manager-person',{scope:'space'})).status,403);assert.equal((await call('agent-manager-person',{scope:'person',scopeId:'usr_olivia'})).status,403);
  assert.equal((await call('agent-member',{scope:'person'})).body.data?.monthMicros,200000,'own person means the effective requester');assert.equal((await call('agent-member',{scope:'space'})).status,403,'agent authority does not override the delegated person');
  assert.equal((await call('agent-owner',{scope:'space'})).body.data?.monthMicros,7510000,'both managers may read the legal aggregate');assert.equal((await call('basic-owner',{scope:'space'})).status,403,'delegating owner authority does not override a limited agent');assert.equal((await call('basic-owner',{scope:'person'})).body.data?.monthMicros,7310000);
 }finally{await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

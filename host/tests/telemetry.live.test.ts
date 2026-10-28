import test from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {bootCore,CORE_SPACE} from '../../fixtures/seed/core/index.ts';
import {startDaemon} from '../src/daemon/daemon.ts';import {loadConfig} from '../src/daemon/config.ts';import {fakePlatform} from '../src/platform/index.ts';
test('real daemon telemetry reaches scoped canonical HTTP reads, scrubs content and survives restart',async()=>{
 const core=bootCore(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyre-telemetry-live-'));core.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');fs.copyFileSync(core.file,path.join(dir,'events.db'));core.close();
 const boot=()=>startDaemon({config:loadConfig(['--data-dir',dir,'--port','0'],{},'1.2.3'),platform:fakePlatform(),session:headers=>({space:CORE_SPACE,principal:{kind:'person',id:headers.authorization==='Bearer member'?'usr_noah':'usr_olivia'},device:'fixture'}),intervals:{fast:3600000,slow:3600000,encryption:3600000,commands:3600000,hooks:3600000}});
 let d=await boot();const call=async(cap:string,input:object,token='owner')=>{const r=await fetch(`${d.url}/v1/${cap.replaceAll('.','/')}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(input)});return{status:r.status,trace:r.headers.get('x-vyre-trace'),body:await r.json() as {data?:any}};};
 try{
  const invoked=await call('spaces.get',{});assert.equal(invoked.status,200);assert.ok(invoked.trace);
  const spans=await call('logs.spans',{limit:200});assert.equal(spans.status,200);assert.ok(spans.body.data.spans.length>0,'actual invoke spans must be visible');
  const span=spans.body.data.spans.find((row:{name:string})=>(row as {traceId?:string}).traceId===invoked.trace);assert.ok(span,'actual spaces.get span');
  const trace=await call('logs.trace',{traceId:span.traceId});assert.ok(trace.body.data.spans.some((row:{spanId:string})=>row.spanId===span.spanId));
  d.sink.log({space:CORE_SPACE,level:40,msg:'telemetry.fixture',trace_id:span.traceId,attrs:{body:'prohibited body fixture',message:'prohibited message fixture',count:7,nested:{password:'prohibited password fixture'},known:d.token,embedded:`prefix ${d.token} suffix`,error:'provider echoed forbidden fixture payload',cap:d.token}});
  d.sink.log({space:'spc_other',level:40,msg:'telemetry.other_space'});
  const rows=await call('logs.query',{traceId:span.traceId,limit:200});assert.equal(rows.status,200);const row=rows.body.data.rows.find((row:{msg:string})=>row.msg==='telemetry.fixture');assert.ok(row);assert.equal(row.attrs.count,7);assert.doesNotMatch(JSON.stringify(row),/prohibited|password|body|message|provider echoed|forbidden/);assert.ok(!JSON.stringify(row).includes(d.token));
  assert.equal((await call('logs.query',{place:'boot'},'member')).status,403);assert.equal((await call('logs.spans',{},'member')).status,403);assert.equal((await call('logs.trace',{traceId:span.traceId},'member')).status,403);
  const all=await call('logs.query',{limit:200});assert.ok(all.body.data.rows.some((row:{place:string})=>row.place==='boot'));assert.ok(!all.body.data.rows.some((row:{msg:string})=>row.msg==='telemetry.other_space'));
  const retryTrace='7'.repeat(32), raw=d.db!, run=raw.run;let injected=false;
  d.sink.log({space:CORE_SPACE,level:40,msg:'telemetry.retry',trace_id:retryTrace});
  d.sink.span({trace_id:retryTrace,span_id:'7'.repeat(16),parent:null,name:'fixture_retry',at:Date.now(),dur_us:5000,attrs:null});
  raw.run=(sql,...args)=>{if(!injected&&sql.startsWith('INSERT OR REPLACE INTO logs_span')){injected=true;throw new Error('fixture canonical write failure');}return run(sql,...args);};
  assert.throws(()=>d.sink.flush(),/fixture canonical write failure/);raw.run=run;
  assert.equal((raw.all('SELECT COUNT(*) AS n FROM logs_row WHERE trace_id = ?',retryTrace)[0] as {n:number}).n,0,'module batch rolled back atomically');
  const retry=await call('logs.trace',{traceId:retryTrace});assert.equal(retry.body.data.logs.filter((row:{msg:string})=>row.msg==='telemetry.retry').length,1);assert.equal(retry.body.data.spans.length,1);
  const restartTrace='8'.repeat(32);d.sink.log({space:CORE_SPACE,level:40,msg:'telemetry.restart_retry',trace_id:restartTrace});
  raw.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO logs_row'))throw new Error('fixture canonical outage');return run(sql,...args);};
  assert.throws(()=>d.sink.flush(),/fixture canonical outage/);
  const stoppedAt=Date.now();await d.stop();assert.ok(Date.now()-stoppedAt<5000,'unavailable observer must not trap shutdown');d=await boot();
  const recovered=await call('logs.trace',{traceId:restartTrace});assert.equal(recovered.body.data.logs.filter((row:{msg:string})=>row.msg==='telemetry.restart_retry').length,1,'native persisted batch is replayed after restart');
  await d.stop();d=await boot();const once=await call('logs.trace',{traceId:restartTrace});assert.equal(once.body.data.logs.filter((row:{msg:string})=>row.msg==='telemetry.restart_retry').length,1,'committed checkpoint prevents replay duplicates');
const retained=await call('logs.trace',{traceId:span.traceId});assert.ok(retained.body.data.logs.some((row:{msg:string})=>row.msg==='telemetry.fixture'));assert.ok(retained.body.data.spans.some((row:{spanId:string})=>row.spanId===span.spanId));
 }finally{await d.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
